import { useSession } from '../state/useSession'
import { EmptyState } from './EmptyState'
import { Card, KeyValues, SectionLabel } from './ui'

export function TaskGrantCard() {
  const { currentTask: t } = useSession()
  if (!t) return <EmptyState dashed text="No task running. Pick a scenario to start." />
  return (
    <Card className="p-5">
      <SectionLabel>Current task</SectionLabel>
      <h2 className="mb-3 mt-1 text-sm font-semibold">{t.title}</h2>
      <KeyValues
        rows={[
          ['Task ID', t.taskId, true],
          ['Requested by', `${t.requestedBy.name}, ${t.requestedBy.role}`],
          ['Customer', t.customer],
        ]}
      />
      <div className="mt-4 border-t border-border pt-3">
        <SectionLabel className="mb-2">Task grant</SectionLabel>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {t.tools.map((tool) => (
            <span key={tool} className="rounded-md border border-border bg-surface-subtle px-2 py-0.5 font-mono text-xs">
              {tool}
            </span>
          ))}
        </div>
        <ul className="space-y-1 text-13 text-text-muted">
          <li>Resource: {t.resource}</li>
          {t.tools.includes('refund.issue') && <li>Refund limit: up to invoice total</li>}
          <li>
            Expires: {t.expires} <span className="tnum ml-1 text-text-faint">{t.timeLeft}</span>
          </li>
        </ul>
      </div>
    </Card>
  )
}
