import { Tooltip } from './Tooltip'
import { useSession } from '../state/useSession'

export function ModeToggle() {
  const { requestLiveMode } = useSession()
  return (
    <div role="radiogroup" aria-label="Agent mode" className="flex rounded-lg border border-border-strong bg-surface-subtle p-0.5 text-13">
      <button
        type="button"
        role="radio"
        aria-checked="true"
        className="min-h-7 rounded-md bg-brand px-2.5 font-medium text-white"
      >
        Simulated agent
      </button>
      <Tooltip text="Optional. Needs an API key and network. Not needed for this demo." align="right">
        <button
          type="button"
          role="radio"
          aria-checked="false"
          aria-disabled="true"
          tabIndex={0}
          onClick={requestLiveMode}
          className="min-h-7 cursor-not-allowed rounded-md px-2.5 font-medium text-text-faint"
        >
          Live LLM
        </button>
      </Tooltip>
    </div>
  )
}
