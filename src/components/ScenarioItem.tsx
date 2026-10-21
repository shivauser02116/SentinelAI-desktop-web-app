import type { Scenario } from '../types'
import { DecisionPill } from './DecisionPill'
import { Button } from './ui'

export function ScenarioItem({
  scenario,
  running,
  done,
  selected,
  disabled,
  compact = false,
  onRun,
}: {
  scenario: Scenario
  running: boolean
  done: boolean
  selected: boolean
  disabled: boolean
  compact?: boolean
  onRun: () => void
}) {
  return (
    <li
      className={`rounded-lg border bg-surface p-3 ${compact ? 'w-64 shrink-0' : ''} ${
        selected ? 'border-border border-l-[3px] border-l-brand' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sim-bg text-xs font-semibold text-sim-fg">
          {scenario.number}
        </span>
        <h3 className="text-13 font-semibold leading-6">{scenario.title}</h3>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 pl-8.5">
        <DecisionPill decision={scenario.expected} outline={!done} />
        <Button onClick={onRun} disabled={disabled} className="min-h-8 px-2.5 text-xs">
          {running ? 'Running…' : done ? 'Run again' : 'Run'}
        </Button>
      </div>
    </li>
  )
}
