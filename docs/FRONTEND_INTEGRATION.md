# SentinelAI Frontend Integration Plan

> **BOUNDARY NOTICE**: As specified in the project instructions, **no front-end files were modified** during this task. The existing React front end remains completely untouched, fully offline, and passes all 49 existing test cases.
>
> This document lists the minimum proposed changes and architecture required to connect the front end to the server-side backend in a subsequent task.

---

## 1. Dual-Mode Architecture

The front end can support two modes without breaking the offline demo:

1. **Offline Demo Mode (Default)**:
   - Enabled when `VITE_API_URL` is unset or empty.
   - Uses the existing `SessionController` with in-memory simulated scenarios, deterministic delays, and local audit verification.
   - Zero network requests; works completely offline.

2. **Connected Backend Mode**:
   - Enabled when `VITE_API_URL="http://localhost:3001"` is defined in `.env`.
   - Authenticates via OIDC (`/auth/login`).
   - Delegates policy evaluation, approval creation, approval resolution, and audit verification to the server-side Fastify API.

---

## 2. Proposed New Files (Zero Impact on Existing Code)

### File A: `src/api/client.ts` (New File)
A typed HTTP client wrapping `fetch` with credentials (`include`) and standard error handling:

```typescript
export interface ApiClientConfig {
  baseUrl: string
}

export class SentinelApiClient {
  private readonly baseUrl: string

  constructor(config?: Partial<ApiClientConfig>) {
    this.baseUrl = config?.baseUrl ?? (import.meta.env.VITE_API_URL || 'http://localhost:3001')
  }

  async getMe() {
    return this.request('/v1/me')
  }

  async getCurrentPolicy() {
    return this.request('/v1/policies/current')
  }

  async issueTaskGrant(params: {
    taskId: string
    taskTitle: string
    allowTools: string[]
    allowResources: string[]
    requireApprovalAboveMinor?: number
    ttlMinutes?: number
  }) {
    return this.request('/v1/tasks', { method: 'POST', body: JSON.stringify(params) })
  }

  async proposeAction(params: {
    grantId: string
    tool: string
    args: Record<string, unknown>
    provenance: { label: string; untrusted: boolean }
    agentMode?: 'simulated' | 'live'
  }) {
    return this.request('/v1/actions/propose', { method: 'POST', body: JSON.stringify(params) })
  }

  async listApprovals(status?: string) {
    const query = status ? `?status=${encodeURIComponent(status)}` : ''
    return this.request(`/v1/approvals${query}`)
  }

  async resolveApproval(approvalId: string, outcome: 'approved' | 'denied', note?: string) {
    return this.request(`/v1/approvals/${approvalId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note }),
    })
  }

  async listAuditEvents(limit = 50, order: 'asc' | 'desc' = 'desc') {
    return this.request(`/v1/audit?limit=${limit}&order=${order}`)
  }

  async verifyAuditChain() {
    return this.request('/v1/audit/verify', { method: 'POST' })
  }

  private async request(path: string, init?: RequestInit) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
    const body = await res.json()
    if (!res.ok) {
      throw new Error(body.message || `Request failed with status ${res.status}`)
    }
    return body
  }
}
```

### File B: `src/session/ServerSessionController.ts` (New File)
Implements the exact same interface as `SessionController`, but synchronizes state with the server API:
- `runScenario(id)`: Issues task grant via `POST /v1/tasks`, starts agent run, submits proposed action to `POST /v1/actions/propose`, and updates local snapshot.
- `resolveApproval(id, action, note)`: Calls `POST /v1/approvals/:id/resolve`, then refreshes audit trail.
- `verifyChain()`: Calls `POST /v1/audit/verify` to verify the cryptographic chain on the server.

---

## 3. Minimal Proposed Edits to Existing Files

Only **one existing file** would need a modification: `src/state/useSession.tsx`.

### Proposed Change in `src/state/useSession.tsx`

```diff
+ import { ServerSessionController } from '../session/ServerSessionController'
  import { SessionController } from '../session/SessionController'

  export function SessionProvider({ children }: { children: ReactNode }) {
    const ctrlRef = useRef<SessionController | null>(null)
    if (!ctrlRef.current) {
+     const isBackendMode = Boolean(import.meta.env.VITE_API_URL)
+     ctrlRef.current = isBackendMode
+       ? new ServerSessionController()
+       : new SessionController()
-     ctrlRef.current = new SessionController()
    }
```

### Impact Assessment
- **Visual Design**: Zero impact. All UI components, screens, layouts, styles, and copy remain identical.
- **Offline Compatibility**: If `VITE_API_URL` is omitted, the app behaves identically to the current prototype.
- **State Management**: The public `SessionState` and `useSession()` contracts remain 100% unchanged.

---

## 4. Rollout Checklist

1. [ ] Request and receive explicit approval to implement front-end wiring.
2. [ ] Create `src/api/client.ts`.
3. [ ] Create `src/session/ServerSessionController.ts`.
4. [ ] Apply the conditional switch in `src/state/useSession.tsx`.
5. [ ] Verify that running `npm test` still passes all 49 offline tests.
6. [ ] Start the backend (`cd backend && npm run dev`) and test live mode with the UI.
