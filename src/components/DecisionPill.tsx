import type { Decision } from '../types'
import { CheckIcon, PauseIcon, XIcon } from './Icons'

const cfg = {
  allowed: { label: 'Allowed', cls: 'bg-allowed-bg text-allowed-fg border-allowed-border', Icon: CheckIcon },
  needs_approval: { label: 'Needs approval', cls: 'bg-approval-bg text-approval-fg border-approval-border', Icon: PauseIcon },
  blocked: { label: 'Blocked', cls: 'bg-blocked-bg text-blocked-fg border-blocked-border', Icon: XIcon },
} as const

const outlineTone = {
  allowed: 'text-allowed-fg',
  needs_approval: 'text-approval-fg',
  blocked: 'text-blocked-fg',
} as const

export function DecisionPill({ decision, outline = false }: { decision: Decision; outline?: boolean }) {
  const { label, cls, Icon } = cfg[decision]
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold ${
        outline ? `border-border-strong bg-transparent ${outlineTone[decision]}` : cls
      }`}
    >
      <Icon size={14} />
      {label}
    </span>
  )
}
