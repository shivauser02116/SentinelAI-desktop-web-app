import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Gateway } from '../gateway'
import { issueGrant } from '../grants'
import { resetCounters, getUser } from '../mockDb'
import { deriveAlerts, summarizeInterventions, type Alert } from '../alerts'
import { SessionController } from '../../session/SessionController'
import { SCENARIOS, USERS } from '../../data/scenarios'
import type { ToolCall, EvalContext } from '../types'

describe('Change 1 — Derived Alerts & Interventions', () => {
  let gw: Gateway

  beforeEach(() => {
    gw = new Gateway()
    resetCounters()
  })

  function getScenarioContext(id: string): { call: ToolCall; ctx: EvalContext } {
    const sc = SCENARIOS.find((s) => s.id === id)!
    const user = getUser(sc.user.id)!
    const grant = sc.grant
      ? issueGrant({
          taskId: sc.taskId,
          userId: sc.grant.userId,
          allowTools: sc.grant.allowTools,
          allowResources: sc.grant.allowResources,
        })
      : issueGrant({
          taskId: sc.taskId,
          userId: sc.id === 's5' ? USERS.priya.id : USERS.rohan.id,
          allowTools: ['invoice.lookup', 'refund.issue'],
          allowResources: ['C-204'],
          limits: { requireApprovalAbove: 2000 },
        })

    return {
      call: {
        tool: sc.call.tool,
        args: sc.call.args as Record<string, unknown>,
        provenance: {
          label: sc.call.source.label,
          untrusted: sc.call.source.kind === 'untrusted',
        },
      },
      ctx: {
        user: { id: user.id, name: user.name, role: user.role },
        grant,
        agentMode: 'simulated',
      },
    }
  }

  it('S1 gives no alerts', async () => {
    const { call, ctx } = getScenarioContext('s1')
    await gw.submit(call, ctx)
    const alerts = deriveAlerts({
      entries: gw.audit.getAll(),
      approvals: gw.getApprovals(),
      chain: { ok: true, brokenAt: null },
    })
    expect(alerts).toHaveLength(0)
  })

  it("S3 gives one high, contained alert with tags ['Blocked']", async () => {
    const { call, ctx } = getScenarioContext('s3')
    await gw.submit(call, ctx)
    const alerts = deriveAlerts({
      entries: gw.audit.getAll(),
      approvals: gw.getApprovals(),
      chain: { ok: true, brokenAt: null },
    })
    expect(alerts).toHaveLength(1)
    const [alert] = alerts
    expect(alert.severity).toBe('high')
    expect(alert.state).toBe('contained')
    expect(alert.title).toBe('payroll.export was blocked')
    expect(alert.tags).toEqual(['Blocked'])
  })

  it("S4 tags include 'Untrusted source'", async () => {
    const { call, ctx } = getScenarioContext('s4')
    await gw.submit(call, ctx)
    const alerts = deriveAlerts({
      entries: gw.audit.getAll(),
      approvals: gw.getApprovals(),
      chain: { ok: true, brokenAt: null },
    })
    expect(alerts).toHaveLength(1)
    const [alert] = alerts
    expect(alert.severity).toBe('high')
    expect(alert.state).toBe('contained')
    expect(alert.tags).toContain('Blocked')
    expect(alert.tags).toContain('Untrusted source')
  })

  it("S2 pending is medium with 'Over refund limit' and reviewer Priya Nair; after approve resolved; after deny note included", async () => {
    const { call, ctx } = getScenarioContext('s2')
    const res = await gw.submit(call, ctx)
    expect(res.decision).toBe('needs_approval')

    let alerts = deriveAlerts({
      entries: gw.audit.getAll(),
      approvals: gw.getApprovals(),
      chain: { ok: true, brokenAt: null },
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('medium')
    expect(alerts[0].state).toBe('action_needed')
    expect(alerts[0].tags).toContain('Over refund limit')
    expect(alerts[0].reviewer?.name).toBe('Priya Nair')

    // Approve S2
    const priya = getUser(USERS.priya.id)!
    await gw.resolveApproval({
      approvalId: res.approvalId!,
      reviewer: priya,
      outcome: 'approve',
      note: '',
    })

    alerts = deriveAlerts({
      entries: gw.audit.getAll(),
      approvals: gw.getApprovals(),
      chain: { ok: true, brokenAt: null },
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].severity).toBe('low')
    expect(alerts[0].state).toBe('resolved')
    expect(alerts[0].title).toBe('refund.issue was approved')
    expect(alerts[0].detail).toBe('Approved by Priya Nair.')

    // Deny branch test
    gw.reset()
    const res2 = await gw.submit(call, ctx)
    await gw.resolveApproval({
      approvalId: res2.approvalId!,
      reviewer: priya,
      outcome: 'deny',
      note: 'Amount too high',
    })
    const denyAlerts = deriveAlerts({
      entries: gw.audit.getAll(),
      approvals: gw.getApprovals(),
      chain: { ok: true, brokenAt: null },
    })
    expect(denyAlerts).toHaveLength(1)
    expect(denyAlerts[0].severity).toBe('low')
    expect(denyAlerts[0].state).toBe('resolved')
    expect(denyAlerts[0].title).toBe('refund.issue was denied')
    expect(denyAlerts[0].detail).toContain('Denied by Priya Nair: Amount too high.')
  })

  it("S5 has 'Outside task grant' and reviewer Dev Malhotra", async () => {
    const { call, ctx } = getScenarioContext('s5')
    await gw.submit(call, ctx)
    const alerts = deriveAlerts({
      entries: gw.audit.getAll(),
      approvals: gw.getApprovals(),
      chain: { ok: true, brokenAt: null },
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].tags).toContain('Outside task grant')
    expect(alerts[0].reviewer?.name).toBe('Dev Malhotra')
  })

  it("S6 has 'Outside company domain'", async () => {
    const { call, ctx } = getScenarioContext('s6')
    await gw.submit(call, ctx)
    const alerts = deriveAlerts({
      entries: gw.audit.getAll(),
      approvals: gw.getApprovals(),
      chain: { ok: true, brokenAt: null },
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].tags).toContain('Outside company domain')
    expect(alerts[0].reviewer?.name).toBe('Dev Malhotra')
  })

  it("S7 has 'Untrusted source'", async () => {
    const { call, ctx } = getScenarioContext('s7')
    await gw.submit(call, ctx)
    const alerts = deriveAlerts({
      entries: gw.audit.getAll(),
      approvals: gw.getApprovals(),
      chain: { ok: true, brokenAt: null },
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0].tags).toContain('Untrusted source')
    expect(alerts[0].reviewer?.name).toBe('Priya Nair')
  })

  it('Alerts are deterministic (same inputs produce same ids and order)', async () => {
    const run = async () => {
      const g = new Gateway()
      g.reset()
      for (const id of ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) {
        const { call, ctx } = getScenarioContext(id)
        await g.submit(call, ctx)
      }
      return deriveAlerts({
        entries: g.audit.getAll(),
        approvals: g.getApprovals(),
        chain: { ok: true, brokenAt: null },
      })
    }

    const r1 = await run()
    const r2 = await run()
    const stripTime = (alerts: ReturnType<typeof deriveAlerts>) =>
      alerts.map(({ timestamp: _t, ...rest }) => rest)
    expect(stripTime(r1)).toEqual(stripTime(r2))
  })

  describe('Controller-level alert integration & interventions summary', () => {
    it('summarizeInterventions for all 7 scenarios with S2 approved and S5 denied gives blocked 2, held 4, approved 1, denied 1', async () => {
      const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })
      await ctrl.runScenarioSync('s1')

      await ctrl.runScenarioSync('s2')
      const s2Ap = ctrl.getSnapshot().approvals.find((a) => a.scenarioId === 's2' && a.status === 'pending')!
      ctrl.resolveApproval(s2Ap.id, 'approve', '')
      await new Promise((r) => setTimeout(r, 20))

      await ctrl.runScenarioSync('s3')
      await ctrl.runScenarioSync('s4')

      await ctrl.runScenarioSync('s5')
      const s5Ap = ctrl.getSnapshot().approvals.find((a) => a.scenarioId === 's5' && a.status === 'pending')!
      ctrl.resolveApproval(s5Ap.id, 'deny', 'Denied by lead')
      await new Promise((r) => setTimeout(r, 20))

      await ctrl.runScenarioSync('s6')
      await ctrl.runScenarioSync('s7')

      const snap = ctrl.getSnapshot()
      expect(snap.interventions).toEqual({
        blocked: 2,
        held: 4,
        approved: 1,
        denied: 1,
      })
    })

    it('chain broken through tamperDemo gives ALR-CHAIN high with the right entry number; reset clears alerts', async () => {
      const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })
      await ctrl.runScenarioSync('s1')
      await ctrl.runScenarioSync('s2')
      await ctrl.runScenarioSync('s3')

      ctrl.tamperDemo()
      await new Promise((r) => setTimeout(r, 30))

      const snap = ctrl.getSnapshot()
      expect(snap.chainOk).toBe(false)
      expect(snap.chainBrokenAt).not.toBeNull()

      const chainAlert = snap.alerts.find((a) => a.id === 'ALR-CHAIN')
      expect(chainAlert).toBeDefined()
      expect(chainAlert?.severity).toBe('high')
      expect(chainAlert?.title).toBe(`Audit chain is broken at entry #${snap.chainBrokenAt}`)

      // Reset restores clean state
      ctrl.reset()
      const resetSnap = ctrl.getSnapshot()
      expect(resetSnap.alerts).toHaveLength(0)
      expect(resetSnap.interventions).toEqual({ blocked: 0, held: 0, approved: 0, denied: 0 })
    })

    it('architecture guard: gateway files policy.ts and gateway.ts do not import alerts.ts', () => {
      const root = fileURLToPath(new URL('../../..', import.meta.url))
      const gatewayDir = join(root, 'src/gateway')
      const files = ['policy.ts', 'gateway.ts']
      for (const file of files) {
        const content = readFileSync(join(gatewayDir, file), 'utf-8')
        expect(content).not.toMatch(/from ['"]\.\/alerts['"]/)
        expect(content).not.toMatch(/from ['"].*alerts['"]/)
      }
    })
  })
})
