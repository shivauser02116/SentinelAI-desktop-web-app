/**
 * Server-side audit log.
 *
 * Persists audit events to PostgreSQL with the same SHA-256 hash-chain
 * algorithm used by the front-end offline demo, ensuring consistent
 * verification semantics across both modes.
 *
 * The hash is computed over: prevHash + canonicalJSON(entryWithoutHash)
 * Genesis prevHash = '0'.repeat(64)
 *
 * Append-only guarantees:
 * - The application database role should have INSERT-only permission on audit_events.
 * - No UPDATE or DELETE is issued by application code; any attempt would be a bug.
 * - Periodic signed checkpoints (audit_checkpoints table) enable independent verification.
 *
 * IMPORTANT: A hash chain alone is not tamper-proof if an adversary controls the
 * database. See the threat model (docs/THREAT_MODEL.md) for details. Production
 * deployments should configure AUDIT_CHECKPOINT_URL to write checkpoints to
 * independently controlled, immutable storage.
 */
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import type { Sql, TransactionSql } from 'postgres'

// ── Canonical JSON (same algorithm as front-end audit.ts) ──────────────────

export function canonicalJSON(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(',') + '}'
}

export const GENESIS_HASH = '0'.repeat(64)

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

// ── Audit entry types ─────────────────────────────────────────────────────

export interface AuditEventInput {
  orgId: string
  actorId?: string | undefined
  actorName: string
  actorRole: string
  taskId?: string | undefined
  actionId?: string | undefined
  approvalId?: string | undefined
  executionId?: string | undefined
  agentMode: 'simulated' | 'live'
  eventType: 'decision' | 'approval_outcome' | 'execution_outcome'
  tool?: string | undefined
  argsRedacted?: Record<string, unknown> | undefined
  provenanceLabel?: string | undefined
  provenanceUntrusted?: boolean | undefined
  decision?: 'allowed' | 'needs_approval' | 'blocked' | undefined
  ruleId?: string | undefined
  policyVersionId?: string | undefined
  reason?: string | undefined
  checks?: Array<{ id: string; status: string; note: string }> | undefined
  reviewerId?: string | undefined
  reviewerName?: string | undefined
  reviewerRole?: string | undefined
  approvalOutcome?: 'approved' | 'denied' | undefined
  denialNote?: string | undefined
  executionStatus?: 'executed' | 'not_executed' | 'pending' | 'execution_unknown' | 'failed' | undefined
  providerReceiptId?: string | undefined
  requestId?: string | undefined
}

export interface AuditEvent extends AuditEventInput {
  id: string
  orgSeq: bigint
  prevHash: string
  hash: string
  createdAt: Date
}

// ── AuditLog class ────────────────────────────────────────────────────────

export class ServerAuditLog {
  private readonly sql: Sql

  constructor(sql: Sql) {
    this.sql = sql
  }

