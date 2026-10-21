# SentinelAI — Implementation Spec

> Written during Phase 0 inspection. Status: FINALIZED (pending "go" from user).

---

## Product Statement

SentinelAI places a policy checkpoint between AI agents and workplace tools. It evaluates each tool call against role and risk rules, allows safe actions, requests human approval for sensitive actions, blocks unauthorized actions, and records every decision in an audit trail. Its key idea is that **the agent is an untrusted proposer**. Authority comes from the signed-in human user and from a task-scoped grant, never from the agent or from text the agent read.

---

## Ground Rules (Non-Negotiable)

1. Do not change the visual design: no layout, colour, spacing, typography or copy changes unless asked.
2. Everything runs in the browser. No backend, no database, no network calls. Offline prototype.
3. All data is synthetic and mock. No real names, emails, payment integrations or secrets.
4. No new features beyond this spec. New dependencies: `vitest` (dev) and `@testing-library/react` (dev, only if needed). State management: `useReducer + Context` only.
5. Mock business tools must be reachable ONLY through the gateway. UI must never import `src/gateway/tools.ts`.
6. Work in phases. After each phase run `npm test`, `npx tsc --noEmit`, `npm run build`, report results. Stop if any fail.
7. If the Figma export conflicts with this spec, stop and ask. Do not guess.

---

## Target Architecture

```
src/gateway/types.ts        — shared gateway types
src/gateway/policy.ts       — pure function evaluate(call, context) → decision
src/gateway/grants.ts       — task grants (issue, check, expiry)
src/gateway/tools.ts        — mock tools + createToolRegistry(); NEVER imported by components/screens/state
src/gateway/gateway.ts      — public entry: submit(call, ctx) and resolveApproval(...)
src/gateway/audit.ts        — append-only hash-chained log + verifyChain()
src/gateway/mockDb.ts       — mock invoices, customers, counters

src/agent/AgentAdapter.ts   — interface AgentAdapter
src/agent/simulatedAgent.ts — deterministic scripted agent

src/session/SessionController.ts — coordinates agent → gateway → audit → UI state

src/state/useSession.tsx    — KEEP exact public API; swap internals to SessionController

src/demo/tamper.ts          — demo-only tampering helper
```

---

## Policy Spec

### Roles and Tools

| Role | invoice.lookup | refund.issue | customer.export | payroll.export |
|------|---------------|-------------|----------------|---------------|
| Support Agent | ✅ | ✅ (approval >₹2k) | ❌ | ❌ |
| Support Lead | ✅ | ✅ (approval >₹2k) | ✅ | ❌ |
| Finance Admin | ❌ | ❌ | ❌ | ✅ |
| Ops Manager | ❌ | ❌ | ❌ | ❌ |

### Evaluation Order (first failing check wins)

1. **Role access** (`role.tool_access`): role not permitted → Blocked. Tool never called.
2. **Task scope** (`task.scope`): tool not in grant, resource outside grant, or grant expired → Needs approval.
3. **Argument limits**:
   - refund ≤ ₹2,000 → continues to Allowed
   - refund > ₹2,000 → Needs approval (`args.refund_limit`)
   - refund > invoice total → Blocked (`args.refund_total`)
4. **Allowed** (`allow.default`)

### Prototype Limits

- Refund without approval: up to ₹2,000
- Refund can never exceed the invoice total (hard block, approval cannot override)

### Reason Strings (exact templates)

- **allowed**: `"{Role} role may use {tool}, and the call is inside this task's grant."`
- **role fail**: `"{Role} role has no access to {tool}. The tool was not called."`
- **role fail (untrusted provenance)**: prefix `"Permissions come from the signed-in user, not from text the agent read. "` to the role-fail string
- **scope fail**: `"{Role} role allows {tool}, but this task only covers {resource list} and the tools {tool list}. The call is outside the task grant."`
- **grant expired**: `"The task grant expired at {HH:mm}. The call is outside the task grant."`
- **refund over limit**: `"Refund of ₹{amount} is above the ₹2,000 limit for refunds without approval."`
- **refund over total**: `"Refund of ₹{amount} is more than the invoice total of ₹{total}. Approval cannot override this limit."`

