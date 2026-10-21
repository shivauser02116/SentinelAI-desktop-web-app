import { useId, type ReactNode } from 'react'

export function Tooltip({ text, children, align = 'center' }: { text: string; children: ReactNode; align?: 'center' | 'right' | 'left' }) {
  const id = useId()
  const pos = align === 'right' ? 'right-0' : align === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2'
  return (
    <span className="group relative inline-flex" aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute top-full z-40 mt-2 hidden w-60 rounded-lg bg-brand px-3 py-2 text-xs text-white shadow-dialog group-focus-within:block group-hover:block ${pos}`}
      >
        {text}
      </span>
    </span>
  )
}
