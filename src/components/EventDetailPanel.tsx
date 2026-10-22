import { useState } from 'react'
import { formatArgValue, useSession } from '../state/useSession'
import type { ActionEvent } from '../types'
import { ChecksList } from './ChecksList'
import { CopyIcon } from './Icons'
import { DecisionPill } from './DecisionPill'
import { EmptyState } from './EmptyState'
import { ProvenanceBox } from './ProvenanceBox'
import { Button, KeyValues, SectionLabel } from './ui'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4">
      <SectionLabel className="mb-2.5">{title}</SectionLabel>
      {children}
    </section>
  )
}

function WhatHappened({ event }: { event: ActionEvent }) {
  const { approvals } = useSession()
  const { status, outcome } = event
  if (!outcome) return <p className="text-text-muted">Checking…</p>
  const idx = outcome.indexOf('. ')
  const head = idx > 0 ? outcome.slice(0, idx) : outcome
  const rest = idx > 0 ? outcome.slice(idx + 2) : ''
  const tone =
    status === 'allowed' || status === 'approved'
      ? 'border-allowed-border bg-allowed-bg'
      : status === 'pending'
        ? 'border-approval-border bg-approval-bg'
        : 'border-border bg-surface-subtle'
  const approval = approvals.find((a) => a.id === event.approvalId)
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      {status === 'pending' ? (
        <>
          <p className="text-sm">{outcome}</p>
          <Button variant="primary" className="mt-3" onClick={() => (window.location.hash = `#/approvals/${approval?.id ?? ''}`)}>
            Review request
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">{head}</p>
          {rest && <p className="mt-0.5 text-sm text-text-muted">{rest}</p>}
        </>
      )}
    </div>
  )
}

export function EventDetailPanel({ event }: { event: ActionEvent | null }) {
  const { auditEntries } = useSession()
  const [copied, setCopied] = useState(false)
  if (!event) return <EmptyState text="Select an action on the checkpoint to see what was attempted and what happened." />

  const entry = [...auditEntries].reverse().find((a) => a.eventId === event.id)
  const entryText = entry ? `Entry #${entry.seq} · hash ${entry.hash} · previous ${entry.prevHash}` : null
  const evaluating = event.status === 'evaluating'

  return (
    <div>
      <header className="px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-mono text-base font-semibold">{event.call.tool}</h2>
          {!evaluating && <DecisionPill decision={event.decision} />}
        </div>
        <p className="mt-1 text-13 text-text-muted">Proposed by {event.agentMode === 'live' ? 'live LLM' : 'simulated agent'} · {event.time}</p>
      </header>

      <Section title="Attempted">
        <KeyValues rows={Object.entries(event.call.args).map(([k, v]) => [k, formatArgValue(k, v), true])} />
      </Section>

      <Section title="Where this came from">
        <ProvenanceBox source={event.call.source} />
      </Section>

      <Section title="Decision">
        {evaluating ? (
          <p className="text-text-muted">Checking…</p>
        ) : (
          <>
            <div className="mb-1.5 flex items-center gap-2">
              <DecisionPill decision={event.decision} />
              <span className="font-mono text-xs text-text-muted">{event.rule}</span>
            </div>
            <p className="text-sm">{event.reason}</p>
          </>
        )}
      </Section>

      <Section title="Checks">
        <ChecksList checks={event.checks} decision={event.decision} />
      </Section>

      <Section title="What happened">
        <WhatHappened event={event} />
      </Section>

      <Section title="Audit entry">
        {entryText ? (
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 break-all font-mono text-xs">{entryText}</p>
            <button
              type="button"
              aria-label={copied ? 'Copied' : 'Copy audit entry reference'}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-sim-bg"
              onClick={() => {
                void navigator.clipboard?.writeText(entryText)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              <CopyIcon size={14} />
            </button>
          </div>
        ) : (
          <p className="text-text-muted">Not recorded yet.</p>
        )}
      </Section>
    </div>
  )
}
