/**
 * Server-side Policy Gateway.
 *
 * The single authoritative entry point for all tool call evaluation, approval
 * resolution, and execution. The browser and AI agent are untrusted clients.
 *
 * Invariants:
 * - Every proposed action passes through policy evaluation before execution.
 * - Deny by default: missing policy, invalid role, or missing grant blocks or requires approval.
 * - Human-in-the-loop: sensitive actions require approval from a different user with the appropriate role.
 * - Self-approval is strictly rejected.
 * - Every decision, approval, and execution produces an immutable, hash-chained audit event.
 * - Adapters execute tools ONLY when authorized.
 */
import type { Sql, TransactionSql } from 'postgres'
import { randomUUID } from 'node:crypto'
import type { SessionUser } from '../auth/session.js'
import type { TaskGrantRecord } from './grants.js'
import { isGrantValid } from './grants.js'
import {
  type OrgPolicyConfig,
  loadOrgPolicy,
  ROLE_MAP,
  ROLE_MAP_REVERSE,
} from './policy.js'
import { ServerAuditLog, type AuditEvent } from '../audit/log.js'
import type { ProviderAdapter, ToolName, ToolResult } from '../adapters/types.js'

// Known simulated invoices for invoice-aware evaluation
interface InvoiceInfo {
  id: string
  customerId: string
  total: number
}

const KNOWN_INVOICES: Record<string, InvoiceInfo> = {
  'INV-1042': {
    id: 'INV-1042',
    customerId: 'C-204',
    total: 73000,
  },
}

export function resolveResource(tool: string, args: Record<string, unknown>): string | null {
  if (tool === 'invoice.lookup' || tool === 'refund.issue') {
    const invId = args['invoice_id'] as string | undefined
    if (!invId) return null
    const inv = KNOWN_INVOICES[invId]
    return inv ? inv.customerId : null
  }
  if (tool === 'customer.export') {
    const scope = args['scope'] as string | undefined
    return scope === 'all_customers' ? 'ALL' : (scope ?? null)
  }
  if (tool === 'payroll.export') {
    return 'payroll'
  }
  return null
}

export function getInvoiceTotal(invoiceId: string): number | null {
  return KNOWN_INVOICES[invoiceId]?.total ?? null
}

export interface ProposedCall {
  tool: ToolName
  args: Record<string, unknown>
  provenance: {
    label: string
    untrusted: boolean
  }
}

export interface CheckResult {
  id: string
  status: 'passed' | 'failed' | 'needs_approval'
  note: string
}

export interface PolicyEvaluation {
  decision: 'allowed' | 'needs_approval' | 'blocked'
  ruleId: string
  reason: string
  checks: CheckResult[]
  requiredReviewerRole: string | null
}

