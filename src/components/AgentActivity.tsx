import { useState } from 'react'
import { useSession } from '../state/useSession'
import { ChevronIcon } from './Icons'
import { UntrustedBox } from './ProvenanceBox'
import { SectionLabel } from './ui'

export function AgentActivity() {
  const { activity, scenarios, mode, liveActivity, liveMessage, runningId, runLive } = useSession()
  const [open, setOpen] = useState(true)
  const [freeText, setFreeText] = useState('')

  const isLive = mode === 'live'

  // Simulated mode: read from scenario
  const sc = (!isLive && activity) ? scenarios.find((s) => s.id === activity.scenarioId) : null
  const untrusted = sc?.call.source.kind === 'untrusted' ? sc.call.source : null

  const handleSend = () => {
    const trimmed = freeText.trim()
    if (!trimmed || runningId) return
    void runLive(trimmed)
    setFreeText('')
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-labelledby="activity-title">
      <div className="flex items-center gap-3">
        <SectionLabel>
          <span id="activity-title">Agent activity</span>
        </SectionLabel>
        {isLive ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            Live LLM
          </span>
        ) : (
          <span className="rounded-full bg-sim-bg px-2.5 py-0.5 text-xs font-medium text-sim-fg">Simulated agent</span>
        )}
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
          {isLive ? (
            <>
              {liveActivity ? (
                <>
                  <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-brand px-3.5 py-2 text-sm text-white">
                    {liveActivity.request}
                  </div>
                  {liveActivity.untrusted && (
                    <UntrustedBox source={liveActivity.untrusted as Parameters<typeof UntrustedBox>[0]['source']} />
                  )}
                  {liveActivity.agentLines.map((line, i) => (
                    <div
                      key={i}
                      className="w-fit max-w-[85%] rounded-xl rounded-bl-sm border border-border bg-surface-subtle px-3.5 py-2 text-sm"
                    >
                      <span className="mr-2 text-xs font-semibold text-text-faint">AGENT</span>
                      {line}
                    </div>
                  ))}
                  {runningId && (
                    <div className="w-fit rounded-full bg-surface-subtle px-3 py-1 text-xs text-text-muted">
                      Thinking…
                    </div>
                  )}
                </>
              ) : (
                <p className="text-text-muted">No agent activity yet.</p>
              )}

              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value.slice(0, 300))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
                  disabled={!!runningId}
                  placeholder="Ask the agent to do something (for example: export the payroll file)"
                  className="flex-1 rounded-lg border border-border bg-surface-subtle px-3 py-1.5 text-sm text-text outline-none focus:border-brand disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!!runningId || !freeText.trim()}
                  className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Send
                </button>
              </div>
              {liveMessage && (
                <p className="text-[11px] text-text-faint">Acting as {liveActivity ? '' : ''}{liveMessage}</p>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </section>
  )
}
