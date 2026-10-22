import { describe, it, expect, beforeEach } from 'vitest'
import { Gateway } from '../gateway'
import { issueGrant } from '../grants'
import { resetCounters, getUser } from '../mockDb'
import { evaluate, COMPANY_DOMAIN } from '../policy'
import { SCENARIOS, USERS } from '../../data/scenarios'
import type { ToolCall, EvalContext } from '../types'

describe('Change 2 — Detection rules & scenarios 6 and 7', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  const baseEvalCtx = (role: 'Finance Admin' | 'Support Agent' | 'Support Lead'): EvalContext => {
    const user = Object.values(USERS).find((u) => u.role === role)!
    const gwUser = getUser(user.id)!
    const grant = issueGrant({
      taskId: 'TASK-DETECTION',
      userId: gwUser.id,
      allowTools: ['payroll.export', 'refund.issue', 'invoice.lookup', 'customer.export'],
      allowResources: ['payroll', 'C-204'],
      limits: { requireApprovalAbove: 2000 },
    })
    return {
      user: { id: gwUser.id, name: gwUser.name, role: gwUser.role },
      grant,
      agentMode: 'simulated',
    }
  }

  describe('Destination rule (payroll.export & customer.export)', () => {
    it('treats "download" as internal and allows it for Finance Admin', () => {
      const call: ToolCall = {
        tool: 'payroll.export',
        args: { period: '2026-10', format: 'csv', destination: 'download' },
        provenance: { label: 'Your request', untrusted: false },
      }
      const ctx = baseEvalCtx('Finance Admin')
      const result = evaluate(call, ctx, new Date())
      expect(result.decision).toBe('allowed')
      expect(result.ruleId).toBe('allow.default')
    })

    it('treats missing destination as internal and allows it', () => {
      const call: ToolCall = {
        tool: 'payroll.export',
        args: { period: '2026-10', format: 'csv' },
        provenance: { label: 'Your request', untrusted: false },
      }
      const ctx = baseEvalCtx('Finance Admin')
      const result = evaluate(call, ctx, new Date())
      expect(result.decision).toBe('allowed')
      expect(result.ruleId).toBe('allow.default')
    })

    it(`treats email ending in ${COMPANY_DOMAIN} as internal and allows it`, () => {
      const call: ToolCall = {
        tool: 'payroll.export',
        args: { period: '2026-10', format: 'csv', destination: `hr-archive${COMPANY_DOMAIN}` },
        provenance: { label: 'Your request', untrusted: false },
      }
      const ctx = baseEvalCtx('Finance Admin')
      const result = evaluate(call, ctx, new Date())
      expect(result.decision).toBe('allowed')
      expect(result.ruleId).toBe('allow.default')
    })

    it('requires approval for external email destination and keeps tool callCount at 0', async () => {
      const call: ToolCall = {
        tool: 'payroll.export',
        args: { period: '2026-10', format: 'csv', destination: 'audit-review@external-mail.example' },
        provenance: { label: 'Your request', untrusted: false },
      }
      const ctx = baseEvalCtx('Finance Admin')
      const res = await gw.submit(call, ctx)
      expect(res.decision).toBe('needs_approval')
      expect(res.ruleId).toBe('args.export_destination')
      expect(res.reason).toBe('Export destination audit-review@external-mail.example is outside the company domain.')
      expect(gw.getCallCount('payroll.export')).toBe(0)
    })
  })

  describe('Untrusted-source rule (input_source)', () => {
    it('untrusted refund within limit gives source.untrusted_input', () => {
      const call: ToolCall = {
        tool: 'refund.issue',
        args: { invoice_id: 'INV-1042', amount: 1500, currency: 'INR' },
        provenance: { label: 'Ticket T-9012', untrusted: true },
      }
      const ctx = baseEvalCtx('Support Agent')
      const result = evaluate(call, ctx, new Date())
      expect(result.decision).toBe('needs_approval')
      expect(result.ruleId).toBe('source.untrusted_input')
      expect(result.reason).toBe('This call was proposed after reading untrusted text. A reviewer must confirm it.')
      const inputSourceCheck = result.checks.find((c) => c.id === 'input_source')
      expect(inputSourceCheck?.status).toBe('failed')
      expect(inputSourceCheck?.note).toBe('Proposed after reading untrusted text (Ticket T-9012).')
    })

    it('untrusted invoice.lookup is allowed (read-only exception)', () => {
      const call: ToolCall = {
        tool: 'invoice.lookup',
        args: { invoice_id: 'INV-1042', customer_id: 'C-204' },
        provenance: { label: 'Ticket T-9012', untrusted: true },
      }
      const ctx = baseEvalCtx('Support Agent')
      const result = evaluate(call, ctx, new Date())
      expect(result.decision).toBe('allowed')
      expect(result.ruleId).toBe('allow.default')
      const inputSourceCheck = result.checks.find((c) => c.id === 'input_source')
      expect(inputSourceCheck?.status).toBe('passed')
      expect(inputSourceCheck?.note).toBe('Read-only call. Untrusted input is allowed here.')
    })

    it('trusted refund within limit is allowed', () => {
      const call: ToolCall = {
        tool: 'refund.issue',
        args: { invoice_id: 'INV-1042', amount: 1500, currency: 'INR' },
        provenance: { label: 'Your request', untrusted: false },
      }
      const ctx = baseEvalCtx('Support Agent')
      const result = evaluate(call, ctx, new Date())
      expect(result.decision).toBe('allowed')
      expect(result.ruleId).toBe('allow.default')
      const inputSourceCheck = result.checks.find((c) => c.id === 'input_source')
      expect(inputSourceCheck?.status).toBe('passed')
      expect(inputSourceCheck?.note).toBe('Proposed from Your request.')
    })
  })

  describe('Rule evaluation ordering', () => {
    it('role failure beats everything (S4 is blocked at role)', () => {
      const sc4 = SCENARIOS.find((s) => s.id === 's4')!
      const user = getUser(sc4.user.id)!
      const grant = issueGrant({
        taskId: sc4.taskId,
        userId: user.id,
        allowTools: ['invoice.lookup', 'refund.issue'],
        allowResources: ['C-204'],
      })
      const result = evaluate(
        {
          tool: sc4.call.tool,
          args: sc4.call.args as Record<string, unknown>,
          provenance: { label: sc4.call.source.label, untrusted: true },
        },
        { user: { id: user.id, name: user.name, role: user.role }, grant, agentMode: 'simulated' },
        new Date(),
      )
      expect(result.decision).toBe('blocked')
      expect(result.ruleId).toBe('role.tool_access')
      expect(result.checks.find((c) => c.id === 'input_source')?.status).toBe('not_evaluated')
    })

    it('untrusted plus over-limit refund gives args.refund_limit (limits beat input_source)', () => {
      const call: ToolCall = {
        tool: 'refund.issue',
        args: { invoice_id: 'INV-1042', amount: 25000, currency: 'INR' },
        provenance: { label: 'Ticket T-9999', untrusted: true },
      }
      const ctx = baseEvalCtx('Support Agent')
      const result = evaluate(call, ctx, new Date())
      expect(result.decision).toBe('needs_approval')
      expect(result.ruleId).toBe('args.refund_limit')
      expect(result.checks.find((c) => c.id === 'input_source')?.status).toBe('not_evaluated')
    })

    it('untrusted plus out-of-grant gives task.scope (scope beats input_source)', () => {
      const call: ToolCall = {
        tool: 'customer.export',
        args: { scope: 'all_customers', fields: ['name', 'email'] },
        provenance: { label: 'Ticket T-9999', untrusted: true },
      }
      const user = getUser(USERS.priya.id)!
      const grant = issueGrant({
        taskId: 'TASK-LIMITED',
        userId: user.id,
        allowTools: ['invoice.lookup', 'refund.issue'], // customer.export omitted
        allowResources: ['C-204'],
      })
      const result = evaluate(
        call,
        { user: { id: user.id, name: user.name, role: user.role }, grant, agentMode: 'simulated' },
        new Date(),
      )
      expect(result.decision).toBe('needs_approval')
      expect(result.ruleId).toBe('task.scope')
      expect(result.checks.find((c) => c.id === 'input_source')?.status).toBe('not_evaluated')
    })
  })

  describe('Scenario S6 & S7 expectations and lifecycle', () => {
    it('engine output equals baked expectations for S6', async () => {
      const sc6 = SCENARIOS.find((s) => s.id === 's6')!
      const user = getUser(sc6.user.id)!
      const grant = issueGrant({
        taskId: sc6.taskId,
        userId: sc6.grant!.userId,
        allowTools: sc6.grant!.allowTools,
        allowResources: sc6.grant!.allowResources,
      })
      const result = await gw.submit(
        {
          tool: sc6.call.tool,
          args: sc6.call.args as Record<string, unknown>,
          provenance: { label: sc6.call.source.label, untrusted: false },
        },
        { user: { id: user.id, name: user.name, role: user.role }, grant, agentMode: 'simulated' },
      )
      expect(result.decision).toBe(sc6.decision)
      expect(result.ruleId).toBe(sc6.rule)
      expect(result.reason).toBe(sc6.reason)
    })

    it('engine output equals baked expectations for S7', async () => {
      const sc7 = SCENARIOS.find((s) => s.id === 's7')!
      const user = getUser(sc7.user.id)!
      const grant = issueGrant({
        taskId: sc7.taskId,
        userId: user.id,
        allowTools: ['invoice.lookup', 'refund.issue'],
        allowResources: ['C-204'],
        limits: { requireApprovalAbove: 2000 },
      })
      const result = await gw.submit(
        {
          tool: sc7.call.tool,
          args: sc7.call.args as Record<string, unknown>,
          provenance: { label: sc7.call.source.label, untrusted: true },
        },
        { user: { id: user.id, name: user.name, role: user.role }, grant, agentMode: 'simulated' },
      )
      expect(result.decision).toBe(sc7.decision)
      expect(result.ruleId).toBe(sc7.rule)
      expect(result.reason).toBe(sc7.reason)
    })

    it('approve S6 runs payroll tool exactly once; deny keeps it at 0', async () => {
      const sc6 = SCENARIOS.find((s) => s.id === 's6')!
      const user = getUser(sc6.user.id)!
      const grant = issueGrant({
        taskId: sc6.taskId,
        userId: sc6.grant!.userId,
        allowTools: sc6.grant!.allowTools,
        allowResources: sc6.grant!.allowResources,
      })
      const res = await gw.submit(
        {
          tool: sc6.call.tool,
          args: sc6.call.args as Record<string, unknown>,
          provenance: { label: sc6.call.source.label, untrusted: false },
        },
        { user: { id: user.id, name: user.name, role: user.role }, grant, agentMode: 'simulated' },
      )
      expect(res.decision).toBe('needs_approval')
      expect(gw.getCallCount('payroll.export')).toBe(0)

      const opsManager = getUser(USERS.dev.id)!
      const resolved = await gw.resolveApproval({
        approvalId: res.approvalId!,
        reviewer: opsManager,
        outcome: 'approve',
        note: '',
      })
      expect(resolved.ok).toBe(true)
      expect(gw.getCallCount('payroll.export')).toBe(1)
    })

    it('Finance Admin request requires Ops Manager reviewer; self or wrong-role is rejected', async () => {
      const sc6 = SCENARIOS.find((s) => s.id === 's6')!
      const user = getUser(sc6.user.id)!
      const grant = issueGrant({
        taskId: sc6.taskId,
        userId: sc6.grant!.userId,
        allowTools: sc6.grant!.allowTools,
        allowResources: sc6.grant!.allowResources,
      })
      const res = await gw.submit(
        {
          tool: sc6.call.tool,
          args: sc6.call.args as Record<string, unknown>,
          provenance: { label: sc6.call.source.label, untrusted: false },
        },
        { user: { id: user.id, name: user.name, role: user.role }, grant, agentMode: 'simulated' },
      )

      // Self-approval by Anita
      const selfRes = await gw.resolveApproval({
        approvalId: res.approvalId!,
        reviewer: user,
        outcome: 'approve',
        note: '',
      })
      expect(selfRes.ok).toBe(false)
      if (!selfRes.ok) {
        expect(selfRes.error).toBe('self_approval')
      }

      // Wrong role (Support Lead Priya)
      const priya = getUser(USERS.priya.id)!
      const wrongRoleRes = await gw.resolveApproval({
        approvalId: res.approvalId!,
        reviewer: priya,
        outcome: 'approve',
        note: '',
      })
      expect(wrongRoleRes.ok).toBe(false)
      if (!wrongRoleRes.ok) {
        expect(wrongRoleRes.error).toBe('wrong_role')
      }
    })
  })
})