export function evaluatePolicy(
  call: ProposedCall,
  user: SessionUser,
  grant: TaskGrantRecord,
  policy: OrgPolicyConfig,
  now: Date = new Date(),
): PolicyEvaluation {
  // Normalize role to UI/policy string (e.g. 'Support Agent')
  const userRoleUi = ROLE_MAP[user.role] ?? user.role
  const dbRole = ROLE_MAP_REVERSE[userRoleUi] ?? user.role

  // Allowed tools for this role from org policy
  const roleTools = policy.roleTools[dbRole] ?? []
  const hasRoleAccess = roleTools.includes(call.tool)

  const reviewerRoleDb = policy.reviewerChain[dbRole] ?? null
  const reviewerRoleUi = reviewerRoleDb ? (ROLE_MAP[reviewerRoleDb] ?? reviewerRoleDb) : 'Reviewer'

  // 1. Role Access Check
  if (!hasRoleAccess) {
    const baseMsg = `${userRoleUi} role has no access to ${call.tool}. The tool was not called.`
    const reason = call.provenance.untrusted
      ? `Permissions come from the signed-in user, never from tool output. ${baseMsg}`
      : baseMsg

    return {
      decision: 'blocked',
      ruleId: 'role.tool_access',
      reason,
      checks: [
        { id: 'role_access', status: 'failed', note: reason },
        { id: 'task_scope', status: 'passed', note: 'Not evaluated (role check failed).' },
        { id: 'arg_limits', status: 'passed', note: 'Not evaluated (role check failed).' },
      ],
      requiredReviewerRole: null,
    }
  }

  // 2. Task Scope Check
  const grantValid = isGrantValid(grant, now)
  const resolvedRes = resolveResource(call.tool, call.args)
  const toolInGrant = grant.allowTools.includes(call.tool)
  const resourceInGrant =
    !resolvedRes ||
    grant.allowResources.includes('ALL') ||
    grant.allowResources.includes(resolvedRes)

  const inScope = grantValid && toolInGrant && resourceInGrant

  if (!inScope) {
    const reason = `${call.tool} is outside the task grant for ${grant.taskId}. Requires ${reviewerRoleUi} approval.`
    return {
      decision: 'needs_approval',
      ruleId: 'task.scope',
      reason,
      checks: [
        { id: 'role_access', status: 'passed', note: `${userRoleUi} may use ${call.tool}.` },
        { id: 'task_scope', status: 'needs_approval', note: reason },
        { id: 'arg_limits', status: 'passed', note: 'Within limits.' },
      ],
      requiredReviewerRole: reviewerRoleDb,
    }
  }

  // 3. Argument Limits Check
  if (call.tool === 'refund.issue') {
    const amount = Number(call.args['amount'] ?? 0)
    const invoiceId = call.args['invoice_id'] as string
    const invoiceTotal = getInvoiceTotal(invoiceId)

    // Hard ceiling: refund cannot exceed invoice total
    if (invoiceTotal !== null && amount > invoiceTotal) {
      const reason = `Refund amount ₹${amount.toLocaleString('en-IN')} exceeds the invoice total ₹${invoiceTotal.toLocaleString('en-IN')}. Blocked by hard policy limit.`
      return {
        decision: 'blocked',
        ruleId: 'args.refund_total',
        reason,
        checks: [
          { id: 'role_access', status: 'passed', note: `${userRoleUi} may use ${call.tool}.` },
          { id: 'task_scope', status: 'passed', note: 'Inside task grant.' },
          { id: 'arg_limits', status: 'failed', note: reason },
        ],
        requiredReviewerRole: null,
      }
    }

    // Soft threshold: requires approval above ₹2,000 (200000 minor units)
    const thresholdMajor = grant.requireApprovalAboveMinor / 100
    if (amount > thresholdMajor) {
      const reason = `Refund amount ₹${amount.toLocaleString('en-IN')} exceeds the auto-approval threshold of ₹${thresholdMajor.toLocaleString('en-IN')} for ${userRoleUi}. Requires ${reviewerRoleUi} approval.`
      return {
        decision: 'needs_approval',
        ruleId: 'args.refund_limit',
        reason,
        checks: [
          { id: 'role_access', status: 'passed', note: `${userRoleUi} may use ${call.tool}.` },
          { id: 'task_scope', status: 'passed', note: 'Inside task grant.' },
          { id: 'arg_limits', status: 'needs_approval', note: reason },
        ],
        requiredReviewerRole: reviewerRoleDb,
      }
    }
  }

  // All checks passed
  const reason = `${userRoleUi} role may use ${call.tool}, and the call is inside this task's grant.`
  return {
    decision: 'allowed',
    ruleId: 'allow.default',
    reason,
    checks: [
      { id: 'role_access', status: 'passed', note: `${userRoleUi} may use ${call.tool}.` },
      { id: 'task_scope', status: 'passed', note: 'Inside task grant.' },
      { id: 'arg_limits', status: 'passed', note: 'Within limits.' },
    ],
    requiredReviewerRole: null,
  }
}

export interface SubmitParams {
  call: ProposedCall
  user: SessionUser
  grant: TaskGrantRecord
  agentMode: 'simulated' | 'live'
  agentRunId?: string | undefined
  idempotencyKey?: string | undefined
  requestId?: string | undefined
  adapter?: ProviderAdapter | undefined
}

