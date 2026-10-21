import { useEffect, useRef, useState } from 'react'
import { useSession } from '../state/useSession'
import { LogoGlyph, RotateIcon } from './Icons'
import { ModeToggle } from './ModeToggle'
import { SimBanner } from './SimBanner'
import { UserChip } from './UserChip'
import { Button } from './ui'
import type { RouteName } from './useHashRoute'

const tabs: { name: RouteName; label: string }[] = [
  { name: 'checkpoint', label: 'Checkpoint' },
  { name: 'approvals', label: 'Approvals' },
  { name: 'audit', label: 'Audit log' },
  { name: 'policy', label: 'Policy' },
]

export function TopBar({ route, onAbout }: { route: RouteName; onAbout: () => void }) {
  const { pendingCount, reset } = useSession()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <header className="flex h-14 items-center gap-4 border-b border-border bg-surface px-6">
      <a href="#/checkpoint" className="flex items-center gap-2 rounded-md">
        <LogoGlyph />
        <span className="text-base font-semibold">SentinelAI</span>
      </a>
      <SimBanner onInfo={onAbout} />
      <nav aria-label="Main" className="ml-2 flex h-full items-stretch gap-1">
        {tabs.map((t) => {
          const active = route === t.name
          return (
            <a
              key={t.name}
              href={`#/${t.name}`}
              aria-current={active ? 'page' : undefined}
              className={`relative flex items-center gap-1.5 px-2.5 text-sm font-medium ${
                active ? 'text-brand' : 'text-text-muted hover:text-text'
              }`}
            >
              {t.label}
              {t.name === 'approvals' && pendingCount > 0 && (
                <span
                  aria-label={`${pendingCount} pending`}
                  className="min-w-5 rounded-full bg-approval-bg px-1.5 text-center text-xs font-semibold text-approval-fg ring-1 ring-approval-border"
                >
                  {pendingCount}
                </span>
              )}
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-brand" />}
            </a>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <ModeToggle />
        <UserChip />
        <div ref={wrap} className="relative">
          <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">
            <RotateIcon size={14} />
            Reset demo
          </Button>
          {open && (
            <div role="dialog" aria-label="Reset demo" className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-border bg-surface p-4 shadow-dialog">
              <p className="mb-4 text-sm">Reset clears all events, approvals and the audit log.</p>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    reset()
                    setOpen(false)
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
