import { useRef, useState } from 'react'
import { Tooltip } from './Tooltip'
import { useSession } from '../state/useSession'
import { LIVE_MODEL } from '../agent/anthropicClient'

export function ModeToggle() {
  const { mode, liveReady, setMode, setLiveConfig, clearLiveConfig } = useSession()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [modelName, setModelName] = useState(LIVE_MODEL)
  const popoverRef = useRef<HTMLDivElement>(null)

  const isLive = mode === 'live'

  const handleSimulatedClick = () => {
    if (isLive) {
      clearLiveConfig()
    }
    setPopoverOpen(false)
  }

  const handleLiveLLMClick = () => {
    if (isLive) return
    setPopoverOpen(true)
  }

  const handleUseLiveAgent = () => {
    if (!apiKey.trim()) return
    setLiveConfig({ apiKey: apiKey.trim(), model: modelName.trim() || LIVE_MODEL })
    setPopoverOpen(false)
  }

  const handleCancel = () => {
    setPopoverOpen(false)
  }

  return (
    <div className="relative">
      <div role="radiogroup" aria-label="Agent mode" className="flex rounded-lg border border-border-strong bg-surface-subtle p-0.5 text-13">
        <button
          type="button"
          role="radio"
          aria-checked={!isLive}
          onClick={handleSimulatedClick}
          className={`min-h-7 rounded-md px-2.5 font-medium transition-colors ${!isLive ? 'bg-brand text-white' : 'text-text-faint hover:text-text'}`}
        >
          Simulated agent
        </button>
        <Tooltip
          text={liveReady ? 'Live LLM active (Anthropic Claude). SentinelAI still decides every call.' : 'Uses a real LLM to propose actions. SentinelAI still decides every call.'}
          align="right"
        >
          <button
            type="button"
            role="radio"
            aria-checked={isLive}
            tabIndex={0}
            onClick={handleLiveLLMClick}
            className={`min-h-7 rounded-md px-2.5 font-medium transition-colors ${isLive ? 'bg-brand text-white' : 'cursor-pointer text-text-faint hover:text-text'}`}
          >
            Live LLM
          </button>
        </Tooltip>
      </div>

      {popoverOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-border bg-surface p-4 shadow-lg"
        >
          <h3 className="mb-1 text-sm font-semibold text-text">Live LLM mode</h3>
          <p className="mb-3 text-xs text-text-muted">Provider: <span className="font-medium text-text">Anthropic (Claude)</span></p>

          <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="live-model">
            Model
          </label>
          <input
            id="live-model"
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            className="mb-3 w-full rounded-lg border border-border bg-surface-subtle px-3 py-1.5 text-sm text-text outline-none focus:border-brand"
          />

          <label className="mb-1 block text-xs font-medium text-text-muted" htmlFor="live-api-key">
            API key
          </label>
          <input
            id="live-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            className="mb-3 w-full rounded-lg border border-border bg-surface-subtle px-3 py-1.5 text-sm text-text outline-none focus:border-brand"
          />

          <p className="mb-3 text-[11px] leading-relaxed text-text-faint">
            Your key stays in this tab's memory and is sent only to api.anthropic.com. Use a key you can revoke. In a real deployment, calls would go through a server.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCancel}
              className="flex-1 rounded-lg border border-border py-1.5 text-sm font-medium text-text-muted hover:bg-surface-subtle"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUseLiveAgent}
              disabled={!apiKey.trim()}
              className="flex-1 rounded-lg bg-brand py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Use live agent
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
