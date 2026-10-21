/**
 * Gateway — the only public entry point into the tool layer.
 *
 * submit(call, ctx, opts) → evaluates policy, executes if allowed, queues
 *                           approval if needed, records to append-only audit.
 *
 * resolveApproval(input)  → validates reviewer, executes approved call once,
 *                           records approval_outcome to audit log.
 */
import type {
  ToolCall,
  EvalContext,
  SubmitResult,
  ResolveApprovalInput,
  ResolveApprovalResult,
  ApprovalRecord,
  Role,
  ToolName,
} from './types'
import { evaluate } from './policy'
import { createToolRegistry } from './tools'
import { resetCounters as resetMockDbCounters, getUser } from './mockDb'
import { AuditLog } from './audit'

export interface GatewayOptions {
  now?: () => Date
  audit?: AuditLog
}

export interface SubmitOptions {
  eventId?: string
  timestamp?: string
}

// Reviewer role assignment per requester role
const REVIEWER_ROLE: Partial<Record<Role, Role>> = {
  'Support Agent': 'Support Lead',
  'Support Lead': 'Ops Manager',
}

// Deterministic approval ID counter
let _approvalSeq = 0

export class Gateway {
  private readonly registry = createToolRegistry()
  private readonly _now: () => Date
  private readonly _approvals: Map<string, ApprovalRecord> = new Map()
  readonly audit: AuditLog
  private _eventSeq = 0

  constructor(opts?: GatewayOptions) {
    this._now = opts?.now ?? (() => new Date())
    this.audit = opts?.audit ?? new AuditLog()
  }

  get now(): Date {
    return this._now()
  }

  async submit(
    call: ToolCall,
    ctx: EvalContext,
    opts?: SubmitOptions,
  ): Promise<SubmitResult> {
    const now = this._now()
    const decision = evaluate(call, ctx, now)
    const eventId = opts?.eventId ?? `EVT-${String(++this._eventSeq).padStart(3, '0')}`
    const timestamp = opts?.timestamp ?? now.toISOString()

    if (decision.decision === 'allowed') {
      const result = this.registry.call(call.tool, call.args)
      const auditEntry = await this.audit.append({
        timestamp,
        eventId,
        type: 'decision',
        taskId: ctx.grant.taskId,
        user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
        agentMode: ctx.agentMode,
        tool: call.tool,
        args: call.args,
        provenance: call.provenance,
        decision: 'allowed',
        ruleId: decision.ruleId,
        reason: decision.reason,
        checks: decision.checks,
        execution: { status: 'executed', result },
      })
      return {
        ...decision,
        execution: { status: 'executed', result },
        auditEntry,
      }
    }

    if (decision.decision === 'blocked') {
      const auditEntry = await this.audit.append({
        timestamp,
        eventId,
        type: 'decision',
        taskId: ctx.grant.taskId,
        user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
        agentMode: ctx.agentMode,
        tool: call.tool,
        args: call.args,
        provenance: call.provenance,
        decision: 'blocked',
        ruleId: decision.ruleId,
        reason: decision.reason,
        checks: decision.checks,
        execution: { status: 'not_executed' },
      })
      return {
        ...decision,
        execution: { status: 'not_executed' },
        auditEntry,
      }
    }

    // needs_approval — freeze the call, create a pending approval record
    const approvalId = `APR-${String(++_approvalSeq).padStart(3, '0')}`
    const requiredReviewerRole = REVIEWER_ROLE[ctx.user.role]
    if (!requiredReviewerRole) {
      // This role has no reviewer chain; treat as blocked for safety
      const reason = `${ctx.user.role} role has no reviewer assigned. The call was blocked.`
      const auditEntry = await this.audit.append({
        timestamp,
        eventId,
        type: 'decision',
        taskId: ctx.grant.taskId,
        user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
        agentMode: ctx.agentMode,
        tool: call.tool,
        args: call.args,
        provenance: call.provenance,
        decision: 'blocked',
        ruleId: 'role.tool_access',
        reason,
        checks: decision.checks,
        execution: { status: 'not_executed' },
      })
      return {
        decision: 'blocked',
        ruleId: 'role.tool_access',
        reason,
        checks: decision.checks,
        execution: { status: 'not_executed' },
        auditEntry,
      }
    }

    const record: ApprovalRecord = {
      id: approvalId,
      eventId,
      call: { ...call, args: { ...call.args } }, // frozen copy
      context: ctx,
      decision,
      requiredReviewerRole,
      status: 'pending',
      note: null,
    }
    this._approvals.set(approvalId, record)

    const auditEntry = await this.audit.append({
      timestamp,
      eventId,
      type: 'decision',
      taskId: ctx.grant.taskId,
      user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
      agentMode: ctx.agentMode,
      tool: call.tool,
      args: call.args,
      provenance: call.provenance,
      decision: 'needs_approval',
      ruleId: decision.ruleId,
      reason: decision.reason,
      checks: decision.checks,
      execution: { status: 'pending' },
    })

    return {
      ...decision,
      execution: { status: 'pending' },
      approvalId,
      auditEntry,
    }
  }

