import { useSession } from '../state/useSession'
import { ScenarioItem } from './ScenarioItem'
import { SectionLabel } from './ui'

export function ScenarioList({ compact = false }: { compact?: boolean }) {
  const { scenarios, runningId, doneIds, runScenario, events, selectedEventId, activity } = useSession()
  const selectedScenario =
    runningId ?? events.find((e) => e.id === selectedEventId)?.scenarioId ?? activity?.scenarioId ?? null
  return (
    <section aria-labelledby="scn-title">
      <SectionLabel>
        <span id="scn-title">Scenarios</span>
      </SectionLabel>
      <ul className={`mt-2 ${compact ? 'flex gap-3 overflow-x-auto pb-1' : 'space-y-2'}`}>
        {scenarios.map((s) => (
          <ScenarioItem
            key={s.id}
            scenario={s}
            compact={compact}
            running={runningId === s.id}
            done={doneIds.includes(s.id)}
            selected={selectedScenario === s.id}
            disabled={runningId !== null}
            onRun={() => runScenario(s.id)}
          />
        ))}
      </ul>
    </section>
  )
}
