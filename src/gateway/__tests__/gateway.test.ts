/**
 * Gateway tests — submit decision layer & audit chain
 *
 * Tests covered:
 *  1.  S1: invoice.lookup → Allowed, callCount 1
 *  2.  S2 (decision): refund ₹25,000 → Needs approval, callCount 0
 *  3.  S3: payroll.export by Support Agent → Blocked, callCount 0
 *  4.  S4: untrusted provenance → prefix in reason, provenance.untrusted true
 *  5.  S5 (decision): customer.export by Support Lead → Needs approval, task.scope
 *  6.  Finance Admin payroll.export → Allowed
 *  7.  Boundary: ₹2,000 Allowed; ₹2,001 Needs approval; >₹73,000 Blocked
 *  8.  Expired grant → Needs approval with expiry reason
 * 10.  Tampering with one stored audit entry makes verifyChain return brokenAt equal to that index
 * 12.  Scenario outputs match baked expected values in scenarios.ts
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Gateway } from '../gateway'
import { issueGrant } from '../grants'
import { resetCounters } from '../mockDb'
import { canonicalJSON, computeHash, verifyChain, GENESIS_HASH, AuditLog } from '../audit'
import { tamperDemo, reset as resetTamper } from '../../demo/tamper'
import type { GatewayUser, ToolCall, EvalContext, TaskGrant } from '../types'
import { SCENARIOS, USERS } from '../../data/scenarios'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ROHAN: GatewayUser = { id: 'u-rohan', name: 'Rohan Mehta', role: 'Support Agent' }
const PRIYA: GatewayUser = { id: 'u-priya', name: 'Priya Nair', role: 'Support Lead' }
const DEV: GatewayUser = { id: 'u-dev', name: 'Dev Malhotra', role: 'Ops Manager' }
const ANITA: GatewayUser = { id: 'u-anita', name: 'Anita Rao', role: 'Finance Admin' }

/** Standard task grant for Rohan (S1–S4 scenarios) */
function standardGrant(overrides?: Partial<{ taskId: string; now: () => Date }>): TaskGrant {
  return issueGrant({
    taskId: overrides?.taskId ?? 'TASK-1001',
    userId: 'u-rohan',
    allowTools: ['invoice.lookup', 'refund.issue'],
    allowResources: ['C-204'],
    now: overrides?.now,
  })
}

/** Standard task grant for Priya (S5) — excludes customer.export from allowed tools */
function priyaGrant(): TaskGrant {
  return issueGrant({
    taskId: 'TASK-1005',
    userId: 'u-priya',
    allowTools: ['invoice.lookup', 'refund.issue'],
    allowResources: ['C-204'],
  })
}

/** Task grant for Finance Admin */
function financeGrant(): TaskGrant {
  return issueGrant({
    taskId: 'TASK-FIN',
    userId: 'u-anita',
    allowTools: ['payroll.export'],
    allowResources: ['payroll'],
  })
}

function makeCtx(user: GatewayUser, grant: TaskGrant): EvalContext {
  return { user, grant, agentMode: 'simulated' }
}

