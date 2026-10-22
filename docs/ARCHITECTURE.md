# SentinelAI Architecture & Design

SentinelAI introduces a hardened, verifiable policy checkpoint between autonomous AI agents and sensitive workplace tools. 

The core architectural invariant is that **the agent is an untrusted proposer**. Authority does not originate from the agent or from text ingested by the agent. Authority derives strictly from the signed-in human operator and from a task-scoped, time-bounded cryptographic grant.

---

## System Flow Diagram

```mermaid
flowchart TD
    subgraph UntrustedZone["Untrusted Proposer"]
        Agent["AI Agent / Simulated Script / Live Claude"]
        Ticket["Customer Ticket / External Input"]
        Ticket -. Injected Instructions .-> Agent
    end

    subgraph GatewayBoundary["SentinelAI Policy Gateway Boundary"]
        Call["Proposed Tool Call\n(tool, args, provenance)"]
        Agent -->|"emit proposed_call"| Call

        subgraph PolicyEngine["Policy Evaluation Engine (Pure)"]
            Check1{"1. Role Access Check\n(role.tool_access)"}
            Check2{"2. Task Scope & Expiry\n(task.scope)"}
            Check3{"3. Argument Limits & Destination\n(args.refund_limit / args.export_destination)"}
            Check4{"4. Input Source Check\n(source.untrusted_input)"}
            
            Check1 -->|Pass| Check2
            Check1 -->|Fail| BlockedDecision["Decision: Blocked"]
            
            Check2 -->|Pass| Check3
            Check2 -->|Fail| NeedsApprovalScope["Decision: Needs Approval"]
            
            Check3 -->|Hard Ceiling| BlockedHard["Decision: Blocked (Hard Limit)"]
            Check3 -->|Outside @sentinel-demo.example| NeedsApprovalDest["Decision: Needs Approval"]
            Check3 -->|Pass| Check4
            
            Check4 -->|Untrusted Text| NeedsApprovalUntrusted["Decision: Needs Approval"]
            Check4 -->|Trusted| AllowedDecision["Decision: Allowed"]
        end

        Call --> Check1

        subgraph ToolRegistry["Isolated Tool Registry"]
            Tools["Mock Business Tools\n- invoice.lookup\n- refund.issue\n- customer.export\n- payroll.export"]
        end

        AllowedDecision -->|"submit() executes tool"| Tools
        BlockedDecision -->|"Tool NEVER called"| NoExec1["No Execution"]
        BlockedHard -->|"Tool NEVER called"| NoExec2["No Execution"]

        subgraph Approvals["Human-in-the-Loop Review"]
            Queue["Approval Record\n(Frozen call, required role)"]
            Reviewer["Designated Human Reviewer\n(Support Lead / Ops Manager)"]
            NeedsApprovalScope --> Queue
            NeedsApprovalDest --> Queue
            NeedsApprovalUntrusted --> Queue
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

        subgraph AlertsModule["Alerts & Interventions Engine"]
            AlertsDerivation["deriveAlerts(entries, approvals, chain)\nsummarizeInterventions(entries)"]
            AuditLog --> AlertsDerivation
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
        AlertsUI["Alerts Screen & Nav Badge"]
        AuditUI["Audit Table & Inspector Drawer"]
        VerifyUI["Chain Status & Tamper Demo"]
        
        GatewayBoundary <--> Controller
        AlertsModule --> Controller
        Controller --> UIContext
        UIContext --> CheckpointUI
        UIContext --> ApprovalsUI
        UIContext --> AlertsUI
        UIContext --> AuditUI
        UIContext --> VerifyUI
    end
```

---

## Live LLM Agent Loop (Bring Your Own Key)

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Operator
    participant UI as AgentActivity & SessionController
    participant Agent as LiveAgent (Anthropic BYOK)
    participant Model as Anthropic Claude API (Direct Browser Fetch)
    participant Gateway as SentinelAI Policy Gateway
    participant Tools as Mock Tools / Database

    User->>UI: Enter task / Select scenario
    UI->>Agent: runTurn({ user, taskTitle, userMessage, untrustedBlocks })
    Note over Agent: Coarse Taint Tracking: marks untrusted if untrustedBlocks present
    Agent->>Model: POST /v1/messages (tool definitions, system prompt, user prompt)
    Model-->>Agent: Returns assistant message with tool_use block
    Agent->>UI: emit('proposed_call', call, provenance)
    UI->>Gateway: _processCall(callCtx, eventId, grant, user, 'live')
    Gateway->>Gateway: 4-Stage Policy Check (Role, Scope, Limits, Source)
    
    alt Decision: Allowed
        Gateway->>Tools: Execute tool with frozen args
        Tools-->>Gateway: Execution result
        Gateway-->>UI: SubmitResult (allowed, result)
        UI-->>Agent: onToolCall returns { status: 'executed', summary }
    else Decision: Needs Approval
        Gateway->>Gateway: Register approval record (queue)
        Gateway-->>UI: SubmitResult (needs_approval, approvalId)
        UI-->>Agent: onToolCall returns { status: 'pending', summary }
    else Decision: Blocked
        Gateway-->>UI: SubmitResult (blocked, reason)
        UI-->>Agent: onToolCall returns { status: 'blocked', summary: reason }
    end

    Agent->>Model: Append tool_result block to conversation
    Model-->>Agent: Final response text / Next tool_use (max 4 turns)
    Agent->>UI: emit('agent_message', text)
    UI-->>User: Display action event, checks, outcome, and agent lines
```

---

## Module Descriptions

### 1. Gateway Core (`src/gateway/`)

- **`types.ts`**: Formal domain definitions for roles (`Support Agent`, `Support Lead`, `Ops Manager`, `Finance Admin`), tools (`invoice.lookup`, `refund.issue`, `customer.export`, `payroll.export`), policy decisions, provenance, eval contexts, and approval records.
- **`policy.ts`**: Pure function `evaluate(call, context, now)`. Evaluates rules in strict deterministic order:
  1. `role_access`: Checks if the user's role is authorized to invoke the tool (`role.tool_access`).
  2. `task_scope`: Checks if the tool and target resource exist within the active `TaskGrant`, and whether the grant has expired (`task.scope`).
  3. `arg_limits`: Enforces value constraints and export destinations:
     - `args.refund_total`: Hard block if refund exceeds invoice total.
     - `args.refund_limit`: Needs approval if refund exceeds role ceiling (₹2,000 for Support Agent).
     - `args.export_destination`: For `payroll.export` or `customer.export`, destinations outside `@sentinel-demo.example` require approval.
  4. `input_source`: Checks input provenance:
     - `source.untrusted_input`: Sensitive tools (`refund.issue`, `payroll.export`, `customer.export`) proposed after reading untrusted text require human approval.
- **`alerts.ts`**: Pure derivation functions:
  - `deriveAlerts({ entries, approvals, chain })`: Produces categorized alerts for blocked calls, pending reviews, untrusted sources, unapproved destinations, and audit chain breaks.
  - `summarizeInterventions(entries)`: Computes counts for blocked, held, approved, and denied actions.
- **`grants.ts`**: Manages short-lived task grants (default 15 minutes). Enforces resource and tool restrictions per task.
- **`tools.ts`**: Mock business tool implementations. Never imported by UI layers.
- **`audit.ts`**: Cryptographic hash chaining (`SHA-256(prevHash + canonicalJSON(entry))`), tamper detection, and verification routines.
