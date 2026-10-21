import { useSession } from '../state/useSession'
import { CheckIcon, MinusIcon } from './Icons'

export function PolicyMatrix() {
  const { policy } = useSession()
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full border-collapse text-13">
        <thead>
          <tr className="border-b border-border text-left">
            <th scope="col" className="h-10 px-4 text-xs font-semibold uppercase tracking-[0.04em] text-text-faint">
              Role
            </th>
            {policy.tools.map((t) => (
              <th key={t} scope="col" className="px-4 font-mono text-xs font-semibold">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {policy.roles.map((r) => (
            <tr key={r.role} className="h-14 border-b border-border last:border-b-0">
              <th scope="row" className="px-4 text-left font-medium">
                {r.role}
                {r.role === 'Ops Manager' && <span className="font-normal text-text-muted"> (reviewer only)</span>}
                <div className="text-xs font-normal text-text-muted">{r.person.replace(' · reviewer only', '')}</div>
              </th>
              {policy.tools.map((t) => {
                const a = r.access[t]
                return (
                  <td key={t} className="px-4">
                    {a === 'no' ? (
                      <span className="inline-flex items-center gap-1 text-text-faint">
                        <MinusIcon size={14} label="No access" />
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <CheckIcon size={14} className="text-allowed-fg" label="Allowed" />
                        {a === 'approval' && <span className="text-approval-fg">(approval above ₹2,000)</span>}
                      </span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
