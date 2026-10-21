-- SentinelAI PostgreSQL Schema — Migration 0001: Initial
-- Run via: backend/src/db/migrate.ts or psql -f this file
-- All timestamps are UTC (TIMESTAMPTZ).

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ── Organizations ────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  -- JSON object with org-level policy config (thresholds, enabled tools, etc.)
  policy_config   JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Users ─────────────────────────────────────────────────────────────────────
-- Populated on first OIDC login; identity comes from the IdP, not user input.
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- OIDC subject identifier from the IdP (sub claim) — unique per org
  oidc_sub        TEXT NOT NULL,
  oidc_issuer     TEXT NOT NULL,
  email           TEXT NOT NULL,
  name            TEXT NOT NULL,
  -- Application role within the org: 'support_agent' | 'support_lead' | 'ops_manager' | 'finance_admin'
  role            TEXT NOT NULL,
  -- Short display name (2-3 initials)
  initials        TEXT NOT NULL DEFAULT '',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, oidc_sub)
);

-- ── Sessions ──────────────────────────────────────────────────────────────────
-- Stores server-side session data. Cookie holds only the session ID (HttpOnly, Secure).
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,              -- random session token
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  org_id      UUID REFERENCES organizations(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}',
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- ── Policy Versions ───────────────────────────────────────────────────────────
-- Immutable snapshots of policy state. Every decision records the version used.
CREATE TABLE policy_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_num     INTEGER NOT NULL,
  -- Full policy snapshot as JSON (role-tool table, thresholds, reviewer mappings)
  snapshot        JSONB NOT NULL,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, version_num)
);

-- ── Task Grants ───────────────────────────────────────────────────────────────
CREATE TABLE task_grants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id),
  policy_version_id   UUID NOT NULL REFERENCES policy_versions(id),
  task_id             TEXT NOT NULL,              -- human-meaningful task identifier
  task_title          TEXT NOT NULL,
  -- Allowed tools (array of tool identifiers)
  allow_tools         TEXT[] NOT NULL DEFAULT '{}',
  -- Allowed resources (customer IDs, 'ALL', 'payroll', etc.)
  allow_resources     TEXT[] NOT NULL DEFAULT '{}',
  -- Approval threshold in smallest currency unit (e.g., paise)
  require_approval_above_minor INTEGER NOT NULL DEFAULT 200000, -- ₹2,000
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  revocation_reason   TEXT
);
CREATE INDEX task_grants_user_id_idx ON task_grants (user_id);
CREATE INDEX task_grants_org_id_idx ON task_grants (org_id);

-- ── Agent Runs ────────────────────────────────────────────────────────────────
CREATE TABLE agent_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  grant_id        UUID REFERENCES task_grants(id),
  mode            TEXT NOT NULL CHECK (mode IN ('simulated', 'live')),
  -- The user's input / task request
  user_message    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- ── Proposed Actions ──────────────────────────────────────────────────────────
-- Created when an agent proposes a tool call. Status updated by policy gateway.
CREATE TABLE proposed_actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id),
  agent_run_id        UUID REFERENCES agent_runs(id),
  grant_id            UUID REFERENCES task_grants(id),
  policy_version_id   UUID NOT NULL REFERENCES policy_versions(id),

  -- Proposed call (frozen — never mutated after creation)
  tool                TEXT NOT NULL,
  args                JSONB NOT NULL,          -- validated and sanitized
  args_redacted       JSONB NOT NULL DEFAULT '{}', -- redacted copy for logs
  provenance_label    TEXT NOT NULL,
  provenance_untrusted BOOLEAN NOT NULL DEFAULT FALSE,

  -- Policy decision
  decision            TEXT NOT NULL CHECK (decision IN ('allowed', 'needs_approval', 'blocked')),
  rule_id             TEXT NOT NULL,
  reason              TEXT NOT NULL,
  checks              JSONB NOT NULL,          -- [{id, status, note}]

  -- Idempotency key (prevents duplicate submissions)
  idempotency_key     TEXT UNIQUE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX proposed_actions_org_id_idx ON proposed_actions (org_id);
