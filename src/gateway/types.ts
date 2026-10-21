// Gateway-internal types — not imported by components, screens or state
export type Role = 'Support Agent' | 'Support Lead' | 'Ops Manager' | 'Finance Admin'
export type ToolName = 'invoice.lookup' | 'refund.issue' | 'customer.export' | 'payroll.export'
export type Decision = 'allowed' | 'needs_approval' | 'blocked'
export type CheckStatus = 'passed' | 'failed' | 'not_evaluated'
export type AgentMode = 'simulated' | 'live'

export interface GatewayUser {
  id: string
  name: string
  role: Role
}

export interface Provenance {
  label: string
  untrusted: boolean
}

export interface ToolCall {
  tool: ToolName
  args: Record<string, unknown>
  provenance: Provenance
}

export type CheckId = 'role_access' | 'task_scope' | 'arg_limits'

export interface CheckResult {
  id: CheckId
  status: CheckStatus
  note: string
}

export interface PolicyDecision {
  decision: Decision
  ruleId: string
  reason: string
  checks: CheckResult[]
}

export interface TaskGrant {
  taskId: string
  userId: string
  allowTools: ToolName[]
  /** Customer IDs, or 'ALL' for all customers, or 'payroll' for payroll resource */
  allowResources: string[]
  limits: {
    /** Amount above which refund.issue requires approval (default ₹2,000) */
    requireApprovalAbove: number
  }
  issuedAt: Date
  expiresAt: Date
}

export interface EvalContext {
  user: GatewayUser
  grant: TaskGrant
  agentMode: AgentMode
}

export interface ToolExecutionResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
}

import type { GatewayAuditEntry } from './audit'

export interface SubmitResult {
  decision: Decision
  ruleId: string
  reason: string
  checks: CheckResult[]
  execution: {
    status: 'executed' | 'not_executed' | 'pending'
    result?: ToolExecutionResult
  }
  /** Populated when decision is needs_approval (Phase 3) */
  approvalId?: string
  auditEntry?: GatewayAuditEntry
}

export interface ApprovalRecord {
  id: string
  eventId: string
  call: ToolCall
  context: EvalContext
  decision: PolicyDecision
  requiredReviewerRole: Role
  status: 'pending' | 'approved' | 'denied'
  note: string | null
  executionResult?: ToolExecutionResult
}

export interface ResolveApprovalInput {
  approvalId: string
  reviewerId?: string
  reviewer?: GatewayUser
  outcome: 'approve' | 'deny'
  note: string
}

export type ResolveApprovalResult =
  | { ok: true; executionResult?: ToolExecutionResult; auditEntry?: GatewayAuditEntry }
  | { ok: false; error: 'not_found' | 'already_resolved' | 'self_approval' | 'wrong_role' | 'deny_needs_note' }
