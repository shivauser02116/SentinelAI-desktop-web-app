import type { ActionEvent } from '../types'
import { DecisionPill } from './DecisionPill'
import { GateNode, gateTone } from './GateNode'

export function CheckpointRow({
  event,
  selected,
  onSelect,
}: {
  event: ActionEvent
  selected: boolean
  onSelect: () => void
}) {
  const { status } = event
  const evaluating = status === 'evaluating'
  const passed = status === 'allowed' || status === 'approved'
  const stopped = status === 'blocked' || status === 'denied'
  const muted = stopped
  const happened = evaluating ? 'Checking…' : event.outcome

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-row
      onClick={onSelect}
      className={`relative grid min-h-[88px] w-full grid-cols-[1fr_56px_1fr] rounded-lg border text-left transition-colors ${
        selected ? 'border-brand bg-surface shadow-row' : 'border-transparent hover:bg-surface-subtle'
      }`}
    >
      <div className="min-w-0 py-3 pl-4 pr-3">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-mono text-xs text-text-faint">{event.time}</span>
          <span className="rounded-full bg-sim-bg px-2 text-xs font-medium text-sim-fg">Scenario {event.scenarioNumber}</span>
        </div>
        <div className="font-mono text-sm font-semibold text-text">{event.call.tool}</div>
        <div className="truncate text-13 text-text-muted">{event.call.summary}</div>
      </div>

      <div className="relative" aria-hidden={false}>
        <span className={`absolute -bottom-px -top-px left-1/2 w-0.5 -translate-x-1/2 transition-colors duration-150 ${gateTone[status].line}`} />
        <span className="absolute left-0 top-1/2 h-0.5 w-[14px] -translate-y-1/2 bg-text-faint" />
        {passed && <span className="absolute right-0 top-1/2 h-0.5 w-[14px] -translate-y-1/2 bg-allowed-fg" />}
        {stopped && (
          <span className="absolute right-0 top-1/2 w-[10px] -translate-y-1/2 border-t-2 border-dashed border-text-faint" />
        )}
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <GateNode status={status} />
        </span>
      </div>

      <div className="flex min-w-0 flex-col justify-center gap-1 py-3 pl-3 pr-4">
        {!evaluating && <DecisionPill decision={event.decision} />}
        {happened && (
          <p className={`line-clamp-2 text-13 ${evaluating || muted ? 'text-text-muted' : 'text-text'}`}>{happened}</p>
        )}
      </div>
    </button>
  )
}
