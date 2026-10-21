import { useState } from 'react'
import { useSession } from '../state/useSession'
import type { AuditEntry, Decision } from '../types'
import { AuditDrawer } from '../components/AuditDrawer'
import { AuditTable } from '../components/AuditTable'
import { ChainStatusBar } from '../components/ChainStatusBar'
import { EmptyState } from '../components/EmptyState'
import { Tooltip } from '../components/Tooltip'
import { Button } from '../components/ui'

const filters: { value: 'all' | Decision; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'allowed', label: 'Allowed' },
  { value: 'needs_approval', label: 'Needs approval' },
  { value: 'blocked', label: 'Blocked' },
]

export function AuditScreen() {
  const { auditEntries, chainStatus, tamperDemo } = useSession()
  const [filter, setFilter] = useState<'all' | Decision>('all')
  const [open, setOpen] = useState<AuditEntry | null>(null)
  const rows = auditEntries.filter((e) => filter === 'all' || e.decision === filter)

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(auditEntries, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'sentinelai-audit-log.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-[calc(100vh-56px)] overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <div className="flex items-center gap-3">
            <div role="radiogroup" aria-label="Filter by decision" className="flex rounded-lg border border-border-strong bg-surface p-0.5 text-13">
              {filters.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.value}
                  onClick={() => setFilter(f.value)}
                  className={`min-h-8 rounded-md px-3 font-medium ${
                    filter === f.value ? 'bg-brand text-white' : 'text-text-muted hover:text-text'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Button onClick={exportJson} disabled={!auditEntries.length}>
              Export JSON
            </Button>
          </div>
        </div>

        <ChainStatusBar />

        {auditEntries.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface py-10">
            <EmptyState text="No actions recorded yet. Run a scenario from the Checkpoint." />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface py-10">
            <EmptyState text="No entries match this filter." />
          </div>
        ) : (
          <AuditTable entries={rows} brokenAt={chainStatus.brokenAt} onOpen={setOpen} />
        )}

        <div>
          <Tooltip text="Changes one stored entry so you can see verification fail. Reset restores it." align="left">
            <Button variant="ghost" onClick={tamperDemo} disabled={!auditEntries.length}>
              Demo: tamper with an entry
            </Button>
          </Tooltip>
        </div>
      </div>
      {open && <AuditDrawer entry={auditEntries.find((e) => e.seq === open.seq) ?? open} onClose={() => setOpen(null)} />}
    </div>
  )
}