CREATE INDEX proposed_actions_user_id_idx ON proposed_actions (user_id);
CREATE INDEX proposed_actions_decision_idx ON proposed_actions (decision);

-- ── Approval Requests ─────────────────────────────────────────────────────────
CREATE TABLE approval_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_id           UUID NOT NULL REFERENCES proposed_actions(id),
  requester_id        UUID NOT NULL REFERENCES users(id),
  -- Required reviewer role (not a specific person — any user with this role can review)
  required_reviewer_role TEXT NOT NULL,
  -- Assigned reviewer (set at resolution time; NULL until resolved)
  reviewer_id         UUID REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  denial_note         TEXT,
  -- Frozen copy of the exact action the reviewer approves/denies
  frozen_call         JSONB NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ
);
CREATE INDEX approval_requests_org_id_idx ON approval_requests (org_id);
CREATE INDEX approval_requests_status_idx ON approval_requests (status);
CREATE INDEX approval_requests_action_id_idx ON approval_requests (action_id);

-- ── Execution Attempts ────────────────────────────────────────────────────────
-- One row per actual tool execution attempt (may have retries).
CREATE TABLE execution_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_id           UUID NOT NULL REFERENCES proposed_actions(id),
  approval_id         UUID REFERENCES approval_requests(id),
  attempt_number      INTEGER NOT NULL DEFAULT 1,
  -- Execution state machine
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'running', 'executed', 'failed',
                                          'execution_unknown', 'not_executed')),
  -- Provider result (may be null if timed out or blocked)
  provider_receipt_id TEXT,            -- idempotency / receipt from provider
  provider_response   JSONB,           -- sanitized (no secrets)
  error_code          TEXT,
  error_message       TEXT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX execution_attempts_action_id_idx ON execution_attempts (action_id);
CREATE INDEX execution_attempts_status_idx ON execution_attempts (status);

-- ── Provider Integrations ─────────────────────────────────────────────────────
-- Per-org integration config (no secrets in this table; tokens in credentials table).
CREATE TABLE integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,   -- 'mock' | 'stripe' | 'zendesk' | etc.
  tool_scope      TEXT[] NOT NULL, -- which tools this integration handles
  is_sandbox      BOOLEAN NOT NULL DEFAULT TRUE,
  is_connected    BOOLEAN NOT NULL DEFAULT FALSE,
  config          JSONB NOT NULL DEFAULT '{}',   -- non-secret config (webhook URL, etc.)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, provider)
);

-- ── Encrypted Provider Credentials ───────────────────────────────────────────
-- Credentials are AES-256-GCM encrypted at rest. Key held in env/secret manager.
CREATE TABLE credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id  UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  -- Encrypted token blob (base64: iv + ciphertext + authTag)
  encrypted_token TEXT NOT NULL,
  -- Token type and expiry metadata (not secret)
  token_type      TEXT NOT NULL DEFAULT 'bearer',
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Webhook Inbox / Deduplication ────────────────────────────────────────────
-- Webhooks are durably stored before processing to ensure exactly-once semantics.
CREATE TABLE webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
  provider        TEXT NOT NULL,
  -- Provider-assigned event ID (for deduplication)
  provider_event_id TEXT NOT NULL,
  UNIQUE (provider, provider_event_id),
  -- Raw headers and body stored for signature re-verification
  raw_headers     JSONB NOT NULL,
  raw_body        TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  status          TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'processing', 'processed', 'failed')),
  processing_error TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ
);

-- ── Outbox ────────────────────────────────────────────────────────────────────
-- Transactional outbox: rows inserted in same transaction as business events.
-- Worker processes rows and delivers to target (provider, notification, etc.).
CREATE TABLE outbox_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        TEXT NOT NULL,   -- 'execute_action' | 'send_notification' | etc.
  payload         JSONB NOT NULL,
  idempotency_key TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  error_message   TEXT,
  scheduled_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempted_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX outbox_jobs_status_scheduled_idx ON outbox_jobs (status, scheduled_after)
  WHERE status IN ('pending', 'failed');

