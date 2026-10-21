import { useEffect, useRef } from 'react'
import { Button, SectionLabel } from './ui'

const simulated = [
  'The AI agent is a script. It proposes the same tool calls on every run.',
  'The business tools (invoice lookup, refund, customer export, payroll export) are mocks. No real payment or HR system is touched.',
  'All customers, employees, invoices and amounts are synthetic.',
  'Roles, limits and reviewers are prototype policy settings.',
  'Live LLM mode is optional and off by default.',
]

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    btn.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/30 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-full w-[640px] overflow-y-auto rounded-xl bg-surface p-6 shadow-dialog"
      >
        <h2 id="about-title" className="mb-5 text-xl font-semibold">
          About this prototype
        </h2>
        <SectionLabel>What is simulated</SectionLabel>
        <ul className="mb-5 mt-2 list-disc space-y-1 pl-5">
          {simulated.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <SectionLabel>What SentinelAI can control</SectionLabel>
        <p className="mb-5 mt-2">
          Actions that pass through its gateway. For each one it checks role, task scope and arguments, then allows, pauses or blocks it, and logs the result.
        </p>
        <SectionLabel>What it cannot control</SectionLabel>
        <p className="mb-6 mt-2">
          Actions an agent takes outside the gateway, tools that are not connected to it, and other agents elsewhere.
        </p>
        <div className="flex justify-end">
          <Button ref={btn} variant="primary" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>
  )
}
