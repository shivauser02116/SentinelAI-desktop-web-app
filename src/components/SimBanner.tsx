import { InfoIcon } from './Icons'

export function SimBanner({ onInfo }: { onInfo: () => void }) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-1 rounded-full bg-sim-bg pl-3 pr-1 text-xs font-medium text-sim-fg">
      <span className="truncate">
        Simulated environment<span className="hidden min-[1480px]:inline"> · synthetic data · mock systems</span>
      </span>
      <button
        type="button"
        onClick={onInfo}
        aria-label="About this prototype"
        className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-border"
      >
        <InfoIcon size={16} />
      </button>
    </div>
  )
}