// ---------------------------------------------------------------------------
// Test 1: S1 — invoice.lookup → Allowed, callCount 1
// ---------------------------------------------------------------------------
describe('Test 1 — S1 invoice.lookup: Allowed', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  it('returns Allowed decision', async () => {
    const call: ToolCall = {
      tool: 'invoice.lookup',
      args: { invoice_id: 'INV-1042', customer_id: 'C-204' },
      provenance: { label: 'Your request', untrusted: false },
    }
    const result = await gw.submit(call, makeCtx(ROHAN, standardGrant()))
    expect(result.decision).toBe('allowed')
    expect(result.ruleId).toBe('allow.default')
  })

  it('increments callCount to 1', async () => {
    const call: ToolCall = {
      tool: 'invoice.lookup',
      args: { invoice_id: 'INV-1042', customer_id: 'C-204' },
      provenance: { label: 'Your request', untrusted: false },
    }
    await gw.submit(call, makeCtx(ROHAN, standardGrant()))
    expect(gw.getCallCount('invoice.lookup')).toBe(1)
  })

  it('execution status is executed', async () => {
    const call: ToolCall = {
      tool: 'invoice.lookup',
      args: { invoice_id: 'INV-1042', customer_id: 'C-204' },
      provenance: { label: 'Your request', untrusted: false },
    }
    const result = await gw.submit(call, makeCtx(ROHAN, standardGrant()))
    expect(result.execution.status).toBe('executed')
    expect(result.execution.result?.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 2: S2 — refund ₹25,000: Needs approval & resolution
// ---------------------------------------------------------------------------
describe('Test 2 — S2 refund ₹25,000: Needs approval & resolution', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  it('returns needs_approval decision and tool callCount is 0 initially', async () => {
    const call: ToolCall = {
      tool: 'refund.issue',
      args: { invoice_id: 'INV-1042', amount: 25000, currency: 'INR', reason: 'Duplicate charge' },
      provenance: { label: 'Your request', untrusted: false },
    }
    const result = await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1002' })))
    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('args.refund_limit')
    expect(gw.getCallCount('refund.issue')).toBe(0)
    expect(result.execution.status).toBe('pending')
    expect(result.approvalId).toBeDefined()
  })

  it('approve gives callCount 1 and an audit entry with the reviewer', async () => {
    const call: ToolCall = {
      tool: 'refund.issue',
      args: { invoice_id: 'INV-1042', amount: 25000, currency: 'INR', reason: 'Duplicate charge' },
      provenance: { label: 'Your request', untrusted: false },
    }
    const submitResult = await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1002' })))
    const approvalId = submitResult.approvalId!

    const res = await gw.resolveApproval({
      approvalId,
      reviewer: PRIYA,
      outcome: 'approve',
      note: 'Verified duplicate charge',
    })

    expect(res.ok).toBe(true)
    expect(gw.getCallCount('refund.issue')).toBe(1)

    // Check audit entries: should have initial decision + approval_outcome
    const entries = gw.audit.getAll()
    expect(entries.length).toBe(2)
    const outcomeEntry = entries[1]
    expect(outcomeEntry.type).toBe('approval_outcome')
    expect(outcomeEntry.reviewer?.name).toBe('Priya Nair')
    expect(outcomeEntry.reviewer?.role).toBe('Support Lead')
    expect(outcomeEntry.reviewer?.outcome).toBe('approve')
    expect(outcomeEntry.execution.status).toBe('executed')
  })

  it('deny keeps callCount 0 and logs approval_outcome entry', async () => {
    const call: ToolCall = {
      tool: 'refund.issue',
      args: { invoice_id: 'INV-1042', amount: 25000, currency: 'INR', reason: 'Duplicate charge' },
      provenance: { label: 'Your request', untrusted: false },
    }
    const submitResult = await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1002' })))
    const approvalId = submitResult.approvalId!

    const res = await gw.resolveApproval({
      approvalId,
      reviewer: PRIYA,
      outcome: 'deny',
      note: 'Customer not eligible for refund',
    })

    expect(res.ok).toBe(true)
    expect(gw.getCallCount('refund.issue')).toBe(0)

    const entries = gw.audit.getAll()
    expect(entries.length).toBe(2)
    const outcomeEntry = entries[1]
    expect(outcomeEntry.type).toBe('approval_outcome')
    expect(outcomeEntry.reviewer?.name).toBe('Priya Nair')
    expect(outcomeEntry.reviewer?.outcome).toBe('deny')
    expect(outcomeEntry.reviewer?.note).toBe('Customer not eligible for refund')
    expect(outcomeEntry.execution.status).toBe('not_executed')
  })
})

// ---------------------------------------------------------------------------
// Test 3: S3 — payroll.export by Support Agent → Blocked, callCount 0
// ---------------------------------------------------------------------------
describe('Test 3 — S3 payroll.export (role block): Blocked', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  it('returns blocked decision', async () => {
    const call: ToolCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv', destination: 'download' },
      provenance: { label: 'Your request', untrusted: false },
    }
    const result = await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1003' })))
    expect(result.decision).toBe('blocked')
    expect(result.ruleId).toBe('role.tool_access')
  })

  it('callCount is 0 — tool never called', async () => {
    const call: ToolCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv', destination: 'download' },
      provenance: { label: 'Your request', untrusted: false },
    }
    await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1003' })))
    expect(gw.getCallCount('payroll.export')).toBe(0)
  })

  it('reason contains the expected text', async () => {
    const call: ToolCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv', destination: 'download' },
      provenance: { label: 'Your request', untrusted: false },
    }
    const result = await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1003' })))
    expect(result.reason).toBe(
      'Support Agent role has no access to payroll.export. The tool was not called.',
    )
  })

  it('records an audit entry with the reason', async () => {
    const call: ToolCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv', destination: 'download' },
      provenance: { label: 'Your request', untrusted: false },
    }
    await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1003' })))
    const entries = gw.audit.getAll()
    expect(entries.length).toBe(1)
    expect(entries[0].decision).toBe('blocked')
    expect(entries[0].reason).toBe(
      'Support Agent role has no access to payroll.export. The tool was not called.',
    )
  })
})

