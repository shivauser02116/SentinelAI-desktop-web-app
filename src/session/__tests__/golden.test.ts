import { describe, it, expect } from 'vitest'
import { SessionController } from '../SessionController'

describe('golden scenario characterization', () => {
  it('locks current S1 to S5 behavior', async () => {
    const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })

    // Track all toasts shown during the run
    const toasts: Array<{ message: string; linkLabel?: string; href?: string }> = []
    let lastToastId: number | undefined
    ctrl.subscribe((snap) => {
      if (snap.toast && snap.toast.id !== lastToastId) {
        lastToastId = snap.toast.id
        toasts.push({
          message: snap.toast.message,
          linkLabel: snap.toast.linkLabel,
          href: snap.toast.href,
        })
      }
    })

    // S1
    await ctrl.runScenarioSync('s1')

    // S2
    await ctrl.runScenarioSync('s2')
    const snapAfterS2 = ctrl.getSnapshot()
    const s2Approval = snapAfterS2.approvals.find((a) => a.scenarioId === 's2' && a.status === 'pending')
    expect(s2Approval).toBeDefined()
    ctrl.resolveApproval(s2Approval!.id, 'approve', '')
    await new Promise((r) => setTimeout(r, 25))

    // S3
    await ctrl.runScenarioSync('s3')

    // S4
    await ctrl.runScenarioSync('s4')

    // S5
    await ctrl.runScenarioSync('s5')
    const snapAfterS5 = ctrl.getSnapshot()
    const s5Approval = snapAfterS5.approvals.find((a) => a.scenarioId === 's5' && a.status === 'pending')
    expect(s5Approval).toBeDefined()
    ctrl.resolveApproval(s5Approval!.id, 'deny', 'Full export not permitted')
    await new Promise((r) => setTimeout(r, 25))

    const snap = ctrl.getSnapshot()

    // Build normalized snapshot of all UI-visible fields
    const goldenState = {
      events: snap.events.map((e) => ({
        id: e.id,
        scenarioId: e.scenarioId,
        scenarioNumber: e.scenarioNumber,
        time: e.time,
        requestedBy: e.requestedBy.name,
        role: e.requestedBy.role,
        taskId: e.taskId,
        call: {
          tool: e.call.tool,
          args: e.call.args,
          summary: e.call.summary,
          source: e.call.source,
        },
        decision: e.decision,
        rule: e.rule,
        reason: e.reason,
        checks: e.checks,
        status: e.status,
        outcome: e.outcome,
      })),
      approvals: snap.approvals.map((a) => ({
        id: a.id,
        eventId: a.eventId,
        scenarioId: a.scenarioId,
        title: a.title,
        requester: a.requester.name,
        reviewer: a.reviewer.name,
        taskId: a.taskId,
        tool: a.tool,
        args: a.args,
        reason: a.reason,
        status: a.status,
        note: a.note,
        outcome: a.outcome,
      })),
      auditEntries: snap.auditEntries.map((e) => ({
        seq: e.seq,
        eventId: e.eventId,
        date: e.date,
        requestedBy: e.requestedBy,
        role: e.role,
        taskId: e.taskId,
        tool: e.tool,
        args: e.args,
        decision: e.decision,
        rule: e.rule,
        reason: e.reason,
        reviewer: e.reviewer,
        result: e.result,
      })),
      toasts,
    }

    expect(goldenState).toMatchSnapshot()
  })
})
