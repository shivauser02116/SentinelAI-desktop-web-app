import { useSession } from '../state/useSession'
import { CheckIcon } from './Icons'
import { EmptyState } from './EmptyState'

export function ApprovalQueue({ selectedId }: { selectedId?: string }) {
  const { approvals } = useSession()
  const pending = approvals.filter((a) => a.status === 'pending')
  return (
    <aside className="h-[calc(100vh-56px)] w-[300px] shrink-0 overflow-y-auto border-r border-border bg-surface p-4" aria-label="Pending approvals">
      <h2 className="mb-3 text-sm font-semibold">Pending approvals</h2>
      {pending.length === 0 ? (
        <EmptyState icon={<CheckIcon size={20} className="text-allowed-fg" label="All clear" />} text="Nothing waiting for review." />
      ) : (
        <ul className="space-y-2">
          {pending.map((a) => (
            <li key={a.id}>
              <a
                href={`#/approvals/${a.id}`}
                aria-current={a.id === selectedId ? 'true' : undefined}
                className={`block rounded-lg border p-3 ${
                  a.id === selectedId ? 'border-brand bg-surface-subtle' : 'border-border hover:bg-surface-subtle'
                }`}
              >
                <div className="text-13 font-semibold">{a.title}</div>
                <div className="mt-1 flex justify-between text-xs text-text-muted">
                  <span>{a.requester.name}</span>
                  <span className="font-mono text-text-faint">{a.requestedAt}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
