import type { ComponentProps, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'bg-surface border border-border-strong text-text hover:bg-surface-subtle',
  danger: 'bg-surface border border-blocked-fg text-blocked-fg hover:bg-blocked-bg',
  ghost: 'text-text-muted hover:bg-sim-bg hover:text-text',
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-8 items-center justify-center gap-2 rounded-lg px-3 text-13 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  )
}

export function SectionLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`text-xs font-semibold uppercase tracking-[0.04em] text-text-faint ${className}`}>{children}</h3>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-surface p-4 ${className}`}>{children}</div>
}

export function KeyValues({ rows }: { rows: [string, ReactNode, boolean?][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-13">
      {rows.map(([k, v, mono]) => (
        <div key={k} className="contents">
          <dt className="text-text-muted">{k}</dt>
          <dd className={`min-w-0 break-words text-text ${mono ? 'font-mono text-xs leading-5' : ''}`}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Mono({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono ${className}`}>{children}</span>
}
