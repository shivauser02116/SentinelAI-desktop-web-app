import type { InterventionsSummary } from '../gateway/alerts'

interface Props {
  summary: InterventionsSummary
}

export function InterventionSummary({ summary }: Props) {
  const items = [
    {
      label: 'Blocked by SentinelAI',
      count: summary.blocked,
      borderColor: 'border-l-blocked-fg',
    },
    {
      label: 'Held for approval',
      count: summary.held,
      borderColor: 'border-l-approval-fg',
    },
    {
      label: 'Approved by a reviewer',
      count: summary.approved,
      borderColor: 'border-l-emerald-600',
    },
    {
      label: 'Denied by a reviewer',
      count: summary.denied,
      borderColor: 'border-l-border-strong',
    },
  ]

  return (
    <section aria-labelledby="interventions-title">
      <h2 id="interventions-title" className="sr-only">
        Interventions summary
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((it) => (
          <div
            key={it.label}
            className={`rounded-xl border border-border bg-surface p-3.5 border-l-[3px] ${it.borderColor}`}
          >
            <div className="text-2xl font-semibold leading-none">{it.count}</div>
            <div className="mt-1.5 text-13 text-text-muted">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
