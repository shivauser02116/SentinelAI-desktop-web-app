# SentinelAI Architecture & Design

SentinelAI introduces a hardened, verifiable policy checkpoint between autonomous AI agents and sensitive workplace tools. 

The core architectural invariant is that **the agent is an untrusted proposer**. Authority does not originate from the agent or from text ingested by the agent. Authority derives strictly from the signed-in human operator and from a task-scoped, time-bounded cryptographic grant.

---

## System Flow Diagram

```mermaid
flowchart TD
    subgraph UntrustedZone["Untrusted Proposer"]
        Agent["AI Agent / Simulated Script"]
        Ticket["Customer Ticket / External Input"]
        Ticket -. Injected Instructions .-> Agent
    end

    subgraph GatewayBoundary["SentinelAI Policy Gateway Boundary"]
        Call["Proposed Tool Call\n(tool, args, provenance)"]
        Agent -->|"emit proposed_call"| Call

        subgraph PolicyEngine["Policy Evaluation Engine (Pure)"]
            Check1{"1. Role Access Check\n(role.tool_access)"}
            Check2{"2. Task Scope & Expiry\n(task.scope)"}
            Check3{"3. Argument Limits\n(args.refund_limit / args.refund_total)"}
            
            Check1 -->|Pass| Check2
            Check1 -->|Fail| BlockedDecision["Decision: Blocked"]
            
            Check2 -->|Pass| Check3
            Check2 -->|Fail| NeedsApprovalScope["Decision: Needs Approval"]
            
            Check3 -->|Above Total| BlockedTotal["Decision: Blocked (Hard Limit)"]
            Check3 -->|Above ₹2,000| NeedsApprovalLimit["Decision: Needs Approval"]
            Check3 -->|Within Limit| AllowedDecision["Decision: Allowed"]
        end

        Call --> Check1

        subgraph ToolRegistry["Isolated Tool Registry"]
            Tools["Mock Business Tools\n- invoice.lookup\n- refund.issue\n- customer.export\n- payroll.export"]
        end

        AllowedDecision -->|"submit() executes tool"| Tools
        BlockedDecision -->|"Tool NEVER called"| NoExec1["No Execution"]
        BlockedTotal -->|"Tool NEVER called"| NoExec2["No Execution"]

        subgraph Approvals["Human-in-the-Loop Review"]
            Queue["Approval Record\n(Frozen call, required role)"]
            Reviewer["Designated Human Reviewer\n(Support Lead / Ops Manager)"]
            NeedsApprovalScope --> Queue
            NeedsApprovalLimit --> Queue
            Queue -->|"Assigned by role hierarchy"| Reviewer
            Reviewer -->|"resolveApproval: Approve"| Tools
            Reviewer -->|"resolveApproval: Deny (note required)"| Denied["No Execution"]
        end

        subgraph AuditLog["Cryptographic Audit Trail"]
            Genesis["Genesis Hash (64 zeros)"]
            Entry1["Entry #1: Decision / Execution\nSHA-256(prevHash + canonicalJSON(entry))"]
            Entry2["Entry #2: Approval Outcome\nSHA-256(prevHash + canonicalJSON(entry))"]
            Genesis --> Entry1 --> Entry2
        end

        AllowedDecision -->|"append decision entry"| Entry1
        BlockedDecision -->|"append decision entry"| Entry1
        Queue -->|"append decision (pending)"| Entry1
        Reviewer -->|"append approval_outcome"| Entry2
    end

    subgraph ClientUI["User Interface (React + Tailwind)"]
        Controller["SessionController\n(State Orchestrator)"]
        UIContext["useSession Hook / Context"]
        CheckpointUI["Checkpoint Timeline & Nodes"]
        ApprovalsUI["Approvals Badge & Queue"]
        AuditUI["Audit Table & Inspector Drawer"]
        VerifyUI["Chain Status & Tamper Demo"]
        
        GatewayBoundary <--> Controller
        Controller --> UIContext
        UIContext --> CheckpointUI
        UIContext --> ApprovalsUI
        UIContext --> AuditUI
        UIContext --> VerifyUI
    end
```

---

## Module Descriptions

### 1. Gateway Core (`src/gateway/`)

- **`types.ts`**: Formal domain definitions for roles (`Support Agent`, `Support Lead`, `Ops Manager`, `Finance Admin`), tools (`invoice.lookup`, `refund.issue`, `customer.export`, `payroll.export`), policy decisions, provenance, eval contexts, and approval records.
- **`policy.ts`**: Pure function `evaluate(call, context, now)`. Evaluates rules in strict deterministic order:
  1. `role.tool_access`: Checks if the user's role is authorized to invoke the tool.
  2. `task.scope`: Checks if the tool and target resource exist within the active `TaskGrant`, and whether the grant has expired.
  3. `args.refund_limit` / `args.refund_total`: Enforces value constraints (e.g., refunds up to ₹2,000 are pre-approved; refunds above ₹2,000 require approval; refunds exceeding invoice total are blocked).
- **`grants.ts`**: Manages short-lived task grants (default 15 minutes). Enforces resource and tool restrictions per task.
- **`tools.ts`**: Isolated mock business tools (`invoice.lookup`, `refund.issue`, `customer.export`, `payroll.export`). Maintains call counters for empirical testing. **Strictly encapsulated**: an architecture guard test ensures no component, screen, or state module ever imports this file.
- **`gateway.ts`**: The single public entry point for tool execution. Exposes `submit(call, ctx)` and `resolveApproval(input)`. Manages the lifecycle from proposal through verification, execution, and audit trail recording.
- **`mockDb.ts`**: Synthetic records (invoices, customers, users) and deterministic ID generators (`R-7001`, `R-7002`).
- **`audit.ts`**: Append-only cryptographic ledger. Uses Web Crypto API SHA-256 and recursive key-sorted `canonicalJSON`. Implements `verifyChain()` to independently check ledger integrity from the genesis block.

### 2. Agent Layer (`src/agent/`)

- **`AgentAdapter.ts`**: Standardized interface for autonomous or scripted agents proposing actions through the gateway.
- **`simulatedAgent.ts`**: Deterministic agent implementing the 5 prototype scenarios with injectable delay controls.

### 3. Session & State Layer (`src/session/` & `src/state/`)

- **`SessionController.ts`**: Central state coordinator. Orchestrates the 5-stage UI event pipeline, manages live countdown timers for task grants, bridges gateway audit entries to UI models, and synchronizes React components via a reactive subscribe pattern.
- **`useSession.tsx`**: React context provider and hook. Preserves the exact Figma public API while delegating all state transitions and policy operations to `SessionController`.

### 4. Demo Helpers (`src/demo/`)

- **`tamper.ts`**: Isolated simulation helper for hackathon demonstration. Modifies an in-memory audit entry's reason to trigger a cryptographic verification failure in `verifyChain()`.
