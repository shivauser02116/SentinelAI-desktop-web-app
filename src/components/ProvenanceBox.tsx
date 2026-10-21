import type { CallSource } from '../types'

export function ProvenanceText({ source }: { source: CallSource }) {
  return (
    <p className="text-sm">
      {source.text}
      {source.injected && <mark className="rounded-sm bg-injected px-0.5 text-text">{source.injected}</mark>}
    </p>
  )
}

export function UntrustedBox({ source }: { source: CallSource }) {
  return (
    <div className="rounded-lg border border-border border-l-[3px] border-l-blocked-border bg-surface-subtle p-3">
      <div className="mb-1 text-xs font-semibold text-text-muted">{source.label}</div>
      <ProvenanceText source={source} />
    </div>
  )
}

export function ProvenanceBox({ source }: { source: CallSource }) {
  const untrusted = source.kind === 'untrusted'
  return (
    <div>
      <div className="rounded-lg border border-border bg-surface-subtle p-3">
        <div className="mb-1 text-xs font-semibold text-text-muted">{source.label}</div>
        <ProvenanceText source={source} />
      </div>
      {untrusted && (
        <p className="mt-2 rounded-lg bg-blocked-bg p-3 text-13 text-blocked-fg">
          The agent read this text before proposing the call. Permissions come from the signed-in user, not from the text.
        </p>
      )}
    </div>
  )
}
