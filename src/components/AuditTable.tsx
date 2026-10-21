import type { AuditEntry } from '../types'
import { DecisionPill } from './DecisionPill'

const cols = ['#', 'Time', 'Requested by', 'Tool', 'Decision', 'Reason', 'Reviewer', 'Result', 'Hash']

export function AuditTable({
  entries,
  brokenAt,
  onOpen,
}: {
  entries: AuditEntry[]
  brokenAt: number | null
  onOpen: (e: AuditEntry) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[1100px] table-fixed border-collapse text-13">
        <colgroup>
          {['48px', '84px', '190px', '130px', '140px', '1fr', '110px', '1fr', '90px'].map((w, i) => (
            <col key={i} style={w === '1fr' ? undefined : { width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-[0.04em] text-text-faint">
            {cols.map((c) => (
              <th key={c} scope="col" className="h-10 px-3 font-semibold">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const broken = e.seq === brokenAt
            return (
              <tr
                key={e.seq}
                tabIndex={0}
                onClick={() => onOpen(e)}
                onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onOpen(e))}
                className={`h-12 cursor-pointer border-b border-border last:border-b-0 ${
                  broken ? 'bg-blocked-bg' : 'hover:bg-surface-subtle'
                }`}
              >
                <td className="tnum px-3 font-mono text-xs">{e.seq}</td>
                <td className="px-3 font-mono text-xs text-text-muted">{e.time}</td>
                <td className="truncate px-3">
                  {e.requestedBy} <span className="text-text-muted">· {e.role}</span>
                </td>
                <td className="truncate px-3 font-mono text-xs">{e.tool}</td>
                <td className="px-3">
                  <DecisionPill decision={e.decision} />
                </td>
                <td className="truncate px-3 text-text-muted">{e.reason}</td>
                <td className="truncate px-3">{e.reviewer ?? '—'}</td>
                <td className="truncate px-3 text-text-muted">{e.result}</td>
                <td className="px-3 font-mono text-xs">{e.hash}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