Each decision returns `checks[]` of three items: `{ id, status: 'passed' | 'failed' | 'not_evaluated', note }`. Notes must match the Figma copy in `src/data/scenarios.ts`.

---

## Task Grants

Fields: `taskId, userId, allowTools[], allowResources (customer IDs), limits, issuedAt, expiresAt (issuedAt + 15 min)`.

- Clock is injectable: `new Gateway({ now: () => Date })`
- Wire UI countdown in `TaskGrantCard` to `expiresAt`

---

## Mock Tools (called only via gateway)

- **invoice.lookup**(`{invoice_id, customer_id}`) → returns invoice from mockDb, or not_found error
- **refund.issue**(`{invoice_id, amount, currency, reason}`) → `{ refund_id: "R-7001", ... }`. Counter: R-7001, R-7002, ... resets on reset()
- **customer.export**(`{scope, fields}`) → `{ records: 1240, fields, note: "synthetic" }`. No real row data.
- **payroll.export**(`{period, format, destination}`) → `{ rows: 86, note: "synthetic" }`

Every tool call increments a `callCount` (assertable in tests).

---

## Approvals

- Needs approval → creates `ApprovalRequest` with frozen copy of call args
- Required reviewer role: Support Agent requester → Support Lead (Priya Nair); Support Lead requester → Ops Manager (Dev Malhotra)
- `resolveApproval({ approvalId, reviewerId, outcome: 'approve'|'deny', note })` rules:
  - reviewerId must differ from requester
  - reviewer must hold required role
  - resolved approval cannot be resolved again
  - deny requires non-empty trimmed note
- Approve: executes frozen original call once, appends `approval_outcome` audit entry with result
- Deny: executes nothing, appends `approval_outcome` audit entry with outcome "denied" and note
- Hard Blocked decisions never create approvals

---

## Audit Log

- Append-only API: `append(entry)` only. No update or delete exposed.
- Entry fields: `index, timestamp (ISO), eventId, type ('decision'|'approval_outcome'), taskId, user {id,name,role}, agentMode ('simulated'|'live'), tool, args, provenance {label, untrusted}, decision, ruleId, reason, checks[], reviewer? {id,name,role,outcome,note}, execution {status: 'executed'|'not_executed'|'pending', result?}, prevHash, hash`
- `hash = SHA-256 hex of (prevHash + canonicalJSON(entry without hash field))`
  - `canonicalJSON`: sorts keys recursively, no whitespace
  - Genesis prevHash: 64 zeros
  - Use `globalThis.crypto.subtle` (async)
  - Run gateway tests in Vitest's `node` environment
- `verifyChain(entries)` → `{ok: true}` or `{ok: false, brokenAt: index}`
- UI shows hashes shortened to 8 characters
- Allowed and Blocked → one entry. Needs approval → decision entry (execution pending) + later approval_outcome entry.
- `src/demo/tamper.ts`: `tamperDemo()` mutates one stored entry's reason in memory so `verifyChain` fails at that index. `reset()` restores the log.

---

## Simulated Agent

```typescript
interface AgentAdapter {
  mode: 'simulated' | 'live'
  run(task, userMessage, emit): Promise<void>
}
```

`emit` receives `{ kind: 'agent_message', text }` or `{ kind: 'proposed_call', call, provenance }`.

- `simulatedAgent` follows the five scripts in `src/data/scenarios.ts`
- Deterministic: no randomness, same calls every run
- Delays injectable: 0 in tests, Figma timings in UI (600 / 1200 / 1800 / 2200 ms)
- Scenario file: inputs only. Remove baked outcomes from runtime path; use as EXPECTED values in tests.
- Live LLM mode: NOT part of this task. Toggle disabled. Selecting it shows toast "Live LLM mode isn't configured".

