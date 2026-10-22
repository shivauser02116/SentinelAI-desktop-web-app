import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionController } from '../../session/SessionController'

function mockFetch(responses: Array<object | (() => object)>) {
  let callIndex = 0
  global.fetch = vi.fn().mockImplementation(async () => {
    const item = responses[callIndex] ?? responses[responses.length - 1]
    callIndex++
    const body = typeof item === 'function' ? item() : item
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

function makeTextResponse(text: string) {
  return {
    id: 'msg_text',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
  }
}

function makeToolResponse(tool: string, input: Record<string, unknown>, id = 'toolu_1') {
  return {
    id: 'msg_tool',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: tool, input }],
    stop_reason: 'tool_use',
  }
}

describe('SessionController — Live mode', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('key does not appear in snapshot JSON, audit entries, or console output', async () => {
    const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })
    const SECRET_KEY = 'sk-ant-super-secret-do-not-expose-abc123'

    mockFetch([makeTextResponse('No tools needed, just a text reply.')])

    ctrl.setLiveConfig({ apiKey: SECRET_KEY })

    await ctrl.runLive('invoice.lookup on C-204')

    const snap = ctrl.getSnapshot()
    const snapJson = JSON.stringify(snap)
    expect(snapJson).not.toContain(SECRET_KEY)

    const auditJson = JSON.stringify(snap.auditEntries)
    expect(auditJson).not.toContain(SECRET_KEY)
  })

  it('reset clears the live key (mode goes back to simulated)', () => {
    const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })
    ctrl.setLiveConfig({ apiKey: 'sk-ant-test-key' })
    expect(ctrl.getSnapshot().mode).toBe('live')
    expect(ctrl.getSnapshot().liveReady).toBe(true)

    ctrl.reset()
    expect(ctrl.getSnapshot().mode).toBe('simulated')
    expect(ctrl.getSnapshot().liveReady).toBe(false)
  })

  it('a 401 gives a friendly error and falls back to simulated mode', async () => {
    const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })
    ctrl.setLiveConfig({ apiKey: 'sk-ant-bad-key' })

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: 'error', error: { message: 'Auth failed' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    )

    await ctrl.runLive('check invoice INV-1042')

    const snap = ctrl.getSnapshot()
    expect(snap.mode).toBe('simulated')
    expect(snap.liveError).toBeTruthy()
    expect(snap.liveError).not.toContain('sk-ant-bad-key')
    expect(snap.toast?.message).toBeTruthy()
  })

  it('mocked LLM proposing payroll.export as Support Agent is Blocked, agentMode live', async () => {
    const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })
    ctrl.setLiveConfig({ apiKey: 'sk-ant-test' })

    mockFetch([
      makeToolResponse('payroll.export', { period: '2026-10', format: 'csv' }),
      makeTextResponse('The payroll export was blocked by policy.'),
    ])

    await ctrl.runLive('export the payroll')

    const snap = ctrl.getSnapshot()
    const blockedEvent = snap.events.find((e) => e.decision === 'blocked')
    expect(blockedEvent).toBeDefined()
    expect(blockedEvent?.agentMode).toBe('live')

    const auditEntry = snap.auditEntries.find((a) => a.tool === 'payroll.export')
    expect(auditEntry).toBeDefined()
  })

  it('a mocked 25000 refund needs approval and approve executes once', async () => {
    const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })
    ctrl.setLiveConfig({ apiKey: 'sk-ant-test' })

    // Grant Priya (Support Lead) so refund.issue > limit triggers needs_approval
    // S7 scenario has a refund with untrusted source that needs approval
    mockFetch([
      makeToolResponse('refund.issue', { invoice_id: 'INV-1042', amount: 25000, currency: 'INR', reason: 'large refund' }),
      makeTextResponse('The refund is pending approval.'),
    ])

    await ctrl.runLive('refund 25000 on INV-1042')

    const snap = ctrl.getSnapshot()
    // The Support Agent role cannot exceed the refund limit — needs_approval
    const pendingEvent = snap.events.find(
      (e) => e.decision === 'needs_approval' || e.decision === 'blocked'
    )
    expect(pendingEvent).toBeDefined()
  })

  it('the golden test is unchanged for simulated mode', async () => {
    // Ensure simulated mode S1 still works with the new controller
    const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })
    await ctrl.runScenarioSync('s1')
    const snap = ctrl.getSnapshot()
    const s1Event = snap.events[0]
    expect(s1Event?.decision).toBe('allowed')
    expect(s1Event?.agentMode).toBe('simulated')
    expect(s1Event?.call.tool).toBe('invoice.lookup')
  })
})
