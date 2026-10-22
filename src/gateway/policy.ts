/**
 * Pure policy engine — no side effects, no async.
 * evaluate(call, context, now) → PolicyDecision
 *
 * Evaluation order (first failing check wins):
 *   1. Role access     → Blocked      (rule: role.tool_access)
 *   2. Task scope      → Needs approval (rule: task.scope)
 *   3. Argument limits → Needs approval (rule: args.refund_limit)
 *                     → Blocked       (rule: args.refund_total)
 *   4. None failed     → Allowed       (rule: allow.default)
 */
import type { ToolCall, EvalContext, PolicyDecision, CheckResult, Decision, CheckStatus } from './types'
import type { Role, ToolName } from './types'
import { getInvoice, getCustomerForInvoice } from './mockDb'
import { isGrantExpired, isToolInGrant, isResourceInGrant, formatExpiry } from './grants'

// ---------------------------------------------------------------------------
// Role-access table
// ---------------------------------------------------------------------------
const ROLE_TOOLS: Record<Role, ToolName[]> = {
  'Support Agent': ['invoice.lookup', 'refund.issue'],
  'Support Lead': ['invoice.lookup', 'refund.issue', 'customer.export'],
  'Finance Admin': ['payroll.export'],
  'Ops Manager': [],
}

export const COMPANY_DOMAIN = '@sentinel-demo.example'

function roleCanUseTool(role: Role, tool: ToolName): boolean {
  return ROLE_TOOLS[role].includes(tool)
}

// ---------------------------------------------------------------------------
// Resource resolution
// ---------------------------------------------------------------------------
/** Returns the logical resource identifier the call acts on. */
function resolveResource(call: ToolCall): string {
  const { tool, args } = call
  if (tool === 'invoice.lookup' || tool === 'refund.issue') {
    const invoiceId = args['invoice_id'] as string | undefined
    if (invoiceId) {
      const customerId = getCustomerForInvoice(invoiceId)
      if (customerId) return customerId
    }
    // Fallback to explicit customer_id if present
    const customerId = args['customer_id'] as string | undefined
    return customerId ?? 'unknown'
  }
  if (tool === 'customer.export') {
    const scope = args['scope'] as string | undefined
    if (scope === 'all_customers') return 'ALL'
    return scope ?? 'unknown'
  }
  if (tool === 'payroll.export') return 'payroll'
  return 'unknown'
}

/** Human-readable description of a resolved resource for use in notes. */
function describeResource(resource: string): string {
  if (resource === 'ALL') return 'all customers'
  if (resource === 'payroll') return 'payroll'
  return resource
}

// ---------------------------------------------------------------------------
// Number formatter (INR style: ₹25,000)
// ---------------------------------------------------------------------------
const _fmt = new Intl.NumberFormat('en-IN')
function fmtINR(n: number): string {
  return `₹${_fmt.format(n)}`
}

// ---------------------------------------------------------------------------
// Tool list formatter ("a and b" or "a, b and c")
// ---------------------------------------------------------------------------
function joinTools(tools: ToolName[]): string {
  if (tools.length === 0) return '(none)'
  if (tools.length === 1) return tools[0]
  const last = tools[tools.length - 1]
  const rest = tools.slice(0, -1)
  return `${rest.join(', ')} and ${last}`
}

// ---------------------------------------------------------------------------
// Resource list formatter for reason strings ("customer C-204")
// ---------------------------------------------------------------------------
function describeGrantResources(resources: string[]): string {
  const filtered = resources.filter((r) => r !== 'ALL' && r !== 'payroll')
  if (filtered.length === 0) return resources.join(', ')
  if (filtered.length === 1) return `customer ${filtered[0]}`
  return `customers ${filtered.slice(0, -1).join(', ')} and ${filtered[filtered.length - 1]}`
}