  /**
   * Append a new audit event.
   * Runs inside the caller's transaction if provided; otherwise uses its own.
   *
   * Returns the completed audit event with hash and orgSeq.
   */
  async append(input: AuditEventInput, trx?: Sql | TransactionSql): Promise<AuditEvent> {
    const runner = (trx ?? this.sql) as Sql

    // Lock the last entry for this org to get prevHash and orgSeq atomically
    const prev = await runner<Array<{ hash: string; orgSeq: bigint }>>`
      SELECT hash, org_seq as "orgSeq"
      FROM audit_events
      WHERE org_id = ${input.orgId}
      ORDER BY org_seq DESC
      LIMIT 1
      FOR UPDATE
    `

    const prevHash = prev[0]?.hash ?? GENESIS_HASH
    const orgSeq = (prev[0]?.orgSeq ?? 0n) + 1n
    const id = randomUUID()

    // Compute hash over all fields except the hash itself
    const entryWithoutHash = {
      id,
      orgSeq: orgSeq.toString(),
      orgId: input.orgId,
      actorId: input.actorId ?? null,
      actorName: input.actorName,
      actorRole: input.actorRole,
      taskId: input.taskId ?? null,
      actionId: input.actionId ?? null,
      approvalId: input.approvalId ?? null,
      executionId: input.executionId ?? null,
      agentMode: input.agentMode,
      eventType: input.eventType,
      tool: input.tool ?? null,
      argsRedacted: input.argsRedacted ?? null,
      provenanceLabel: input.provenanceLabel ?? null,
      provenanceUntrusted: input.provenanceUntrusted ?? null,
      decision: input.decision ?? null,
      ruleId: input.ruleId ?? null,
      policyVersionId: input.policyVersionId ?? null,
      reason: input.reason ?? null,
      checks: input.checks ?? null,
      reviewerId: input.reviewerId ?? null,
      reviewerName: input.reviewerName ?? null,
      reviewerRole: input.reviewerRole ?? null,
      approvalOutcome: input.approvalOutcome ?? null,
      denialNote: input.denialNote ?? null,
      executionStatus: input.executionStatus ?? null,
      providerReceiptId: input.providerReceiptId ?? null,
      requestId: input.requestId ?? null,
      prevHash,
    }

    const hash = sha256hex(prevHash + canonicalJSON(entryWithoutHash))

    const rows = await runner<AuditEvent[]>`
      INSERT INTO audit_events (
        id, org_seq, org_id,
        actor_id, actor_name, actor_role,
        task_id, action_id, approval_id, execution_id,
        agent_mode, event_type,
        tool, args_redacted, provenance_label, provenance_untrusted,
        decision, rule_id, policy_version_id, reason, checks,
        reviewer_id, reviewer_name, reviewer_role,
        approval_outcome, denial_note,
        execution_status, provider_receipt_id,
        request_id, prev_hash, hash
      ) VALUES (
        ${id}, ${orgSeq.toString()}::bigint, ${input.orgId},
        ${input.actorId ?? null}, ${input.actorName}, ${input.actorRole},
        ${input.taskId ?? null}, ${input.actionId ?? null}, ${input.approvalId ?? null}, ${input.executionId ?? null},
        ${input.agentMode}, ${input.eventType},
        ${input.tool ?? null},
        ${input.argsRedacted ? JSON.stringify(input.argsRedacted) : null}::jsonb,
        ${input.provenanceLabel ?? null}, ${input.provenanceUntrusted ?? null},
        ${input.decision ?? null}, ${input.ruleId ?? null}, ${input.policyVersionId ?? null},
        ${input.reason ?? null},
        ${input.checks ? JSON.stringify(input.checks) : null}::jsonb,
        ${input.reviewerId ?? null}, ${input.reviewerName ?? null}, ${input.reviewerRole ?? null},
        ${input.approvalOutcome ?? null}, ${input.denialNote ?? null},
        ${input.executionStatus ?? null}, ${input.providerReceiptId ?? null},
        ${input.requestId ?? null}, ${prevHash}, ${hash}
      )
      RETURNING *, org_seq AS "orgSeq", created_at AS "createdAt",
                prev_hash AS "prevHash", args_redacted AS "argsRedacted",
                policy_version_id AS "policyVersionId",
                provider_receipt_id AS "providerReceiptId",
                actor_id AS "actorId", actor_name AS "actorName", actor_role AS "actorRole",
                task_id AS "taskId", action_id AS "actionId", approval_id AS "approvalId",
                execution_id AS "executionId", agent_mode AS "agentMode",
                event_type AS "eventType", rule_id AS "ruleId",
                provenance_label AS "provenanceLabel",
                provenance_untrusted AS "provenanceUntrusted",
                reviewer_id AS "reviewerId", reviewer_name AS "reviewerName",
                reviewer_role AS "reviewerRole", approval_outcome AS "approvalOutcome",
                denial_note AS "denialNote", execution_status AS "executionStatus",
                org_id AS "orgId", request_id AS "requestId"
    `

    const event = rows[0]
    if (!event) throw new Error('Failed to insert audit event')
    return event
  }

  /** Verify the hash chain for an org. Returns the first broken index or null if valid. */
  async verifyChain(orgId: string): Promise<{ ok: boolean; brokenAtSeq: bigint | null }> {
    const sql = this.sql
    const entries = await sql<Array<{ orgSeq: bigint; prevHash: string; hash: string; [k: string]: unknown }>>`
      SELECT *, org_seq AS "orgSeq", prev_hash AS "prevHash",
             actor_id AS "actorId", actor_name AS "actorName", actor_role AS "actorRole",
             task_id AS "taskId", action_id AS "actionId", approval_id AS "approvalId",
             execution_id AS "executionId", agent_mode AS "agentMode",
             event_type AS "eventType", rule_id AS "ruleId",
             args_redacted AS "argsRedacted", policy_version_id AS "policyVersionId",
             provenance_label AS "provenanceLabel", provenance_untrusted AS "provenanceUntrusted",
             reviewer_id AS "reviewerId", reviewer_name AS "reviewerName",
             reviewer_role AS "reviewerRole", approval_outcome AS "approvalOutcome",
             denial_note AS "denialNote", execution_status AS "executionStatus",
             provider_receipt_id AS "providerReceiptId", org_id AS "orgId",
             request_id AS "requestId", created_at AS "createdAt"
      FROM audit_events
      WHERE org_id = ${orgId}
      ORDER BY org_seq ASC
    `

    let prevHash = GENESIS_HASH
    for (const entry of entries) {
      const { hash, ...rest } = entry
      const computed = sha256hex(prevHash + canonicalJSON(rest))
      if (entry.prevHash !== prevHash || hash !== computed) {
        return { ok: false, brokenAtSeq: entry.orgSeq }
      }
      prevHash = hash
    }
    return { ok: true, brokenAtSeq: null }
  }
}
