# SentinelAI Server-Side Policy Gateway & API

This is the server-side backend for SentinelAI. It places an authoritative policy checkpoint between AI agents and workplace tools. It evaluates each tool call against role and risk rules, allows safe actions, requests human approval for sensitive actions, blocks unauthorized actions, and records every decision in an immutable, hash-chained audit trail.

> **Core Security Boundary**: The browser and AI agent are untrusted clients. The server is the authority for identity, organization membership, role, policy, task grants, approval decisions, and tool execution. All business-tool credentials remain server-side.

---

## Architecture Overview

- **Framework**: Fastify 5 (TypeScript, ESM)
- **Database**: PostgreSQL 16 (Durable transactional store)
- **Authentication**: OpenID Connect (OIDC) with PKCE and session rotation
- **Policy Engine**: Server-side enforcement with role mapping and argument limits
- **Audit Log**: Append-only SHA-256 hash chain with cryptographic verification
- **Integrations**: Modular adapter interface with built-in `MockAdapter` and `DisabledAdapter` scaffolds
- **Worker**: Transactional outbox processor with exponential backoff retries

---

## Getting Started

### Prerequisites

- Node.js >= 20.x
- npm >= 10.x
- PostgreSQL 16 (either local or via Docker Compose)

### 1. Database Setup

Using Docker Compose from the project root:
```bash
docker compose up -d postgres
```

Or connect to an existing local PostgreSQL instance:
```bash
createdb sentinelai_dev
```

### 2. Configure Environment Variables

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` to configure your database connection and OIDC parameters:
```env
PORT=3001
HOST=0.0.0.0
NODE_ENV=development

DATABASE_URL=postgres://sentinel:sentinel_secret@localhost:5432/sentinelai_dev

SESSION_SECRET=at-least-32-random-characters-for-session-signing
CSRF_SECRET=at-least-32-random-characters-for-csrf-signing

OIDC_ISSUER_URL=https://accounts.google.com
OIDC_CLIENT_ID=your-oidc-client-id
OIDC_CLIENT_SECRET=your-oidc-client-secret
OIDC_REDIRECT_URI=http://localhost:3001/auth/callback
OIDC_SCOPES="openid profile email"

FRONTEND_ORIGIN=http://localhost:5173

CREDENTIAL_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

### 3. Run Database Migrations

Apply the PostgreSQL schema and seed the local development demo organization:
```bash
npm run db:migrate
```

This sets up:
- Demo organization (`00000000-0000-0000-0000-000000000001`)
- Policy version 1 (`00000000-0000-0000-0000-000000000002`)
- Tables: `organizations`, `users`, `sessions`, `policy_versions`, `task_grants`, `proposed_actions`, `approval_requests`, `execution_attempts`, `audit_events`, `integrations`, `credentials`, `outbox_jobs`, `webhook_events`.

### 4. Run the Development Server

```bash
npm run dev
```

The server starts at `http://localhost:3001`.
- OpenAPI documentation: `http://localhost:3001/docs`
- Liveness check: `http://localhost:3001/health/live`
- Readiness check: `http://localhost:3001/health/ready`

### 5. Run the Test Suite

```bash
npm test
```

### 6. Build for Production

```bash
npm run build
npm start
```

---

## API Summary

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/health/live` | Liveness health check | No |
| `GET` | `/health/ready` | Readiness check (validates DB connectivity) | No |
| `GET` | `/auth/login` | Initiates OIDC authorization flow | No |
| `GET` | `/auth/callback` | OIDC callback handler (code exchange, session rotation) | No |
| `POST` | `/auth/logout` | Terminates user session | Yes |
| `GET` | `/v1/me` | Current user profile, role, and organization | Yes |
| `GET` | `/v1/policies/current` | Active policy configuration for the organization | Yes |
| `POST` | `/v1/tasks` | Issue a scoped task grant | Yes |
| `GET` | `/v1/tasks/:taskId` | Retrieve active task grant | Yes |
| `POST` | `/v1/actions/propose` | Evaluate proposed tool call against policy | Yes |
| `GET` | `/v1/actions` | List proposed actions for the organization | Yes |
| `GET` | `/v1/actions/:actionId` | Get details of a specific action | Yes |
| `POST` | `/v1/agent-runs` | Record an agent run | Yes |
| `GET` | `/v1/approvals` | List pending/resolved approval requests | Yes |
| `GET` | `/v1/approvals/:approvalId` | Get details of an approval request | Yes |
| `POST` | `/v1/approvals/:approvalId/resolve` | Approve or deny an action request | Yes |
| `GET` | `/v1/audit` | List cryptographically chained audit events | Yes |
| `GET` | `/v1/audit/:entryId` | Get details of an audit event | Yes |
| `POST` | `/v1/audit/verify` | Verify SHA-256 hash chain integrity | Yes |
| `GET` | `/v1/integrations` | List configured provider integrations | Yes |
| `POST` | `/v1/integrations/:provider/connect` | Connect or configure a provider | Yes |
| `POST` | `/v1/integrations/:provider/disconnect` | Disconnect a provider | Yes |
| `POST` | `/v1/webhooks/:provider` | Inbound provider webhook ingress | No (Signature Verified) |

---

## Directory Structure

```
backend/
├── src/
│   ├── index.ts               # Server startup and shutdown handling
│   ├── server.ts              # Fastify instance builder with middleware
│   ├── config.ts              # Type-safe configuration loader (Zod)
│   ├── openapi-export.ts      # OpenAPI JSON generator script
│   ├── types.ts               # Type augmentations for Fastify and sessions
│   ├── db/
│   │   ├── index.ts           # Postgres connection pool
│   │   ├── migrate.ts         # Lightweight migration runner
│   │   └── migrations/        # SQL schema migration files
│   ├── auth/
│   │   ├── oidc.ts            # OIDC authentication routes & client
│   │   └── session.ts         # User session lifecycle & rotation
│   ├── gateway/
│   │   ├── gateway.ts         # ServerGateway: submit, resolveApproval
│   │   ├── policy.ts          # Policy loading & role mapping
│   │   └── grants.ts          # Task grant issuance and scope checking
│   ├── audit/
│   │   └── log.ts             # Append-only SHA-256 hash chained log
│   ├── adapters/
│   │   ├── types.ts           # ProviderAdapter interface
│   │   └── mock.ts            # MockAdapter and DisabledAdapter
│   ├── api/
│   │   ├── middleware/        # Authentication & authorization preHandlers
│   │   └── routes/            # Route modules (health, me, tasks, actions, approvals, audit, integrations)
│   └── workers/
│       └── outbox.ts          # Transactional outbox processor
├── tests/                     # Vitest test suite
├── openapi.json               # Exported OpenAPI 3.1 specification
├── package.json
└── tsconfig.json
```