// ---------------------------------------------------------------------------
// Test 4: S4 — untrusted provenance → prefix in reason
// ---------------------------------------------------------------------------
describe('Test 4 — S4 prompt injection (untrusted provenance): Blocked', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  it('reason includes the untrusted-provenance prefix', async () => {
    const call: ToolCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv', destination: 'audit-review@external-mail.example' },
      provenance: { label: 'Ticket T-8841 · customer-supplied text (untrusted)', untrusted: true },
    }
    const result = await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1004' })))
    expect(result.reason).toBe(
      'Permissions come from the signed-in user, not from text the agent read. ' +
        'Support Agent role has no access to payroll.export. The tool was not called.',
    )
  })

  it('callCount is 0', async () => {
    const call: ToolCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv', destination: 'audit-review@external-mail.example' },
      provenance: { label: 'Ticket T-8841 · customer-supplied text (untrusted)', untrusted: true },
    }
    await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1004' })))
    expect(gw.getCallCount('payroll.export')).toBe(0)
  })

  it('decision is blocked and audit record has provenance.untrusted = true', async () => {
    const call: ToolCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv', destination: 'audit-review@external-mail.example' },
      provenance: { label: 'Ticket T-8841 · customer-supplied text (untrusted)', untrusted: true },
    }
    const result = await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1004' })))
    expect(result.decision).toBe('blocked')
    const entries = gw.audit.getAll()
    expect(entries.length).toBe(1)
    expect(entries[0].provenance.untrusted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Test 5: S5 customer.export (scope drift): Needs approval & approve executes once
// ---------------------------------------------------------------------------
describe('Test 5 — S5 customer.export (scope drift): Needs approval & approve executes once', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  it('returns needs_approval with rule task.scope and callCount 0 initially', async () => {
    const call: ToolCall = {
      tool: 'customer.export',
      args: { scope: 'all_customers', fields: ['name', 'email', 'phone'] },
      provenance: { label: 'Your request', untrusted: false },
    }
    const result = await gw.submit(call, makeCtx(PRIYA, priyaGrant()))
    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('task.scope')
    expect(gw.getCallCount('customer.export')).toBe(0)
  })

  it('approve executes once', async () => {
    const call: ToolCall = {
      tool: 'customer.export',
      args: { scope: 'all_customers', fields: ['name', 'email', 'phone'] },
      provenance: { label: 'Your request', untrusted: false },
    }
    const result = await gw.submit(call, makeCtx(PRIYA, priyaGrant()))
    expect(result.approvalId).toBeDefined()

    // Support Lead requester requires Ops Manager reviewer (Dev Malhotra)
    const res = await gw.resolveApproval({
      approvalId: result.approvalId!,
      reviewerId: DEV.id,
      outcome: 'approve',
      note: 'Approved for deduplication check',
    })

    expect(res.ok).toBe(true)
    expect(gw.getCallCount('customer.export')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Test 6: Finance Admin payroll.export → Allowed
// ---------------------------------------------------------------------------
describe('Test 6 — Finance Admin payroll.export: Allowed', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  it('returns allowed', async () => {
    const call: ToolCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv', destination: 'download' },
      provenance: { label: 'Your request', untrusted: false },
    }
    const result = await gw.submit(call, makeCtx(ANITA, financeGrant()))
    expect(result.decision).toBe('allowed')
    expect(result.ruleId).toBe('allow.default')
  })

  it('callCount is 1 after execution', async () => {
    const call: ToolCall = {
      tool: 'payroll.export',
      args: { period: '2026-10', format: 'csv', destination: 'download' },
      provenance: { label: 'Your request', untrusted: false },
    }
    await gw.submit(call, makeCtx(ANITA, financeGrant()))
    expect(gw.getCallCount('payroll.export')).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Test 7: Boundary conditions for refund amounts
// ---------------------------------------------------------------------------
describe('Test 7 — refund.issue boundary conditions', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  function refundCall(amount: number): ToolCall {
    return {
      tool: 'refund.issue',
      args: { invoice_id: 'INV-1042', amount, currency: 'INR', reason: 'test' },
      provenance: { label: 'Your request', untrusted: false },
    }
  }

  it('exactly ₹2,000 → Allowed', async () => {
    const result = await gw.submit(refundCall(2000), makeCtx(ROHAN, standardGrant()))
    expect(result.decision).toBe('allowed')
    expect(result.ruleId).toBe('allow.default')
  })

  it('₹2,001 → Needs approval (args.refund_limit)', async () => {
    const result = await gw.submit(refundCall(2001), makeCtx(ROHAN, standardGrant()))
    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('args.refund_limit')
  })

  it('₹73,001 (above INV-1042 total of ₹73,000) → Blocked (args.refund_total)', async () => {
    const result = await gw.submit(refundCall(73001), makeCtx(ROHAN, standardGrant()))
    expect(result.decision).toBe('blocked')
    expect(result.ruleId).toBe('args.refund_total')
  })

  it('exactly ₹73,000 (= invoice total) → Needs approval, not blocked', async () => {
    const result = await gw.submit(refundCall(73000), makeCtx(ROHAN, standardGrant()))
    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('args.refund_limit')
  })

  it('₹2,000 callCount is 1 (executed)', async () => {
    await gw.submit(refundCall(2000), makeCtx(ROHAN, standardGrant()))
    expect(gw.getCallCount('refund.issue')).toBe(1)
  })

  it('₹73,001 callCount is 0 (blocked)', async () => {
    await gw.submit(refundCall(73001), makeCtx(ROHAN, standardGrant()))
    expect(gw.getCallCount('refund.issue')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Test 8: Expired grant → Needs approval with expiry reason
// ---------------------------------------------------------------------------
describe('Test 8 — expired grant: Needs approval', () => {
  it('returns needs_approval with grant expiry rule', async () => {
    const past = new Date('2026-10-21T10:00:00Z')
    const expiredGrant = issueGrant({
      taskId: 'TASK-EXP',
      userId: 'u-rohan',
      allowTools: ['invoice.lookup', 'refund.issue'],
      allowResources: ['C-204'],
      now: () => past,
    })

    const futureNow = new Date('2026-10-21T10:20:00Z')
    const gw = new Gateway({ now: () => futureNow })

    const call: ToolCall = {
      tool: 'invoice.lookup',
      args: { invoice_id: 'INV-1042', customer_id: 'C-204' },
      provenance: { label: 'Your request', untrusted: false },
    }

    const result = await gw.submit(call, makeCtx(ROHAN, expiredGrant))
    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('task.scope')
    expect(result.reason).toContain('expired at')
  })

  it('callCount is 0 (not executed on expired grant)', async () => {
    const past = new Date('2026-10-21T10:00:00Z')
    const expiredGrant = issueGrant({
      taskId: 'TASK-EXP',
      userId: 'u-rohan',
      allowTools: ['invoice.lookup', 'refund.issue'],
      allowResources: ['C-204'],
      now: () => past,
    })
    const futureNow = new Date('2026-10-21T10:20:00Z')
    const gw = new Gateway({ now: () => futureNow })

    await gw.submit(
      {
        tool: 'invoice.lookup',
        args: { invoice_id: 'INV-1042', customer_id: 'C-204' },
        provenance: { label: 'Your request', untrusted: false },
      },
      makeCtx(ROHAN, expiredGrant),
    )
    expect(gw.getCallCount('invoice.lookup')).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Test 9: Approval validation rules
// ---------------------------------------------------------------------------
describe('Test 9 — Approval validation constraints', () => {
  let gw: Gateway
  let approvalId: string

  beforeEach(async () => {
    gw = new Gateway()
    resetCounters()

    // Create a pending approval for Rohan (Support Agent)
    const call: ToolCall = {
      tool: 'refund.issue',
      args: { invoice_id: 'INV-1042', amount: 25000, currency: 'INR', reason: 'Duplicate charge' },
      provenance: { label: 'Your request', untrusted: false },
    }
    const res = await gw.submit(call, makeCtx(ROHAN, standardGrant({ taskId: 'TASK-1002' })))
    approvalId = res.approvalId!
  })

  it('self-approval is rejected', async () => {
    // Rohan (requester) attempts to approve his own request
    const res = await gw.resolveApproval({
      approvalId,
      reviewer: ROHAN,
      outcome: 'approve',
      note: 'Self-approval',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toBe('self_approval')
    }
    expect(gw.getCallCount('refund.issue')).toBe(0)
  })

  it('a wrong-role reviewer is rejected', async () => {
    // Rohan's request requires Support Lead (Priya).
    // Anita (Finance Admin) attempts to approve.
    const resAnita = await gw.resolveApproval({
      approvalId,
      reviewer: ANITA,
      outcome: 'approve',
      note: 'Finance approval',
    })
    expect(resAnita.ok).toBe(false)
    if (!resAnita.ok) {
      expect(resAnita.error).toBe('wrong_role')
    }

    // Dev (Ops Manager) attempts to approve Rohan's request.
    const resDev = await gw.resolveApproval({
      approvalId,
      reviewer: DEV,
      outcome: 'approve',
      note: 'Ops approval',
    })
    expect(resDev.ok).toBe(false)
    if (!resDev.ok) {
      expect(resDev.error).toBe('wrong_role')
    }

    expect(gw.getCallCount('refund.issue')).toBe(0)
  })

  it('double resolution is rejected', async () => {
    // Priya approves first
    const first = await gw.resolveApproval({
      approvalId,
      reviewer: PRIYA,
      outcome: 'approve',
      note: 'Approved',
    })
    expect(first.ok).toBe(true)
    expect(gw.getCallCount('refund.issue')).toBe(1)

    // Attempt to approve again
    const second = await gw.resolveApproval({
      approvalId,
      reviewer: PRIYA,
      outcome: 'approve',
      note: 'Approve again',
    })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error).toBe('already_resolved')
    }

    // Call count still 1 (never re-executed)
    expect(gw.getCallCount('refund.issue')).toBe(1)
  })

  it('a deny without a note is rejected', async () => {
    const resEmpty = await gw.resolveApproval({
      approvalId,
      reviewer: PRIYA,
      outcome: 'deny',
      note: '',
    })
    expect(resEmpty.ok).toBe(false)
    if (!resEmpty.ok) {
      expect(resEmpty.error).toBe('deny_needs_note')
    }

    const resWhitespace = await gw.resolveApproval({
      approvalId,
      reviewer: PRIYA,
      outcome: 'deny',
      note: '    ',
    })
    expect(resWhitespace.ok).toBe(false)
    if (!resWhitespace.ok) {
      expect(resWhitespace.error).toBe('deny_needs_note')
    }

    // Status remains pending, tool not executed
    expect(gw.getCallCount('refund.issue')).toBe(0)
    const record = gw.getApproval(approvalId)
    expect(record?.status).toBe('pending')
  })
})

// ---------------------------------------------------------------------------
// Test 10: Audit Log and Chain Integrity (Phase 2)
// ---------------------------------------------------------------------------
describe('Test 10 — Audit chain and tamper verification', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  it('canonicalJSON produces deterministic, whitespace-free output with sorted keys', () => {
    const objA = { z: 1, a: { b: 2, a: 1 }, m: [3, 2, 1] }
    const objB = { a: { a: 1, b: 2 }, m: [3, 2, 1], z: 1 }
    expect(canonicalJSON(objA)).toBe(canonicalJSON(objB))
    expect(canonicalJSON(objA)).toBe('{"a":{"a":1,"b":2},"m":[3,2,1],"z":1}')
  })

  it('first entry links to 64-zero genesis hash', async () => {
    const call: ToolCall = {
      tool: 'invoice.lookup',
      args: { invoice_id: 'INV-1042', customer_id: 'C-204' },
      provenance: { label: 'Your request', untrusted: false },
    }
    await gw.submit(call, makeCtx(ROHAN, standardGrant()))
    const entries = gw.audit.getAll()
    expect(entries.length).toBe(1)
    expect(entries[0].prevHash).toBe(GENESIS_HASH)
    expect(entries[0].prevHash).toBe('0'.repeat(64))
    expect(entries[0].hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('valid chain verifies successfully', async () => {
    // Submit several calls to build a chain
    await gw.submit(
      { tool: 'invoice.lookup', args: { invoice_id: 'INV-1042' }, provenance: { label: 'req', untrusted: false } },
      makeCtx(ROHAN, standardGrant()),
    )
    await gw.submit(
      { tool: 'refund.issue', args: { invoice_id: 'INV-1042', amount: 25000 }, provenance: { label: 'req', untrusted: false } },
      makeCtx(ROHAN, standardGrant()),
    )
    await gw.submit(
      { tool: 'payroll.export', args: { period: '2026-10' }, provenance: { label: 'req', untrusted: false } },
      makeCtx(ROHAN, standardGrant()),
    )

    const entries = gw.audit.getAll()
    expect(entries.length).toBe(3)
    const verification = await verifyChain(entries)
    expect(verification.ok).toBe(true)
    expect(verification.brokenAt).toBeNull()
  })

  it('tampering with one stored entry makes verifyChain return brokenAt equal to that index', async () => {
    // Generate 5 entries to test tampering with index 4
    for (let i = 1; i <= 5; i++) {
      await gw.submit(
        {
          tool: 'invoice.lookup',
          args: { invoice_id: 'INV-1042', customer_id: 'C-204' },
          provenance: { label: `Request ${i}`, untrusted: false },
        },
        makeCtx(ROHAN, standardGrant({ taskId: `TASK-100${i}` })),
      )
    }

    const before = gw.audit.getAll()
    expect(before.length).toBe(5)
    expect((await verifyChain(before)).ok).toBe(true)

    // Tamper using tamperDemo from src/demo/tamper.ts
    const tamperedIndex = tamperDemo(gw.audit)
    expect(tamperedIndex).toBe(4)

    const after = gw.audit.getAll()
    const result = await verifyChain(after)
    expect(result.ok).toBe(false)
    expect(result.brokenAt).toBe(4)
  })

  it('reset restores clean state after tampering', async () => {
    for (let i = 1; i <= 4; i++) {
      await gw.submit(
        {
          tool: 'invoice.lookup',
          args: { invoice_id: 'INV-1042', customer_id: 'C-204' },
          provenance: { label: `Request ${i}`, untrusted: false },
        },
        makeCtx(ROHAN, standardGrant({ taskId: `TASK-100${i}` })),
      )
    }

    tamperDemo(gw.audit)
    expect((await verifyChain(gw.audit.getAll())).ok).toBe(false)

    // Reset restores clean state
    resetTamper(gw.audit)
    const verified = await verifyChain(gw.audit.getAll())
    expect(verified.ok).toBe(true)
    expect(verified.brokenAt).toBeNull()
  })

  it('tampering with a log having fewer than 4 entries targets the last entry', async () => {
    const customLog = new AuditLog()
    await customLog.append({
      timestamp: new Date().toISOString(),
      eventId: 'EVT-001',
      type: 'decision',
      taskId: 'TASK-1',
      user: ROHAN,
      agentMode: 'simulated',
      tool: 'invoice.lookup',
      args: {},
      provenance: { label: 'req', untrusted: false },
      decision: 'allowed',
      ruleId: 'allow.default',
      reason: 'Allowed reason',
      checks: [],
      execution: { status: 'executed' },
    })
    await customLog.append({
      timestamp: new Date().toISOString(),
      eventId: 'EVT-002',
      type: 'decision',
      taskId: 'TASK-2',
      user: ROHAN,
      agentMode: 'simulated',
      tool: 'invoice.lookup',
      args: {},
      provenance: { label: 'req', untrusted: false },
      decision: 'allowed',
      ruleId: 'allow.default',
      reason: 'Allowed reason 2',
      checks: [],
      execution: { status: 'executed' },
    })

    const tampered = tamperDemo(customLog)
    expect(tampered).toBe(2)
    const res = await verifyChain(customLog.getAll())
    expect(res.ok).toBe(false)
    expect(res.brokenAt).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Test 12: Engine outputs match baked expected values in scenarios.ts
// ---------------------------------------------------------------------------
describe('Test 12 — scenario outputs match baked expected values', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  function buildContext(scenarioId: string): { call: ToolCall; ctx: EvalContext } | null {
    const sc = SCENARIOS.find((s) => s.id === scenarioId)
    if (!sc) return null

    const grants: Record<string, TaskGrant> = {
      s1: issueGrant({
        taskId: 'TASK-1001',
        userId: USERS.rohan.id,
        allowTools: ['invoice.lookup', 'refund.issue'],
        allowResources: ['C-204'],
      }),
      s2: issueGrant({
        taskId: 'TASK-1002',
        userId: USERS.rohan.id,
        allowTools: ['invoice.lookup', 'refund.issue'],
        allowResources: ['C-204'],
      }),
      s3: issueGrant({
        taskId: 'TASK-1003',
        userId: USERS.rohan.id,
        allowTools: ['invoice.lookup', 'refund.issue'],
        allowResources: ['C-204'],
      }),
      s4: issueGrant({
        taskId: 'TASK-1004',
        userId: USERS.rohan.id,
        allowTools: ['invoice.lookup', 'refund.issue'],
        allowResources: ['C-204'],
      }),
      s5: issueGrant({
        taskId: 'TASK-1005',
        userId: USERS.priya.id,
        allowTools: ['invoice.lookup', 'refund.issue'],
        allowResources: ['C-204'],
      }),
      s6: issueGrant({
        taskId: 'TASK-1006',
        userId: USERS.anita.id,
        allowTools: ['payroll.export'],
        allowResources: ['payroll'],
      }),
      s7: issueGrant({
        taskId: 'TASK-1007',
        userId: USERS.rohan.id,
        allowTools: ['invoice.lookup', 'refund.issue'],
        allowResources: ['C-204'],
      }),
    }

    const grant = grants[scenarioId]
    if (!grant) return null

    const user: GatewayUser = {
      id: sc.user.id,
      name: sc.user.name,
      role: sc.user.role,
    }

    const call: ToolCall = {
      tool: sc.call.tool,
      args: sc.call.args as Record<string, unknown>,
      provenance: {
        label: sc.call.source.label,
        untrusted: sc.call.source.kind === 'untrusted',
      },
    }

    return { call, ctx: { user, grant, agentMode: 'simulated' } }
  }

  for (const sc of SCENARIOS) {
    it(`S${sc.number} (${sc.id}): decision=${sc.decision}, ruleId=${sc.rule}`, async () => {
      const input = buildContext(sc.id)
      if (!input) throw new Error(`Could not build context for scenario ${sc.id}`)

      const result = await gw.submit(input.call, input.ctx)

      expect(result.decision).toBe(sc.decision)
      expect(result.ruleId).toBe(sc.rule)
      expect(result.reason).toBe(sc.reason)
    })

    it(`S${sc.number} (${sc.id}): checks match baked values`, async () => {
      const input = buildContext(sc.id)
      if (!input) throw new Error(`Could not build context for scenario ${sc.id}`)

      const result = await gw.submit(input.call, input.ctx)

      const nameMap: Record<string, string> = {
        role_access: 'Role access',
        task_scope: 'Task scope',
        arg_limits: 'Argument limits',
        input_source: 'Input source',
      }

      for (let i = 0; i < sc.checks.length; i++) {
        const expected = sc.checks[i]
        const actual = result.checks[i]
        expect(actual).toBeDefined()
        expect(nameMap[actual.id]).toBe(expected.name)
        expect(actual.status).toBe(expected.status)
        expect(actual.note).toBe(expected.text)
      }
    })
  }
})
