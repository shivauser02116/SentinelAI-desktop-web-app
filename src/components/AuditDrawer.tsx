import { useEffect } from 'react'
import { formatArgValue } from '../state/useSession'
import type { AuditEntry } from '../types'
import { DecisionPill } from './DecisionPill'
import { XIcon } from './Icons'
import { KeyValues, SectionLabel } from './ui'

export function AuditDrawer({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', on)
    return () => document.removeEventListener('keydown', on)
  }, [onClose])

  const { eventId: _eventId, ...raw } = entry
  return (
    <aside
      role="dialog"
      aria-label={`Audit entry ${entry.seq}`}
      className="fixed bottom-0 right-0 top-14 z-30 w-[420px] overflow-y-auto border-l border-border bg-surface p-5 shadow-dialog"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Entry #{entry.seq}</h2>
        <button
          type="button"
          aria-label="Close drawer"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-sim-bg"
        >
          <XIcon size={16} />
        </button>
      </div>
      <KeyValues
        rows={[
          ['Date', entry.date],
          ['Time', entry.time, true],
          ['Requested by', `${entry.requestedBy} · ${entry.role}`],
          ['Task', entry.taskId, true],
          ['Tool', entry.tool, true],
          ['Arguments', Object.entries(entry.args).map(([k, v]) => `${k}: ${formatArgValue(k, v)}`).join('\n'), true],
          ['Decision', <DecisionPill key="d" decision={entry.decision} />],
          ['Rule', entry.rule, true],
          ['Reason', entry.reason],
          ['Reviewer', entry.reviewer ?? '—'],
          ['Result', entry.result],
          ['Hash', entry.hash, true],
          ['Previous', entry.prevHash, true],
        ]}
      />
      <SectionLabel className="mb-2 mt-5">Raw JSON</SectionLabel>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface-subtle p-3 font-mono text-xs leading-5">
        {JSON.stringify(raw, null, 2)}
      </pre>
    </aside>
  )
}
