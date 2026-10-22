import { useSession } from '../state/useSession'
import type { Decision } from '../types'
import { DecisionPill } from '../components/DecisionPill'
import { ArrowRightIcon } from '../components/Icons'
import { PolicyMatrix } from '../components/PolicyMatrix'

const steps: { n: number; title: string; q: string; fails: { text?: string; d: Decision }[] }[] = [
  { n: 1, title: 'Role access', q: "Does the user's role allow this tool?", fails: [{ d: 'blocked' }] },
  { n: 2, title: 'Task scope', q: 'Is the call inside the task grant?', fails: [{ d: 'needs_approval' }] },
  {
    n: 3,
    title: 'Argument limits',
    q: 'Do the arguments break a limit?',
    fails: [
      { text: 'Over the refund limit:', d: 'needs_approval' },
      { text: 'Over the invoice total:', d: 'blocked' },
    ],
  },
  {
    n: 4,
    title: 'Input source',
    q: 'Proposed after reading untrusted text?',
    fails: [{ d: 'needs_approval' }],
  },
]

function H({ children }: { children: string }) {
  return <h2 className="mb-3 text-base font-semibold">{children}</h2>
}

export function PolicyScreen() {
  const { policy } = useSession()
  return (
    <div className="h-[calc(100vh-56px)] overflow-y-auto">
      <div className="mx-auto max-w-[1000px] space-y-8 p-6">
        <div>
          <h1 className="mb-3 text-2xl font-semibold">Policy</h1>
          <p className="rounded-lg bg-sim-bg px-4 py-2.5 text-sm font-medium text-sim-fg">
            Prototype policy settings. These are not any real company's rules.
          </p>
        </div>

        <section>
          <H>How a decision is made</H>
          <div className="flex items-stretch gap-3">
            {steps.map((s, i) => (
              <div key={s.n} className="flex flex-1 items-center gap-3">
                <div className="h-full flex-1 rounded-xl border border-border bg-surface p-4">
                  <h3 className="text-sm font-semibold">
                    {s.n} {s.title}
                  </h3>
                  <p className="mb-3 mt-1 text-13 text-text-muted">{s.q}</p>
                  <div className="space-y-1.5">
                    {s.fails.map((f) => (
                      <div key={f.d + f.text} className="flex flex-wrap items-center gap-2 text-13">
                        <span className="text-text-muted">{f.text ?? 'Fails:'}</span>
                        <DecisionPill decision={f.d} />
                      </div>
                    ))}
                  </div>
                </div>
                {i < steps.length - 1 && <ArrowRightIcon size={18} className="text-text-faint" />}
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-text-muted">The first check that fails decides. If none fail, the action is allowed.</p>
        </section>

        <section>
          <H>Role access</H>
          <PolicyMatrix />
        </section>

        <section>
          <H>Limits</H>
          <ul className="list-disc space-y-1 pl-5">
            {policy.limits.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>

        <section>
          <H>Who reviews</H>
          <ul className="list-disc space-y-1 pl-5">
            {policy.reviewers.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>

        <section>
          <H>Task grant example</H>
          <pre className="overflow-x-auto rounded-xl border border-border bg-surface p-4 font-mono text-xs leading-6">
            {policy.grantExample}
          </pre>
        </section>
      </div>
    </div>
  )
}
