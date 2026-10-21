import { useState } from 'react'
import { useSession } from '../state/useSession'
import { ChevronIcon } from './Icons'
import { UntrustedBox } from './ProvenanceBox'
import { SectionLabel } from './ui'

export function AgentActivity() {
  const { activity, scenarios } = useSession()
  const [open, setOpen] = useState(true)
  const sc = activity ? scenarios.find((s) => s.id === activity.scenarioId) : null
  const untrusted = sc?.call.source.kind === 'untrusted' ? sc.call.source : null

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-labelledby="activity-title">
      <div className="flex items-center gap-3">
        <SectionLabel>
          <span id="activity-title">Agent activity</span>
        </SectionLabel>
        <span className="rounded-full bg-sim-bg px-2.5 py-0.5 text-xs font-medium text-sim-fg">Simulated agent</span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse agent activity' : 'Expand agent activity'}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-sim-bg"
        >
          <ChevronIcon className={open ? '' : '-rotate-90'} />
        </button>
      </div>
      {open && (
        <div className="mt-3 min-h-[72px] space-y-2">
          {!sc || !activity ? (
            <p className="text-text-muted">No agent activity yet.</p>
          ) : (
            <>
              <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-brand px-3.5 py-2 text-sm text-white">
                {sc.request}
              </div>
              {untrusted && <UntrustedBox source={untrusted} />}
              {activity.stage >= 2 && (
                <div className="w-fit max-w-[85%] rounded-xl rounded-bl-sm border border-border bg-surface-subtle px-3.5 py-2 text-sm">
                  <span className="mr-2 text-xs font-semibold text-text-faint">AGENT</span>
                  {sc.agentLine}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
