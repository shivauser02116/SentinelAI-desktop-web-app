import type { EventStatus } from '../types'
import { CheckIcon, MinusIcon, PauseIcon, XIcon } from './Icons'

export const gateTone: Record<EventStatus, { bg: string; line: string; label: string }> = {
  evaluating: { bg: 'bg-text-faint', line: 'bg-border-strong', label: 'Checking' },
  allowed: { bg: 'bg-allowed-fg', line: 'bg-allowed-fg', label: 'Allowed' },
  approved: { bg: 'bg-allowed-fg', line: 'bg-allowed-fg', label: 'Approved' },
  pending: { bg: 'bg-approval-fg', line: 'bg-approval-fg', label: 'Needs approval, pending' },
  denied: { bg: 'bg-blocked-fg', line: 'bg-blocked-fg', label: 'Denied' },
  blocked: { bg: 'bg-blocked-fg', line: 'bg-blocked-fg', label: 'Blocked' },
}

const icons = { evaluating: MinusIcon, allowed: CheckIcon, approved: CheckIcon, pending: PauseIcon, denied: XIcon, blocked: XIcon }

export function GateNode({ status }: { status: EventStatus }) {
  const Icon = icons[status]
  const t = gateTone[status]
  return (
    <span
      role="img"
      aria-label={t.label}
      className={`flex h-7 w-7 items-center justify-center rounded-full text-white ring-2 ring-surface transition-colors duration-150 ${t.bg}`}
    >
      <Icon size={16} />
    </span>
  )
}