---

## Session Controller and UI Wiring

`runScenario(id)`:
1. Reset task context
2. Issue the grant
3. `agent.run` → for each `proposed_call`, call `gateway.submit`
4. Dispatch UI events with same timing/sequence as mock hook

`resolveApproval`, `verifyChain`, `tamperDemo`, `reset` → map onto gateway and audit.

- IDs: deterministic counters (`TASK-1001`, `EVT-001`, `APR-001`, `R-7001`), reset on `reset()`
- State in memory only (page refresh resets the demo)
- Approvals badge, audit table, chain status, detail panel → all derive from same controller state

---

## Tests (Vitest)

1. S1: invoice.lookup is Allowed, callCount = 1
2. S2: refund ₹25,000 → Needs approval, callCount 0; approve → callCount 1 + audit entry with reviewer; deny → callCount 0
3. S3: payroll.export by Support Agent → Blocked, callCount 0, audit entry with reason
4. S4: Blocked, untrusted-provenance prefix in reason, `provenance.untrusted = true` in audit, callCount 0
5. S5: customer.export by Support Lead → Needs approval with `task.scope`; approve executes once
6. Same payroll.export by Finance Admin → Allowed (proves rule is role-based)
7. Boundary: refund exactly ₹2,000 → Allowed; ₹2,001 → needs approval; above ₹73,000 on INV-1042 → Blocked
8. Expired grant: call after `expiresAt` (fake clock) → Needs approval with expiry reason
9. Self-approval rejected; wrong-role reviewer rejected; double resolution rejected; deny without note rejected
10. Tampering one stored audit entry → `verifyChain` returns `brokenAt` equal to that index
11. Determinism: running all five scenarios twice (after reset) → identical sequences of (tool, args, decision, ruleId)
12. For every scenario, engine output equals baked expected outcome in Figma data (decision, ruleId, reason, checks, result text)
13. Architecture guard: scan src/components, src/screens, src/state; fail if any file imports from src/gateway/tools

---

## Phases and Gates

| Phase | Work | Tests |
|-------|------|-------|
| 0 | Inspect and plan (this document) | — |
| 1 | types, mockDb, tools, grants, policy, gateway.submit | 1–8, 12 (decision parts) |
| 2 | audit chain | 10 |
| 3 | approvals | 2, 5, 9 |
| 4 | simulated agent, SessionController, swap useSession internals | 11, 13, UI wiring |
| 5 | Browser verification of all five scenarios | Screenshots |
| 6 | Docs and build | — |

Stop after each phase and report.

---

## Resource Resolution

- `refund.issue` and `invoice.lookup`: resolve customer via invoice in mockDb (INV-1042 → C-204)
- `customer.export` with scope "all_customers" → resolves to ALL
- `payroll.export` → resolves to payroll

---

## Docs Requirements

- `README.md`: product statement, how to run (install/dev/test/build), five scenarios + expected results, what is simulated, system limits (only controls actions through its gateway), policy settings + "not any real company's rules" note, synthetic data note
- `docs/ARCHITECTURE.md`: Mermaid flow diagram (user → agent → gateway → tool, with policy/approvals/audit) + short module descriptions
- `vite.config`: set `base: './'` for static build under sub-path
- `.gitignore`: excludes node_modules, dist, .env files
- No deployment. Provide exact steps for GitHub + Vercel/Netlify.

---

## Definition of Done

- [ ] All tests pass
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] All five scenarios work end-to-end in browser, no console errors
- [ ] Approve and deny both work
- [ ] Blocked call never executes
- [ ] Verify shows intact; tamper shows broken at right entry; Reset restores clean state
- [ ] UI matches baseline screenshots
- [ ] README and ARCHITECTURE.md exist
- [ ] Final report lists changes, deviations, and uncertainties