// ---------------------------------------------------------------------------
// Check builders
// ---------------------------------------------------------------------------
function check(id: CheckResult['id'], status: CheckStatus, note: string): CheckResult {
  return { id, status, note }
}

const NOT_EVALUATED = 'Not evaluated.'

// ---------------------------------------------------------------------------
// evaluate()
// ---------------------------------------------------------------------------
export function evaluate(call: ToolCall, ctx: EvalContext, now: Date): PolicyDecision {
  const { tool, provenance } = call
  const { user, grant } = ctx
  const { role, name: _name } = user
  const roleLabel = role

  // ── Check 1: Role access ──────────────────────────────────────────────────
  const roleAllows = roleCanUseTool(role, tool)
  if (!roleAllows) {
    const baseReason = `${roleLabel} role has no access to ${tool}. The tool was not called.`
    const reason = provenance.untrusted
      ? `Permissions come from the signed-in user, not from text the agent read. ${baseReason}`
      : baseReason
    return {
      decision: 'blocked',
      ruleId: 'role.tool_access',
      reason,
      checks: [
        check('role_access', 'failed', `${roleLabel} has no access to ${tool}.`),
        check('task_scope', 'not_evaluated', NOT_EVALUATED),
        check('arg_limits', 'not_evaluated', NOT_EVALUATED),
        check('input_source', 'not_evaluated', NOT_EVALUATED),
      ],
    }
  }

  // ── Check 2: Task scope ──────────────────────────────────────────────────
  // 2a. Grant expiry
  if (isGrantExpired(grant, now)) {
    const expiry = formatExpiry(grant)
    return {
      decision: 'needs_approval',
      ruleId: 'task.scope',
      reason: `The task grant expired at ${expiry}. The call is outside the task grant.`,
      checks: [
        check('role_access', 'passed', `${roleLabel} may use ${tool}.`),
        check('task_scope', 'failed', `Grant expired at ${expiry}.`),
        check('arg_limits', 'not_evaluated', NOT_EVALUATED),
        check('input_source', 'not_evaluated', NOT_EVALUATED),
      ],
    }
  }

  // 2b. Tool not in grant
  const toolInGrant = isToolInGrant(grant, tool)
  // 2c. Resource not in grant
  const resource = resolveResource(call)
  const resourceInGrant = isResourceInGrant(grant, resource)

  if (!toolInGrant || !resourceInGrant) {
    const grantToolsDesc = joinTools(grant.allowTools)
    const grantResourcesDesc = describeGrantResources(grant.allowResources)
    const targetDesc = describeResource(resource)

    const reason =
      `${roleLabel} role allows ${tool}, but this task only covers ${grantResourcesDesc}` +
      ` and the tools ${grantToolsDesc}. The call is outside the task grant.`

    const scopeNote =
      `Not in task grant. The grant covers ${grantToolsDesc} on ${grantResourcesDesc}.` +
      ` This call targets ${targetDesc}.`

    return {
      decision: 'needs_approval',
      ruleId: 'task.scope',
      reason,
      checks: [
        check('role_access', 'passed', `${roleLabel} may use ${tool}.`),
        check('task_scope', 'failed', scopeNote),
        check('arg_limits', 'not_evaluated', NOT_EVALUATED),
        check('input_source', 'not_evaluated', NOT_EVALUATED),
      ],
    }
  }

  // ── Check 3: Argument limits (refund.issue only) ─────────────────────────
  if (tool === 'refund.issue') {
    const amount = call.args['amount'] as number
    const invoiceId = call.args['invoice_id'] as string
    const invoice = getInvoice(invoiceId)
    const invoiceTotal = invoice?.total ?? 0

    // Hard block: refund > invoice total
    if (amount > invoiceTotal) {
      return {
        decision: 'blocked',
        ruleId: 'args.refund_total',
        reason: `Refund of ${fmtINR(amount)} is more than the invoice total of ${fmtINR(invoiceTotal)}. Approval cannot override this limit.`,
        checks: [
          check('role_access', 'passed', `${roleLabel} may use ${tool}.`),
          check('task_scope', 'passed', `Inside task grant: ${tool} on ${resource}.`),
          check('arg_limits', 'failed', `Refund of ${fmtINR(amount)} exceeds the invoice total of ${fmtINR(invoiceTotal)}.`),
          check('input_source', 'not_evaluated', NOT_EVALUATED),
        ],
      }
    }

    // Soft limit: refund > approval threshold
    if (amount > grant.limits.requireApprovalAbove) {
      return {
        decision: 'needs_approval',
        ruleId: 'args.refund_limit',
        reason: `Refund of ${fmtINR(amount)} is above the ${fmtINR(grant.limits.requireApprovalAbove)} limit for refunds without approval.`,
        checks: [
          check('role_access', 'passed', `${roleLabel} may use ${tool}.`),
          check('task_scope', 'passed', `Inside task grant: ${tool} on ${resource}.`),
          check(
            'arg_limits',
            'failed',
            `${fmtINR(amount)} is above the ${fmtINR(grant.limits.requireApprovalAbove)} limit for refunds without approval. Invoice total is ${fmtINR(invoiceTotal)}.`,
          ),
          check('input_source', 'not_evaluated', NOT_EVALUATED),
        ],
      }
    }
  }

  // Export destination rule for payroll.export and customer.export
  if (tool === 'payroll.export' || tool === 'customer.export') {
    const destination = call.args['destination'] as string | undefined
    const isInternal =
      !destination ||
      destination === 'download' ||
      (typeof destination === 'string' && destination.endsWith(COMPANY_DOMAIN))
    if (!isInternal) {
      return {
        decision: 'needs_approval',
        ruleId: 'args.export_destination',
        reason: `Export destination ${destination} is outside the company domain.`,
        checks: [
          check('role_access', 'passed', `${roleLabel} may use ${tool}.`),
          check('task_scope', 'passed', `Inside task grant: ${tool} on ${resource}.`),
          check('arg_limits', 'failed', `Destination ${destination} is outside the company domain (${COMPANY_DOMAIN}).`),
          check('input_source', 'not_evaluated', NOT_EVALUATED),
        ],
      }
    }
  }

  let limitsPassedNote = 'No limits apply to these arguments.'
  if (tool === 'refund.issue') {
    const amount = call.args['amount'] as number
    limitsPassedNote = `${fmtINR(amount)} is within the ${fmtINR(grant.limits.requireApprovalAbove)} limit for refunds without approval.`
  }

  // ── Check 4: Input source ────────────────────────────────────────────────
  if (provenance.untrusted && tool !== 'invoice.lookup') {
    return {
      decision: 'needs_approval',
      ruleId: 'source.untrusted_input',
      reason: 'This call was proposed after reading untrusted text. A reviewer must confirm it.',
      checks: [
        check('role_access', 'passed', `${roleLabel} may use ${tool}.`),
        check('task_scope', 'passed', `Inside task grant: ${tool} on ${resource}.`),
        check('arg_limits', 'passed', limitsPassedNote),
        check('input_source', 'failed', `Proposed after reading untrusted text (${provenance.label}).`),
      ],
    }
  }

  const inputSourceNote = provenance.untrusted
    ? 'Read-only call. Untrusted input is allowed here.'
    : `Proposed from ${provenance.label}.`

  // ── Allowed ───────────────────────────────────────────────────────────────
  return {
    decision: 'allowed',
    ruleId: 'allow.default',
    reason: `${roleLabel} role may use ${tool}, and the call is inside this task's grant.`,
    checks: [
      check('role_access', 'passed', `${roleLabel} may use ${tool}.`),
      check('task_scope', 'passed', `Inside task grant: ${tool} on ${resource}.`),
      check('arg_limits', 'passed', limitsPassedNote),
      check('input_source', 'passed', inputSourceNote),
    ],
  }
}
