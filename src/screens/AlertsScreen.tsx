import { useState } from 'react'
import { useSession } from '../state/useSession'
import type { AlertState } from '../gateway/alerts'
import { AlertRow } from '../components/AlertRow'
import { EmptyState } from '../components/EmptyState'
import { InterventionSummary } from '../components/InterventionSummary'

type FilterOption = 'all' | AlertState

const filters: { value: FilterOption; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'action_needed', label: 'Needs action' },
  { value: 'contained', label: 'Contained' },
  { value: 'resolved', label: 'Resolved' },
]

export function AlertsScreen() {
  const { alerts, interventions } = useSession()
  const [filter, setFilter] = useState<FilterOption>('all')

  const filtered = alerts.filter((a) => {
    if (filter === 'all') return true
    return a.state === filter
  })

  return (
    <div className="h-[calc(100vh-56px)] overflow-y-auto">
      <div className="mx-auto max-w-[1200px] space-y-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold text-text">Alerts</h1>

          {/* Segmented Filter */}
          <div
            role="radiogroup"
            aria-label="Filter alerts by state"
            className="flex rounded-lg border border-border-strong bg-surface p-0.5 text-13"
          >
            {filters.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={`min-h-8 rounded-md px-3 font-medium transition-colors ${
                  filter === f.value
                    ? 'bg-brand text-white'
                    : 'text-text-muted hover:text-text'
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Interventions summary */}
        <InterventionSummary summary={interventions} />

        {/* Alert list card */}
        <section aria-label="Alerts list">
          {alerts.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface py-12">
              <EmptyState text="No alerts yet. Alerts appear when SentinelAI blocks, pauses or flags an action." />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface py-12">
              <EmptyState text="No alerts match this filter." />
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <ul role="list" className="divide-y divide-border">
                {filtered.map((a) => (
                  <AlertRow key={a.id} alert={a} />
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Footer */}
        <footer className="text-center">
          <p className="text-xs italic text-text-muted">
            Alerts are derived from the audit log. They don't change any decision.
          </p>
        </footer>
      </div>
    </div>
  )
}