  async resolveApproval(input: ResolveApprovalInput): Promise<ResolveApprovalResult> {
    const record = this._approvals.get(input.approvalId)
    if (!record) return { ok: false, error: 'not_found' }
    if (record.status !== 'pending') return { ok: false, error: 'already_resolved' }

    const reviewer = input.reviewer ?? (input.reviewerId ? getUser(input.reviewerId) : undefined)
    if (!reviewer) {
      return { ok: false, error: 'wrong_role' }
    }

    // Self-approval check
    if (reviewer.id === record.context.user.id) {
      return { ok: false, error: 'self_approval' }
    }

    // Reviewer role check
    if (reviewer.role !== record.requiredReviewerRole) {
      return { ok: false, error: 'wrong_role' }
    }

    // Deny requires a note
    if (input.outcome === 'deny' && !input.note.trim()) {
      return { ok: false, error: 'deny_needs_note' }
    }

    const timestamp = this._now().toISOString()

    if (input.outcome === 'approve') {
      // Execute the frozen original call exactly once
      const executionResult = this.registry.call(record.call.tool, record.call.args)
      record.status = 'approved'
      record.note = input.note || null
      record.executionResult = executionResult

      const auditEntry = await this.audit.append({
        timestamp,
        eventId: record.eventId,
        type: 'approval_outcome',
        taskId: record.context.grant.taskId,
        user: { id: record.context.user.id, name: record.context.user.name, role: record.context.user.role },
        agentMode: record.context.agentMode,
        tool: record.call.tool,
        args: record.call.args,
        provenance: record.call.provenance,
        decision: record.decision.decision,
        ruleId: 'approval.review',
        reason: `Approved by ${reviewer.name}.`,
        checks: record.decision.checks,
        reviewer: {
          id: reviewer.id,
          name: reviewer.name,
          role: reviewer.role,
          outcome: 'approve',
          note: input.note || null,
        },
        execution: { status: 'executed', result: executionResult },
      })

      return { ok: true, executionResult, auditEntry }
    } else {
      // deny
      record.status = 'denied'
      record.note = input.note.trim()

      const auditEntry = await this.audit.append({
        timestamp,
        eventId: record.eventId,
        type: 'approval_outcome',
        taskId: record.context.grant.taskId,
        user: { id: record.context.user.id, name: record.context.user.name, role: record.context.user.role },
        agentMode: record.context.agentMode,
        tool: record.call.tool,
        args: record.call.args,
        provenance: record.call.provenance,
        decision: record.decision.decision,
        ruleId: 'approval.review',
        reason: `Denied by ${reviewer.name}: ${input.note.trim()}`,
        checks: record.decision.checks,
        reviewer: {
          id: reviewer.id,
          name: reviewer.name,
          role: reviewer.role,
          outcome: 'deny',
          note: input.note.trim(),
        },
        execution: { status: 'not_executed' },
      })

      return { ok: true, auditEntry }
    }
  }

  getCallCount(tool: ToolName): number {
    return this.registry.getCallCount(tool)
  }

  getApproval(id: string): ApprovalRecord | undefined {
    return this._approvals.get(id)
  }

  reset(): void {
    this.registry.resetCounts()
    this._approvals.clear()
    this.audit.reset()
    resetMockDbCounters()
    _approvalSeq = 0
    this._eventSeq = 0
  }
}
