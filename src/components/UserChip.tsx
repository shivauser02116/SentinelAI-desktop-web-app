import { useSession } from '../state/useSession'

export function UserChip() {
  const { currentUser } = useSession()
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-full border border-border bg-surface py-0.5 pl-0.5 pr-3 text-13" aria-label={`Signed in as ${currentUser.name}, ${currentUser.role}`}>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sim-bg text-xs font-semibold text-sim-fg">
        {currentUser.initials}
      </span>
      <span className="whitespace-nowrap font-medium">
        {currentUser.name} <span className="font-normal text-text-muted">· {currentUser.role}</span>
      </span>
    </div>
  )
}
