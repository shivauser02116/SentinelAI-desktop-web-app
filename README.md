# SentinelAI — Policy Checkpoint for Workplace AI Agents

> **SentinelAI places a policy checkpoint between AI agents and workplace tools.** It evaluates each tool call against role and risk rules, allows safe actions, requests human approval for sensitive actions, blocks unauthorized actions, and records every decision in a tamper-evident audit trail.

The core premise of SentinelAI is that **the agent is an untrusted proposer**. Authority originates from the signed-in human user and from a task-scoped grant, never from the agent or from external text the agent processed.

---

## Key Features

- **Role & Risk Policy Engine**: Pure, deterministic evaluation of role tool permissions, task-scoped resources, and argument thresholds.
- **Task-Scoped Grants**: Time-bounded (15-minute) authorizations that strictly limit the tools and specific customer resources an agent can access for a given assignment.
- **Human-in-the-Loop Approvals**: High-risk or out-of-scope actions trigger role-segregated approval requests with frozen tool arguments. A Support Agent's request routes to a Support Lead; a Support Lead's request routes to an Ops Manager. Self-approval is rejected.
- **Append-Only Cryptographic Audit Log**: Every decision and approval outcome is recorded in a SHA-256 hash-chained ledger using Web Crypto (`crypto.subtle`) and recursive canonical JSON.
- **100% Offline & Private**: Runs entirely in the browser with zero external network requests, backend servers, or external telemetry.
- **Architectural Isolation**: Business tools are encapsulated behind the gateway and can never be directly imported by UI screens or components.

---

## Five Prototype Scenarios

| # | Scenario | Proposed Action | Evaluated Rule | Decision | Outcome |
|---|---|---|---|---|---|
| **S1** | **Look up an invoice** | `invoice.lookup` on INV-1042 | `allow.default` | **Allowed** | Executed. Returns invoice details for customer C-204. |
| **S2** | **Issue high-value refund** | `refund.issue` for ₹25,000 | `args.refund_limit` | **Needs Approval** | Queued for review by Priya Nair (Support Lead). Executed upon approval; creates refund R-7001. |
| **S3** | **Export payroll without authorization** | `payroll.export` (CSV) | `role.tool_access` | **Blocked** | Support Agent role lacks permissions for payroll. Tool was never called. |
| **S4** | **Prompt injection in a ticket** | `payroll.export` via injected note | `role.tool_access` | **Blocked** | Untrusted provenance identified. Permissions derive from user, not ticket text. Tool was never called. |
| **S5** | **Scope drift** | `customer.export` for all customers | `task.scope` | **Needs Approval** | Support Lead role permits the tool, but task grant only covers C-204. Queued for Dev Malhotra (Ops Manager). |

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
Run the comprehensive Vitest test suite (49 automated unit and integration tests):
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

## Prototype Scope & Simulation

- **Simulated Agent**: The agent runs deterministically to reproduce realistic workplace scenarios with authentic timing stages.
- **Mock Business Tools**: Tools (`invoice.lookup`, `refund.issue`, `customer.export`, `payroll.export`) execute in-memory with deterministic ID increments (`R-7001`, `R-7002`).
- **Synthetic Data**: All customer names (e.g., *Meridian Textiles*), invoice IDs, monetary amounts, and user accounts are entirely synthetic and mock.
- **System Boundaries**: SentinelAI governs actions that pass through its policy checkpoint gateway. Operations conducted outside the mediated tool registry are outside the gateway's scope.
- **Policy Settings Disclaimer**: The policy rules and limits demonstrated in this application are designed for prototype evaluation and do not represent any real organization's corporate policies.

---

## Deployment

Because SentinelAI runs 100% client-side with relative asset resolution (`base: './'`), the built `dist` folder can be hosted anywhere:

### Vercel / Netlify
1. Push this repository to GitHub.
2. Import the project in Vercel or Netlify.
3. Build command: `npm run build`
4. Output directory: `dist`

### GitHub Pages
1. Build the production bundle: `npm run build`
2. Deploy the contents of the `dist/` directory to your `gh-pages` branch.
