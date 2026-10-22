import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SessionController } from '../../session/SessionController'
import { SCENARIOS } from '../../data/scenarios'

describe('Test 11 — Determinism', () => {
  it('running all five scenarios twice (after reset) produces identical sequences of (tool, args, decision, ruleId)', async () => {
    const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })

    const runAll = async () => {
      const records: Array<{
        tool: string
        args: Record<string, unknown>
        decision: string
        ruleId: string
      }> = []

      for (const sc of SCENARIOS) {
        await ctrl.runScenarioSync(sc.id)
        const snap = ctrl.getSnapshot()
        const lastEvent = snap.events[snap.events.length - 1]
        records.push({
          tool: lastEvent.call.tool,
          args: lastEvent.call.args,
          decision: lastEvent.decision,
          ruleId: lastEvent.rule,
        })
      }
      return records
    }

    const firstRun = await runAll()
    expect(firstRun).toHaveLength(SCENARIOS.length)

    ctrl.reset()
    expect(ctrl.getSnapshot().events).toHaveLength(0)
    expect(ctrl.getSnapshot().auditEntries).toHaveLength(0)

    const secondRun = await runAll()
    expect(secondRun).toHaveLength(SCENARIOS.length)

    expect(firstRun).toEqual(secondRun)
  })
})

describe('Test 13 — Architecture guard', () => {
  function walkFiles(dir: string): string[] {
    const entries = readdirSync(dir)
    return entries.flatMap((e) => {
      const p = join(dir, e)
      return statSync(p).isDirectory() ? walkFiles(p) : [p]
    })
  }

  it('no file in src/components, src/screens, or src/state imports from src/gateway/tools', () => {
    // Resolve project root
    const root = new URL('../../..', import.meta.url).pathname
    const targetDirs = ['src/components', 'src/screens', 'src/state']
    const violations: string[] = []

    for (const rel of targetDirs) {
      const fullDir = join(root, rel)
      let files: string[]
      try {
        files = walkFiles(fullDir)
      } catch {
        continue
      }

      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
        const content = readFileSync(file, 'utf-8')
        // Check for imports from gateway/tools
        if (/from\s+['"][^'"]*gateway\/tools['"]/.test(content)) {
          violations.push(file)
        }
      }
    }

    expect(violations).toEqual([])
  })
})

describe('SessionController wiring & lifecycle', () => {
  it('handles scenario runs, approval resolution, chain verification, tampering, and reset', async () => {
    const ctrl = new SessionController({ delays: [0, 0, 0, 0, 0] })

    // Run S1
    await ctrl.runScenarioSync('s1')
    let snap = ctrl.getSnapshot()
    expect(snap.events).toHaveLength(1)
    expect(snap.events[0].status).toBe('allowed')
    expect(snap.auditEntries).toHaveLength(1)
    expect(snap.currentTask).not.toBeNull()
    expect(snap.currentTask?.taskId).toBe('TASK-1001')

    // Run S2 (needs approval)
    await ctrl.runScenarioSync('s2')
    snap = ctrl.getSnapshot()
    expect(snap.events).toHaveLength(2)
    expect(snap.approvals).toHaveLength(1)
    expect(snap.approvals[0].status).toBe('pending')

    // Resolve approval with approval
    const resolved = ctrl.resolveApproval(snap.approvals[0].id, 'approve', '')
    expect(resolved).toBe(true)

    // Wait microtask for async approval resolution
    await new Promise((r) => setTimeout(r, 10))
    snap = ctrl.getSnapshot()
    expect(snap.approvals[0].status).toBe('approved')
    expect(snap.auditEntries).toHaveLength(3) // S1 decision, S2 decision, S2 approval_outcome

    // Verify chain is valid
    ctrl.verifyChain()
    await new Promise((r) => setTimeout(r, 10))
    snap = ctrl.getSnapshot()
    expect(snap.chainOk).toBe(true)
    expect(snap.chainBrokenAt).toBeNull()

    // Tamper demo
    ctrl.tamperDemo()
    await new Promise((r) => setTimeout(r, 10))
    snap = ctrl.getSnapshot()
    expect(snap.chainOk).toBe(false)
    expect(snap.chainBrokenAt).not.toBeNull()

    // Reset restores everything
    ctrl.reset()
    snap = ctrl.getSnapshot()
    expect(snap.events).toHaveLength(0)
    expect(snap.approvals).toHaveLength(0)
    expect(snap.auditEntries).toHaveLength(0)
    expect(snap.chainOk).toBe(true)
    expect(snap.currentTask).toBeNull()
  })

  it('triggers toast when live mode is requested', () => {
    const ctrl = new SessionController()
    ctrl.requestLiveMode()
    const snap = ctrl.getSnapshot()
    expect(snap.toast).not.toBeNull()
    expect(snap.toast?.message).toBe("Live LLM mode isn't configured")

    ctrl.dismissToast()
    expect(ctrl.getSnapshot().toast).toBeNull()
  })
})