export interface SubmitResult {
  actionId: string
  decision: 'allowed' | 'needs_approval' | 'blocked'
  ruleId: string
  reason: string
  checks: CheckResult[]
  approvalId?: string | undefined
  execution?: {
    status: 'executed' | 'not_executed' | 'failed'
    data?: Record<string, unknown> | undefined
    error?: string | undefined
    providerReceiptId?: string | undefined
  } | undefined
  auditEvent: AuditEvent
}

export interface ResolveApprovalParams {
  approvalId: string
  reviewer: SessionUser
  outcome: 'approved' | 'denied'
  note?: string | undefined
  orgId: string
  adapter?: ProviderAdapter | undefined
  requestId?: string | undefined
}

export interface ResolveApprovalResult {
  approvalId: string
  status: 'approved' | 'denied'
  execution?: {
    status: 'executed' | 'not_executed' | 'failed'
    data?: Record<string, unknown> | undefined
    error?: string | undefined
    providerReceiptId?: string | undefined
  } | undefined
  auditEvent: AuditEvent
}

export class ServerGateway {
  private readonly sql: Sql
  private readonly auditLog: ServerAuditLog

  constructor(sql: Sql) {
    this.sql = sql
    this.auditLog = new ServerAuditLog(sql)
  }

  /**
   * Submit a proposed tool call for policy evaluation, approval creation, or execution.
   */
  async submit(params: SubmitParams): Promise<SubmitResult> {
    const policy = await loadOrgPolicy(params.user.orgId, this.sql)
    if (!policy) {
      throw new Error(`No active policy configured for organization ${params.user.orgId}`)
    }

    // 1. Evaluate policy
    const evalResult = evaluatePolicy(params.call, params.user, params.grant, policy)
    const actionId = randomUUID()
    const idempotencyKey = params.idempotencyKey ?? randomUUID()

    // 2. Persist proposed_action and initial audit event in a transaction
    let approvalId: string | undefined
    let auditEvent!: AuditEvent

    await this.sql.begin(async (trx) => {
      const runner = trx as unknown as Sql

      await runner`
        INSERT INTO proposed_actions (
          id, org_id, user_id, agent_run_id, grant_id, policy_version_id,
          tool, args, args_redacted, provenance_label, provenance_untrusted,
          decision, rule_id, reason, checks, idempotency_key
        ) VALUES (
          ${actionId}, ${params.user.orgId}, ${params.user.id},
          ${params.agentRunId ?? null}, ${params.grant.id}, ${policy.versionId},
          ${params.call.tool},
          ${JSON.stringify(params.call.args)}::jsonb,
          ${JSON.stringify(params.call.args)}::jsonb,
          ${params.call.provenance.label}, ${params.call.provenance.untrusted},
          ${evalResult.decision}, ${evalResult.ruleId}, ${evalResult.reason},
          ${JSON.stringify(evalResult.checks)}::jsonb,
          ${idempotencyKey}
        )
      `

      // If needs_approval, create approval_request
      if (evalResult.decision === 'needs_approval') {
        approvalId = randomUUID()
        const requiredRole = evalResult.requiredReviewerRole ?? 'support_lead'

        await runner`
          INSERT INTO approval_requests (
            id, org_id, action_id, requester_id, required_reviewer_role,
            status, frozen_call, expires_at
          ) VALUES (
            ${approvalId}, ${params.user.orgId}, ${actionId}, ${params.user.id},
            ${requiredRole}, 'pending',
            ${JSON.stringify(params.call)}::jsonb,
            NOW() + INTERVAL '24 hours'
          )
        `
      }

      // Record policy decision in audit log
      auditEvent = await this.auditLog.append(
        {
          orgId: params.user.orgId,
          actorId: params.user.id,
          actorName: params.user.name,
          actorRole: params.user.role,
          taskId: params.grant.taskId,
          actionId,
          approvalId,
          agentMode: params.agentMode,
          eventType: 'decision',
          tool: params.call.tool,
          argsRedacted: params.call.args,
          provenanceLabel: params.call.provenance.label,
          provenanceUntrusted: params.call.provenance.untrusted,
          decision: evalResult.decision,
          ruleId: evalResult.ruleId,
          policyVersionId: policy.versionId,
          reason: evalResult.reason,
          checks: evalResult.checks,
          executionStatus: evalResult.decision === 'allowed' ? 'pending' : 'not_executed',
          requestId: params.requestId,
        },
        trx,
      )
    })

    // 3. If allowed, execute immediately via adapter
    if (evalResult.decision === 'allowed' && params.adapter) {
      const execId = randomUUID()
      let toolRes: ToolResult

      try {
        toolRes = await params.adapter.execute(
          params.call.tool,
          params.call.args,
          idempotencyKey,
          params.user.orgId,
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        toolRes = { ok: false, error: errorMsg }
      }

      const execStatus = toolRes.ok ? 'executed' : 'failed'

      // Record execution attempt and audit event
      await this.sql.begin(async (trx) => {
        const runner = trx as unknown as Sql
        await runner`
          INSERT INTO execution_attempts (
            id, org_id, action_id, attempt_number, status,
            provider_receipt_id, provider_response, error_message,
            idempotency_key, started_at, completed_at
          ) VALUES (
            ${execId}, ${params.user.orgId}, ${actionId}, 1, ${execStatus},
            ${toolRes.providerReceiptId ?? null},
            ${toolRes.data ? JSON.stringify(toolRes.data) : null}::jsonb,
            ${toolRes.error ?? null},
            ${idempotencyKey}, NOW(), NOW()
          )
        `

        await this.auditLog.append(
          {
            orgId: params.user.orgId,
            actorId: params.user.id,
            actorName: params.user.name,
            actorRole: params.user.role,
            taskId: params.grant.taskId,
            actionId,
            executionId: execId,
            agentMode: params.agentMode,
            eventType: 'execution_outcome',
            tool: params.call.tool,
            argsRedacted: params.call.args,
            executionStatus: execStatus,
            providerReceiptId: toolRes.providerReceiptId,
            requestId: params.requestId,
          },
          trx,
        )
      })

      const res: SubmitResult = {
        actionId,
        decision: evalResult.decision,
        ruleId: evalResult.ruleId,
        reason: evalResult.reason,
        checks: evalResult.checks,
        execution: {
          status: execStatus,
          data: toolRes.data,
          error: toolRes.error,
          providerReceiptId: toolRes.providerReceiptId,
        },
        auditEvent,
      }
      if (approvalId !== undefined) {
        res.approvalId = approvalId
      }
      return res
    }

    const res: SubmitResult = {
      actionId,
      decision: evalResult.decision,
      ruleId: evalResult.ruleId,
      reason: evalResult.reason,
      checks: evalResult.checks,
      execution: {
        status: 'not_executed',
      },
      auditEvent,
    }
    if (approvalId !== undefined) {
      res.approvalId = approvalId
    }
    return res
  }

  /**
   * Resolve an approval request (approve or deny).
   */
  async resolveApproval(params: ResolveApprovalParams): Promise<ResolveApprovalResult> {
    // 1. Fetch approval request
    const approvals = await this.sql<Array<{
      id: string
      orgId: string
      actionId: string
      requesterId: string
      requiredReviewerRole: string
      status: string
      frozenCall: ProposedCall
      expiresAt: Date
    }>>`
      SELECT id, org_id AS "orgId", action_id AS "actionId",
             requester_id AS "requesterId",
             required_reviewer_role AS "requiredReviewerRole",
             status, frozen_call AS "frozenCall", expires_at AS "expiresAt"
      FROM approval_requests
      WHERE id = ${params.approvalId} AND org_id = ${params.orgId}
      LIMIT 1
    `

    const approval = approvals[0]
    if (!approval) {
      throw new Error(`Approval request ${params.approvalId} not found`)
    }

    if (approval.status !== 'pending') {
      throw new Error(`Approval request ${params.approvalId} is already resolved (status: ${approval.status})`)
    }

    if (new Date(approval.expiresAt) <= new Date()) {
      throw new Error(`Approval request ${params.approvalId} has expired`)
    }

    // Security invariant: Self-approval is rejected
    if (approval.requesterId === params.reviewer.id) {
      throw new Error('Self-approval is forbidden: requester cannot review their own request')
    }

    // Security invariant: Role matching
    const reviewerRoleDb = params.reviewer.role
    if (reviewerRoleDb !== approval.requiredReviewerRole) {
      throw new Error(
        `Reviewer role '${reviewerRoleDb}' is not authorized to review this request. Required role: '${approval.requiredReviewerRole}'`,
      )
    }

    // Deny requires a note
    if (params.outcome === 'denied' && (!params.note || params.note.trim() === '')) {
      throw new Error('A denial note is required when rejecting a request')
    }

    let auditEvent!: AuditEvent

    // 2. Update approval and record audit event
    await this.sql.begin(async (trx) => {
      const runner = trx as unknown as Sql

      await runner`
        UPDATE approval_requests
        SET status = ${params.outcome},
            reviewer_id = ${params.reviewer.id},
            denial_note = ${params.note ?? null},
            resolved_at = NOW()
        WHERE id = ${params.approvalId}
      `

      auditEvent = await this.auditLog.append(
        {
          orgId: params.orgId,
          actorId: params.reviewer.id,
          actorName: params.reviewer.name,
          actorRole: params.reviewer.role,
          actionId: approval.actionId,
          approvalId: params.approvalId,
          agentMode: 'simulated',
          eventType: 'approval_outcome',
          tool: approval.frozenCall.tool,
          argsRedacted: approval.frozenCall.args,
          reviewerId: params.reviewer.id,
          reviewerName: params.reviewer.name,
          reviewerRole: params.reviewer.role,
          approvalOutcome: params.outcome,
          denialNote: params.note,
          executionStatus: params.outcome === 'approved' ? 'pending' : 'not_executed',
          requestId: params.requestId,
        },
        trx,
      )
    })

    // 3. If approved and adapter provided, execute tool call
    if (params.outcome === 'approved' && params.adapter) {
      const execId = randomUUID()
      const idempotencyKey = randomUUID()
      let toolRes: ToolResult

      try {
        toolRes = await params.adapter.execute(
          approval.frozenCall.tool,
          approval.frozenCall.args,
          idempotencyKey,
          params.orgId,
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        toolRes = { ok: false, error: errorMsg }
      }

      const execStatus = toolRes.ok ? 'executed' : 'failed'

      await this.sql.begin(async (trx) => {
        const runner = trx as unknown as Sql
        await runner`
          INSERT INTO execution_attempts (
            id, org_id, action_id, approval_id, attempt_number, status,
            provider_receipt_id, provider_response, error_message,
            idempotency_key, started_at, completed_at
          ) VALUES (
            ${execId}, ${params.orgId}, ${approval.actionId}, ${params.approvalId}, 1, ${execStatus},
            ${toolRes.providerReceiptId ?? null},
            ${toolRes.data ? JSON.stringify(toolRes.data) : null}::jsonb,
            ${toolRes.error ?? null},
            ${idempotencyKey}, NOW(), NOW()
          )
        `

        await this.auditLog.append(
          {
            orgId: params.orgId,
            actorId: params.reviewer.id,
            actorName: params.reviewer.name,
            actorRole: params.reviewer.role,
            actionId: approval.actionId,
            approvalId: params.approvalId,
            executionId: execId,
            agentMode: 'simulated',
            eventType: 'execution_outcome',
            tool: approval.frozenCall.tool,
            argsRedacted: approval.frozenCall.args,
            executionStatus: execStatus,
            providerReceiptId: toolRes.providerReceiptId,
            requestId: params.requestId,
          },
          trx,
        )
      })

      return {
        approvalId: params.approvalId,
        status: params.outcome,
        execution: {
          status: execStatus,
          data: toolRes.data,
          error: toolRes.error,
          providerReceiptId: toolRes.providerReceiptId,
        },
        auditEvent,
      }
    }

    return {
      approvalId: params.approvalId,
      status: params.outcome,
      execution: {
        status: 'not_executed',
      },
      auditEvent,
    }
  }
}
