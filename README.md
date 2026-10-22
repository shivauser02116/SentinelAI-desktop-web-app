# SentinelAI — Policy Checkpoint for Workplace AI Agents

> **SentinelAI places a policy checkpoint between AI agents and workplace tools.** It evaluates each tool call against role, task-scope, argument limit, and input source rules, allows safe actions, requests human approval for sensitive actions, blocks unauthorized actions, and records every decision in a tamper-evident audit trail.

The core premise of SentinelAI is that **the agent is an untrusted proposer**. Authority originates from the signed-in human user and from a task-scoped grant, never from the agent or from external text the agent processed.

---

## Key Features

- **4-Stage Role & Risk Policy Engine**: Pure, deterministic evaluation of:
  1. `role_access`: Role capability checks
  2. `task_scope`: Task-scoped resource and grant expiry checks
  3. `arg_limits`: Value thresholds, refund ceilings, and export destination domain restrictions (`@sentinel-demo.example`)
  4. `input_source`: Coarse untrusted-input provenance escalation
- **Derived Real-Time Alerts View**: Pure derivation of system interventions, categorized by severity (High, Medium, Info) and state (Action Needed, Contained, Resolved). Deep links directly into audit entries (`#/audit/:index`).
- **Task-Scoped Grants**: Time-bounded (15-minute) authorizations that strictly limit the tools and specific customer resources an agent can access for a given assignment.
- **Human-in-the-Loop Approvals**: High-risk or out-of-scope actions trigger role-segregated approval requests with frozen tool arguments. A Support Agent's request routes to a Support Lead; a Support Lead's or Finance Admin's request routes to an Ops Manager. Self-approval is rejected.
- **Live LLM Mode (Anthropic Claude BYOK)**: Optional provider-backed mode where real models (such as Claude 3.5 Sonnet) propose tool calls. Sent via direct browser fetch (`anthropic-dangerous-direct-browser-access: true`) using an ephemeral in-memory API key that is never persisted, logged, or sent to backend storage.
- **Append-Only Cryptographic Audit Log**: Every decision and approval outcome is recorded in a SHA-256 hash-chained ledger using Web Crypto (`crypto.subtle`) and recursive canonical JSON.
- **100% Offline & Private by Default**: Simulated agent mode runs entirely in the browser with self-hosted fonts (`@fontsource/inter`, `@fontsource/jetbrains-mono`), zero external network requests, and zero telemetry.
- **Architectural Isolation**: Business tools are encapsulated behind the gateway and can never be directly imported by UI screens or components.

---

## Seven Prototype Scenarios

| # | Scenario | Proposed Action | Evaluated Rule | Decision | Outcome |
|---|---|---|---|---|---|
| **S1** | **Look up an invoice** | `invoice.lookup` on INV-1042 | `allow.default` | **Allowed** | Executed. Returns invoice details for customer C-204. |
| **S2** | **Issue high-value refund** | `refund.issue` for ₹25,000 | `args.refund_limit` | **Needs Approval** | Queued for review by Priya Nair (Support Lead). Executed upon approval; creates refund R-7001. |
| **S3** | **Export payroll without authorization** | `payroll.export` (CSV) | `role.tool_access` | **Blocked** | Support Agent role lacks permissions for payroll. Tool was never called. |
| **S4** | **Prompt injection in a ticket** | `payroll.export` via injected note | `role.tool_access` | **Blocked** | Untrusted provenance identified. Permissions derive from user, not ticket text. Tool was never called. |
| **S5** | **Scope drift** | `customer.export` for all customers | `task.scope` | **Needs Approval** | Support Lead role permits the tool, but task grant only covers C-204. Queued for Dev Malhotra (Ops Manager). |
| **S6** | **Exfiltration to unapproved domain** | `payroll.export` to external address | `args.export_destination` | **Needs Approval** | Finance Admin may export payroll, but destination is outside `@sentinel-demo.example`. Queued for Ops Manager. |
| **S7** | **Untrusted source escalation** | `refund.issue` (₹1,500) | `source.untrusted_input` | **Needs Approval** | Under the ₹2,000 threshold, but proposed after reading untrusted ticket text. Queued for Support Lead review. |

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- npm or pnpm

### Installation
```bash
npm install
```

### Running Locally
Start the Vite development server:
```bash
npm run dev
```
Open your browser at `http://localhost:8443` (or the port reported in your terminal).

### Running Tests
Run the comprehensive Vitest test suite (91 automated unit and integration tests):
```bash
npm test
```

### Type Checking
Validate TypeScript types across the entire codebase:
```bash
npx tsc --noEmit
```

### Production Build
Build the optimized static bundle:
```bash
npm run build
```
Preview the built distribution:
```bash
npm run preview
```

---

## Prototype Scope, Guardrails & What It Controls

- **Simulated Agent (Default)**: The agent runs deterministically to reproduce realistic workplace scenarios with authentic timing stages. Works 100% offline.
- **Live LLM Agent (Bring Your Own Key)**: Entering an Anthropic API key activates real tool-calling against `api.anthropic.com`. The key is stored purely in an in-memory private variable and cleared on refresh or reset. The model only proposes actions; SentinelAI evaluates every proposed call before execution.
- **System Boundaries & Governance**: Alerts and detection rules apply to tool calls that pass through the gateway. SentinelAI does not read intent. Untrusted-source escalation is coarse: if a turn read untrusted text, its sensitive calls need approval.
- **Mock Business Tools**: Tools (`invoice.lookup`, `refund.issue`, `customer.export`, `payroll.export`) execute in-memory with deterministic ID increments (`R-7001`, `R-7002`).
- **Synthetic Data**: All customer names (e.g., *Meridian Textiles*), invoice IDs, monetary amounts, and user accounts are entirely synthetic and mock.
- **Policy Settings Disclaimer**: The policy rules and limits demonstrated in this application are designed for prototype evaluation and do not represent any real organization's corporate policies.

---

## Deployment

Because SentinelAI runs 100% client-side with relative asset resolution (`base: './'`), the built `dist` folder can be hosted anywhere:

### Firebase Hosting
```bash
npm run build
firebase deploy --only hosting --project sentinelai-prototype-8a
```
Live URL: `https://sentinelai-prototype-8a.web.app`

### Vercel / Netlify
1. Push this repository to GitHub.
2. Import the project in Vercel or Netlify.
3. Build command: `npm run build`
4. Output directory: `dist`
