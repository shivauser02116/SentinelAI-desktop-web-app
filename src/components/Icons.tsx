import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  label?: string
  className?: string
}

function Svg({ size = 16, label, className, children, sw = 2.25 }: IconProps & { children: ReactNode; sw?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable={false}
      className={`shrink-0 ${className ?? ''}`}
    >
      {children}
    </svg>
  )
}

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
)
export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6v12M15 6v12" />
  </Svg>
)
export const XIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)
export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 12h12" />
  </Svg>
)
export const InfoIcon = (p: IconProps) => (
  <Svg {...p} sw={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.8v.2" />
  </Svg>
)
export const RotateIcon = (p: IconProps) => (
  <Svg {...p} sw={2}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5" />
  </Svg>
)
export const CopyIcon = (p: IconProps) => (
  <Svg {...p} sw={2}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </Svg>
)
export const ChevronIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
)
export const ArrowRightIcon = (p: IconProps) => (
  <Svg {...p} sw={2}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </Svg>
)

export function LogoGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable={false} className="shrink-0 text-brand">
      <rect x="1" y="9" width="18" height="2" rx="1" fill="currentColor" />
      <rect x="8.5" y="2" width="3" height="16" rx="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="3" fill="#fff" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
