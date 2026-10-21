import type { Check, Decision } from '../types'
import { CheckIcon, MinusIcon, PauseIcon, XIcon } from './Icons'

export function ChecksList({ checks, decision }: { checks: Check[]; decision: Decision }) {
  return (
    <ol className="space-y-2.5">
      {checks.map((c, i) => {
        let icon, tone, label
        if (c.status === 'passed') {
          icon = <CheckIcon size={14} />
          tone = 'bg-allowed-bg text-allowed-fg'
          label = 'Passed'
        } else if (c.status === 'failed') {
          const approval = decision === 'needs_approval'
          icon = approval ? <PauseIcon size={14} /> : <XIcon size={14} />
          tone = approval ? 'bg-approval-bg text-approval-fg' : 'bg-blocked-bg text-blocked-fg'
          label = 'Failed'
        } else {
          icon = <MinusIcon size={14} />
          tone = 'bg-sim-bg text-text-faint'
          label = 'Not evaluated'
        }
        return (
          <li key={c.name} className="flex gap-3">
            <span role="img" aria-label={label} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${tone}`}>
              {icon}
            </span>
            <div>
              <div className="text-13 font-semibold">
                {i + 1} {c.name}
              </div>
              <p className="text-13 text-text-muted">{c.text}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
