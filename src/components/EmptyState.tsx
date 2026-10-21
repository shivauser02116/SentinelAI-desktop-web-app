import type { ReactNode } from 'react'

export function EmptyState({ text, icon, dashed = false }: { text: string; icon?: ReactNode; dashed?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-2 px-4 py-4 text-center text-text-muted ${
        dashed ? 'rounded-xl border border-dashed border-border-strong' : ''
      }`}
    >
      {icon}
      <p className="max-w-sm text-sm">{text}</p>
    </div>
  )
}
