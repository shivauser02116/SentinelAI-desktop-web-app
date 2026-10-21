import { useState } from 'react'
import { useSession } from '../state/useSession'
import { AgentActivity } from '../components/AgentActivity'
import { CheckpointTimeline } from '../components/CheckpointTimeline'
import { EventDetailPanel } from '../components/EventDetailPanel'
import { XIcon } from '../components/Icons'
import { ScenarioList } from '../components/ScenarioList'
import { TaskGrantCard } from '../components/TaskGrantCard'
import { useMediaQuery } from '../components/useHashRoute'

export function CheckpointScreen() {
  const { events, selectedEventId, selectEvent } = useSession()
  const narrow = useMediaQuery('(max-width: 1279px)')
  const [drawer, setDrawer] = useState(false)
  const selected = events.find((e) => e.id === selectedEventId) ?? null
  const col = 'h-[calc(100vh-56px)] overflow-y-auto'

  return (
    <div className="flex">
      {!narrow && (
        <aside className={`${col} w-[320px] shrink-0 space-y-5 border-r border-border p-5`} aria-label="Task and scenarios">
          <TaskGrantCard />
          <ScenarioList />
        </aside>
      )}
      <div className={`${col} min-w-[520px] flex-1`}>
        {narrow && (
          <div className="border-b border-border bg-surface px-6 py-3">
            <ScenarioList compact />
          </div>
        )}
        <div className="mx-auto max-w-[900px] space-y-6 p-6">
          <AgentActivity />
          <CheckpointTimeline
            events={events}
            selectedId={selectedEventId}
            onSelect={(id) => {
              selectEvent(id)
              setDrawer(true)
            }}
          />
        </div>
      </div>
      {!narrow && (
        <aside className={`${col} w-[400px] shrink-0 border-l border-border bg-surface`} aria-label="Event detail">
          <EventDetailPanel event={selected} />
        </aside>
      )}
      {narrow && drawer && selected && (
        <aside
          className="fixed bottom-0 right-0 top-14 z-30 w-[420px] overflow-y-auto border-l border-border bg-surface shadow-dialog"
          aria-label="Event detail"
        >
          <button
            type="button"
            aria-label="Close detail"
            onClick={() => setDrawer(false)}
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-sim-bg"
          >
            <XIcon size={16} />
          </button>
          <EventDetailPanel event={selected} />
        </aside>
      )}
    </div>
  )
}
