import { useSession } from '../state/useSession'
import { ApprovalCard } from '../components/ApprovalCard'
import { ApprovalQueue } from '../components/ApprovalQueue'
import { CheckIcon } from '../components/Icons'
import { EmptyState } from '../components/EmptyState'

export function ApprovalScreen({ id }: { id?: string }) {
  const { approvals } = useSession()
  const current = approvals.find((a) => a.id === id) ?? (id ? undefined : approvals.find((a) => a.status === 'pending'))
  return (
    <div className="flex">
      <ApprovalQueue selectedId={current?.id} />
      <div className="h-[calc(100vh-56px)] min-w-0 flex-1 overflow-y-auto p-6">
        {current ? (
          <ApprovalCard key={current.id} approval={current} />
        ) : (
          <div className="pt-16">
            <EmptyState icon={<CheckIcon size={24} className="text-allowed-fg" label="All clear" />} text="Nothing waiting for review." />
          </div>
        )}
      </div>
    </div>
  )
}
