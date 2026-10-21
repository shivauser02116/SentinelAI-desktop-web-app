import type { KeyboardEvent } from 'react'
import type { ActionEvent } from '../types'
import { CheckpointRow } from './CheckpointRow'
import { DecisionPill } from './DecisionPill'
import { EmptyState } from './EmptyState'
import { GateNode } from './GateNode'

export function CheckpointTimeline({
  events,
  selectedId,
  onSelect,
}: {
  events: ActionEvent[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-row]'))
    const i = rows.findIndex((r) => r === document.activeElement)
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (!next) return
    e.preventDefault()
    next.focus()
    onSelect(events[rows.indexOf(next)].id)
  }

  return (
    <section aria-labelledby="timeline-title">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id="timeline-title" className="text-xl font-semibold">
            Action checkpoint
          </h2>
          <p className="text-text-muted">Every agent action passes through one control point.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2" aria-label="Legend">
          <DecisionPill decision="allowed" />
          <DecisionPill decision="needs_approval" />
          <DecisionPill decision="blocked" />
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-6 py-10">
          <div className="relative mx-auto flex h-7 max-w-md items-center justify-center">
            <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-border-strong" />
            <GateNode status="evaluating" />
          </div>
          <div className="mt-6">
            <EmptyState text="No agent actions yet. Run a scenario to see actions pass through the checkpoint." />
          </div>
        </div>
      ) : (
        <div
          role="listbox"
          aria-label="Agent actions"
          onKeyDown={onKey}
          className="rounded-xl border border-border bg-surface p-2"
        >
          {events.map((ev) => (
            <CheckpointRow key={ev.id} event={ev} selected={ev.id === selectedId} onSelect={() => onSelect(ev.id)} />
          ))}
        </div>
      )}
    </section>
  )
}
