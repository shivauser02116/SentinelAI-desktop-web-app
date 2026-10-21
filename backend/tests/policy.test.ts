import { describe, it, expect } from 'vitest'
import { evaluatePolicy, type ProposedCall } from '../src/gateway/gateway.js'
import type { SessionUser } from '../src/auth/session.js'
import type { TaskGrantRecord } from '../src/gateway/grants.js'
import type { OrgPolicyConfig } from '../src/gateway/policy.js'

describe('Server Policy Evaluation', () => {
  const defaultPolicy: OrgPolicyConfig = {
    roleTools: {
      support_agent: ['invoice.lookup', 'refund.issue'],
      support_lead: ['invoice.lookup', 'refund.issue', 'customer.export'],
      finance_admin: ['payroll.export'],
      ops_manager: [],
    },
    reviewerChain: {
      support_agent: 'support_lead',
      support_lead: 'ops_manager',
    },
    refundApprovalThresholdMinorUnits: 200000, // ₹2,000
    version: 1,
    versionId: '00000000-0000-0000-0000-000000000002',
  }

  const supportAgentUser: SessionUser = {
    id: 'u-1',
    orgId: 'org-1',
    email: 'rohan@example.com',
    name: 'Rohan Joshi',
    role: 'support_agent',
    initials: 'RJ',
  }

  const supportLeadUser: SessionUser = {
    id: 'u-2',
    orgId: 'org-1',
    email: 'priya@example.com',
    name: 'Priya Sharma',
    role: 'support_lead',
    initials: 'PS',
  }

  const validGrant: TaskGrantRecord = {
    id: 'g-1',
    orgId: 'org-1',
    userId: 'u-1',
    policyVersionId: defaultPolicy.versionId,
    taskId: 'TSK-101',
    taskTitle: 'Investigate invoice dispute',
    allowTools: ['invoice.lookup', 'refund.issue'],
    allowResources: ['C-204'],
    requireApprovalAboveMinor: 200000,
    issuedAt: new Date(Date.now() - 60000),
    expiresAt: new Date(Date.now() + 840000),
    revokedAt: null,
    revocationReason: null,
  }

  it('allows safe tool call inside grant and within limits (invoice.lookup)', () => {
    const call: ProposedCall = {
      tool: 'invoice.lookup',
      args: { invoice_id: 'INV-1042' },
      provenance: { label: 'Customer ticket', untrusted: false },
    }

    const result = evaluatePolicy(call, supportAgentUser, validGrant, defaultPolicy)
    expect(result.decision).toBe('allowed')
    expect(result.ruleId).toBe('allow.default')
    expect(result.checks.every((c) => c.status === 'passed')).toBe(true)
  })

  it('allows refund under ₹2,000 threshold within grant', () => {
    const call: ProposedCall = {
      tool: 'refund.issue',
      args: { invoice_id: 'INV-1042', amount: 1500, currency: 'INR' },
      provenance: { label: 'Customer ticket', untrusted: false },
    }

    const result = evaluatePolicy(call, supportAgentUser, validGrant, defaultPolicy)
    expect(result.decision).toBe('allowed')
    expect(result.ruleId).toBe('allow.default')
  })

  it('requires approval for refund exceeding ₹2,000 threshold', () => {
    const call: ProposedCall = {
      tool: 'refund.issue',
      args: { invoice_id: 'INV-1042', amount: 25000, currency: 'INR' },
      provenance: { label: 'Customer ticket', untrusted: false },
    }

    const result = evaluatePolicy(call, supportAgentUser, validGrant, defaultPolicy)
    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('args.refund_limit')
    expect(result.requiredReviewerRole).toBe('support_lead')
  })

  it('blocks refund exceeding total invoice value (hard limit)', () => {
    const call: ProposedCall = {
      tool: 'refund.issue',
      args: { invoice_id: 'INV-1042', amount: 80000, currency: 'INR' }, // invoice total is 73,000
      provenance: { label: 'Customer ticket', untrusted: false },
    }

    const result = evaluatePolicy(call, supportAgentUser, validGrant, defaultPolicy)
    expect(result.decision).toBe('blocked')
    expect(result.ruleId).toBe('args.refund_total')
    expect(result.requiredReviewerRole).toBeNull()
  })

  it('blocks tool call when role lacks access (payroll.export for support_agent)', () => {
    const call: ProposedCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv' },
      provenance: { label: 'Direct request', untrusted: false },
    }

    const result = evaluatePolicy(call, supportAgentUser, validGrant, defaultPolicy)
    expect(result.decision).toBe('blocked')
    expect(result.ruleId).toBe('role.tool_access')
    expect(result.reason).toContain('Support Agent role has no access to payroll.export')
  })

  it('prepends untrusted provenance warning when agent read prompt injection', () => {
    const call: ProposedCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv' },
      provenance: { label: 'Dispute attachment page 3', untrusted: true },
    }

    const result = evaluatePolicy(call, supportAgentUser, validGrant, defaultPolicy)
    expect(result.decision).toBe('blocked')
    expect(result.ruleId).toBe('role.tool_access')
    expect(result.reason).toContain('Permissions come from the signed-in user, never from tool output.')
  })

  it('requires approval when tool is outside task grant (scope drift)', () => {
    // customer.export is permitted for Support Lead's role, but NOT in this task grant
    const call: ProposedCall = {
      tool: 'customer.export',
      args: { scope: 'all_customers', fields: ['name', 'email'] },
      provenance: { label: 'Team message', untrusted: false },
    }

    const result = evaluatePolicy(call, supportLeadUser, validGrant, defaultPolicy)
    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('task.scope')
    expect(result.requiredReviewerRole).toBe('ops_manager')
  })

  it('requires approval when task grant is expired', () => {
    const expiredGrant: TaskGrantRecord = {
      ...validGrant,
      expiresAt: new Date(Date.now() - 10000), // 10 seconds ago
    }

    const call: ProposedCall = {
      tool: 'invoice.lookup',
      args: { invoice_id: 'INV-1042' },
      provenance: { label: 'Ticket', untrusted: false },
    }

    const result = evaluatePolicy(call, supportAgentUser, expiredGrant, defaultPolicy)
    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('task.scope')
  })

  it('requires approval when task grant has been revoked', () => {
    const revokedGrant: TaskGrantRecord = {
      ...validGrant,
      revokedAt: new Date(),
      revocationReason: 'Task reassigned to colleague',
    }

    const call: ProposedCall = {
      tool: 'invoice.lookup',
      args: { invoice_id: 'INV-1042' },
      provenance: { label: 'Ticket', untrusted: false },
    }

    const result = evaluatePolicy(call, supportAgentUser, revokedGrant, defaultPolicy)
    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('task.scope')
  })
})
