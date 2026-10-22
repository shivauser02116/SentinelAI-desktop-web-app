import type { Alert } from '../gateway/alerts'
import { XIcon, PauseIcon, CheckIcon } from './Icons'

interface Props {
  alert: Alert
}

export function AlertRow({ alert }: Props) {
  const isHigh = alert.severity === 'high'
  const isMedium = alert.severity === 'medium'

  const formattedTime = alert.timestamp.includes('T')
    ? alert.timestamp.split('T')[1].slice(0, 8)
    : alert.timestamp

  const titleStartsTool = alert.title.startsWith(alert.tool)
  const remainderTitle = titleStartsTool ? alert.title.slice(alert.tool.length) : alert.title

  return (
    <li className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3.5 sm:items-center">
        {/* Severity pill */}
        <div
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
            isHigh
              ? 'bg-blocked-bg text-blocked-fg ring-blocked-border'
              : isMedium
                ? 'bg-approval-bg text-approval-fg ring-approval-border'
                : 'bg-sim-bg text-sim-fg ring-border'
          }`}
          aria-label={`Severity: ${alert.severity}`}
        >
          {isHigh ? (
            <XIcon size={12} />
          ) : isMedium ? (
            <PauseIcon size={12} />
          ) : (
            <CheckIcon size={12} />
          )}
          <span className="capitalize">{alert.severity}</span>
        </div>

        {/* Center content */}
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-semibold text-text">
              {titleStartsTool && (
                <span className="mr-1.5 font-mono text-xs font-medium text-text-muted">
                  {alert.tool}
                </span>
              )}
              {remainderTitle}
            </h3>
            {alert.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border bg-sim-bg px-2 py-0.5 text-xs text-sim-fg"
              >
                {tag}
              </span>
            ))}
          </div>

          <p className="text-13 text-text-muted">{alert.detail}</p>

          <div className="text-xs text-text-faint">
            Entry #{alert.entryIndex} · {formattedTime || 'Today'} · {alert.user.name} · {alert.user.role}
          </div>
        </div>
      </div>

      {/* Right action button */}
      <div className="shrink-0 self-end sm:self-center">
        {alert.state === 'action_needed' && alert.approvalId ? (
          <a
            href={`#/approvals/${alert.approvalId}`}
            className="inline-flex min-h-8 items-center justify-center rounded-lg bg-brand px-3 text-xs font-medium text-white hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            Review request
          </a>
        ) : (
          <a
            href={`#/audit/${alert.entryIndex}`}
            className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-muted hover:bg-surface-subtle hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            View entry
          </a>
        )}
      </div>
    </li>
  )
}
