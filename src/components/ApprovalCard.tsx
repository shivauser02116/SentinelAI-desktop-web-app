import { useState } from 'react'
import { formatArgValue, useSession } from '../state/useSession'
import type { ApprovalRequest } from '../types'
import { CheckIcon, XIcon } from './Icons'
import { Button, KeyValues, SectionLabel } from './ui'

export function ApprovalCard({ approval }: { approval: ApprovalRequest }) {
  const { resolveApproval } = useSession()
  const [note, setNote] = useState('')
  const [error, setError] = useState(false)
  const done = approval.status !== 'pending'

  if (done) {
    const ok = approval.status === 'approved'
    return (
      <div className="w-full max-w-[720px] rounded-xl border border-border bg-surface p-6">
        <SectionLabel className="font-mono">{approval.id}</SectionLabel>
        <p className="mb-4 mt-1 text-xl font-semibold">{approval.title}</p>
        <div
          role="status"
          className={`flex gap-3 rounded-lg border p-4 ${ok ? 'border-allowed-border bg-allowed-bg' : 'border-border bg-sim-bg'}`}
        >
          <span className={`mt-0.5 ${ok ? 'text-allowed-fg' : 'text-blocked-fg'}`}>
            {ok ? <CheckIcon size={20} label="Approved" /> : <XIcon size={20} label="Denied" />}
          </span>
          <div>
            <p className="font-semibold">{ok ? 'Approved. The tool ran once.' : 'Denied. Nothing ran.'}</p>
            <p className="mt-1 text-sm text-text-muted">{approval.outcome}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => (window.location.hash = '#/checkpoint')}>Back to checkpoint</Button>
          <Button variant="primary" onClick={() => (window.location.hash = '#/audit')}>
            View in audit log
          </Button>
        </div>
      </div>
    )
  }

  const deny = () => {
    if (!note.trim()) return setError(true)
    resolveApproval(approval.id, 'deny', note)
  }

  return (
    <div className="w-full max-w-[720px] rounded-xl border border-border bg-surface p-6">
      <SectionLabel className="font-mono">{approval.id}</SectionLabel>
      <h2 className="mt-1 text-2xl font-semibold">Approval needed</h2>
      <p className="mb-5 mt-2 text-xl font-semibold">{approval.title}</p>

      <div className="space-y-5">
        <section>
          <SectionLabel className="mb-2">Requested by</SectionLabel>
          <p className="text-sm">
            {approval.requester.name}, {approval.requester.role} · via simulated agent ·{' '}
            <span className="font-mono text-xs">{approval.taskId}</span>
          </p>
        </section>

        <section>
          <SectionLabel className="mb-2">Action details</SectionLabel>
          <div className="rounded-lg border border-border bg-surface-subtle p-3">
            <KeyValues
              rows={[
                ['tool', approval.tool, true],
                ...Object.entries(approval.args).map(([k, v]): [string, string, boolean] => [k, formatArgValue(k, v), true]),
              ]}
            />
          </div>
        </section>

        <section>
          <SectionLabel className="mb-2">Why approval is needed</SectionLabel>
          <p className="rounded-lg border border-approval-border bg-approval-bg p-3 text-sm text-approval-fg">{approval.reason}</p>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-sim-bg p-3 text-13">
            <p className="font-semibold">If you approve</p>
            <p className="text-text-muted">The mock tool runs once and the result is logged.</p>
          </div>
          <div className="rounded-lg bg-sim-bg p-3 text-13">
            <p className="font-semibold">If you deny</p>
            <p className="text-text-muted">Nothing runs. Your reason is logged.</p>
          </div>
        </div>

        <section>
          <p className="text-sm font-medium">
            Reviewing as {approval.reviewer.name} · {approval.reviewer.role}
          </p>
          <p className="text-xs text-text-muted">Requesters can't approve their own requests.</p>
        </section>

        <div>
          <label htmlFor="note" className="mb-1.5 block text-13 font-medium">
            Reviewer note (required to deny)
          </label>
          <textarea
            id="note"
            rows={3}
            value={note}
            placeholder="Add a short reason"
            aria-invalid={error}
            aria-describedby={error ? 'note-err' : undefined}
            onChange={(e) => {
              setNote(e.target.value)
              if (e.target.value.trim()) setError(false)
            }}
            className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm placeholder:text-text-faint ${
              error ? 'border-blocked-fg' : 'border-border-strong'
            }`}
          />
          {error && (
            <p id="note-err" className="mt-1 text-13 text-blocked-fg">
              Add a reason to deny this request.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="danger" onClick={deny}>
            Deny
          </Button>
          <Button variant="primary" onClick={() => resolveApproval(approval.id, 'approve', note)}>
            Approve and run
          </Button>
        </div>
      </div>
    </div>
  )
}
