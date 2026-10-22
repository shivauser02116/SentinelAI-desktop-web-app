import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { POLICY } from '../data/policySettings'
import { SCENARIOS } from '../data/scenarios'
import { SessionController } from '../session/SessionController'
import type { SessionState, ChainStatus } from '../types'

export { formatINR, formatArgValue } from '../lib/format'

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const ctrlRef = useRef<SessionController | null>(null)
  if (!ctrlRef.current) ctrlRef.current = new SessionController()
  const ctrl = ctrlRef.current

  const [snap, setSnap] = useState(() => ctrl.getSnapshot())

  useEffect(() => {
    return ctrl.subscribe(setSnap)
  }, [ctrl])

  const chainStatus: ChainStatus = {
    ok: snap.chainOk,
    brokenAt: snap.chainBrokenAt,
    count: snap.auditEntries.length,
  }

  const value: SessionState = {
    ...snap,
    chainStatus,
    scenarios: SCENARIOS,
    policy: POLICY,
    pendingCount: snap.approvals.filter((a) => a.status === 'pending').length,
    runScenario: (id) => {
      ctrl.runScenario(id)
    },
    resolveApproval: (id, action, note) => ctrl.resolveApproval(id, action, note),
    verifyChain: () => {
      ctrl.verifyChain()
    },
    tamperDemo: () => {
      ctrl.tamperDemo()
    },
    reset: () => {
      ctrl.reset()
    },
    selectEvent: (id) => ctrl.selectEvent(id),
    dismissToast: () => ctrl.dismissToast(),
    requestLiveMode: () => ctrl.requestLiveMode(),
    setMode: (mode) => ctrl.setMode(mode),
    setLiveConfig: (config) => ctrl.setLiveConfig(config),
    clearLiveConfig: () => ctrl.clearLiveConfig(),
    runLive: (input) => ctrl.runLive(input),
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