-- ── Audit Events ─────────────────────────────────────────────────────────────
-- Append-only. Application-level enforcement via INSERT-only permission.
-- Do NOT add UPDATE or DELETE grants to the application role on this table.
CREATE TABLE audit_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 1-based monotonic index per org for chain ordering
  org_seq             BIGINT NOT NULL,
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  -- Attribution
  actor_id            UUID REFERENCES users(id),
  actor_name          TEXT NOT NULL,
  actor_role          TEXT NOT NULL,

  -- Context
  task_id             TEXT,
  action_id           UUID REFERENCES proposed_actions(id),
  approval_id         UUID REFERENCES approval_requests(id),
  execution_id        UUID REFERENCES execution_attempts(id),
  agent_mode          TEXT NOT NULL CHECK (agent_mode IN ('simulated', 'live')),

  -- Event classification
  event_type          TEXT NOT NULL, -- 'decision' | 'approval_outcome' | 'execution_outcome'
  tool                TEXT,
  args_redacted       JSONB,         -- sensitive fields stripped
  provenance_label    TEXT,
  provenance_untrusted BOOLEAN,

  -- Policy decision
  decision            TEXT CHECK (decision IN ('allowed', 'needs_approval', 'blocked', NULL)),
  rule_id             TEXT,
  policy_version_id   UUID REFERENCES policy_versions(id),
  reason              TEXT,
  checks              JSONB,

  -- Approval outcome (if applicable)
  reviewer_id         UUID REFERENCES users(id),
  reviewer_name       TEXT,
  reviewer_role       TEXT,
  approval_outcome    TEXT CHECK (approval_outcome IN ('approved', 'denied', NULL)),
  denial_note         TEXT,

  -- Execution outcome
  execution_status    TEXT CHECK (execution_status IN (
                        'executed', 'not_executed', 'pending',
                        'execution_unknown', 'failed', NULL)),
  provider_receipt_id TEXT,

  -- Hash chain
  prev_hash           TEXT NOT NULL,      -- 64-char SHA-256 hex; '0'*64 for genesis
  hash                TEXT NOT NULL,      -- SHA-256(prev_hash + canonicalJSON(entry))

  -- Correlation
  request_id          TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, org_seq)
);
CREATE INDEX audit_events_org_id_idx ON audit_events (org_id, org_seq);
CREATE INDEX audit_events_action_id_idx ON audit_events (action_id);
CREATE INDEX audit_events_actor_id_idx ON audit_events (actor_id);

-- ── Audit Checkpoints ─────────────────────────────────────────────────────────
-- Periodic signed checkpoints for independent verification.
-- In production, checkpoint hashes should also be written to immutable external storage.
CREATE TABLE audit_checkpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seq_up_to       BIGINT NOT NULL,   -- org_seq of the last event included
  chain_hash      TEXT NOT NULL,     -- cumulative SHA-256 of the chain at this point
  -- Optional: signature from external checkpoint service
  external_ref    TEXT,
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Updated-at triggers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations', 'users', 'integrations', 'credentials']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t);
  END LOOP;
END;
$$;

-- ── Seed: demo org and policy (for local dev only) ───────────────────────────
-- This seed is for local development demonstration only.
-- It must not be used as real production policy.
-- Production deployments must configure organizations, users, and policy explicitly.
INSERT INTO organizations (id, slug, name, policy_config) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'demo-org',
  'Demo Organization (local dev only)',
  '{
    "note": "Prototype defaults — not real business rules. Configure per deployment.",
    "refundApprovalThresholdMinorUnits": 200000,
    "enabledTools": ["invoice.lookup", "refund.issue", "customer.export", "payroll.export"]
  }'
);

INSERT INTO policy_versions (id, org_id, version_num, snapshot) VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  1,
  '{
    "note": "Prototype policy v1 — prototype defaults, not universal business rules.",
    "roleTools": {
      "support_agent": ["invoice.lookup", "refund.issue"],
      "support_lead": ["invoice.lookup", "refund.issue", "customer.export"],
      "finance_admin": ["payroll.export"],
      "ops_manager": []
    },
    "reviewerChain": {
      "support_agent": "support_lead",
      "support_lead": "ops_manager"
    },
    "refundApprovalThresholdMinorUnits": 200000
  }'
);
