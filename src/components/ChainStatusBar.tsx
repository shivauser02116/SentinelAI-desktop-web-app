import { useSession } from '../state/useSession'
import { CheckIcon, XIcon } from './Icons'
import { Button } from './ui'

export function ChainStatusBar() {
  const { chainStatus: c, verifyChain } = useSession()
  return (
    <div
      role="status"
      className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
        c.ok ? 'border-allowed-border bg-allowed-bg text-allowed-fg' : 'border-blocked-border bg-blocked-bg text-blocked-fg'
      }`}
    >
      {c.ok ? <CheckIcon size={18} label="Verified" /> : <XIcon size={18} label="Broken" />}
      <p className="flex-1 text-sm font-medium">
        {c.ok
          ? `Chain verified · ${c.count} ${c.count === 1 ? 'entry' : 'entries'}`
          : `Chain broken at entry #${c.brokenAt}. This entry, or an earlier one, was changed.`}
      </p>
      <Button onClick={verifyChain}>Verify again</Button>
    </div>
  )
}
