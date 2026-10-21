/**
 * Audit log endpoints.
 *
 * GET  /v1/audit        - Lists hash-chained audit events for the organization.
 * GET  /v1/audit/:id    - Retrieves a single audit event.
 * POST /v1/audit/verify - Verifies the SHA-256 hash chain integrity for the organization.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate } from '../middleware/authenticate.js'
import { db } from '../../db/index.js'
import { ServerAuditLog } from '../../audit/log.js'

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  const sql = db()
  const auditLog = new ServerAuditLog(sql)

  // ── GET /v1/audit ─────────────────────────────────────────────────────────
  app.get(
    '/v1/audit',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!
      const query = req.query as { limit?: string; offset?: string; order?: 'asc' | 'desc' }
      const limit = Math.min(Number(query.limit ?? 50), 100)
      const offset = Number(query.offset ?? 0)
      const order = query.order === 'asc' ? 'asc' : 'desc'

      let rows
      if (order === 'asc') {
        rows = await sql`
          SELECT id, org_seq AS "orgSeq", org_id AS "orgId",
                 actor_id AS "actorId", actor_name AS "actorName",
                 actor_role AS "actorRole", task_id AS "taskId",
                 action_id AS "actionId", approval_id AS "approvalId",
                 execution_id AS "executionId", agent_mode AS "agentMode",
                 event_type AS "eventType", tool, args_redacted AS "argsRedacted",
                 provenance_label AS "provenanceLabel",
                 provenance_untrusted AS "provenanceUntrusted",
                 decision, rule_id AS "ruleId",
                 policy_version_id AS "policyVersionId",
                 reason, checks,
                 reviewer_id AS "reviewerId", reviewer_name AS "reviewerName",
                 reviewer_role AS "reviewerRole",
                 approval_outcome AS "approvalOutcome", denial_note AS "denialNote",
                 execution_status AS "executionStatus",
                 provider_receipt_id AS "providerReceiptId",
                 prev_hash AS "prevHash", hash,
                 request_id AS "requestId", created_at AS "createdAt"
          FROM audit_events
          WHERE org_id = ${user.orgId}
          ORDER BY org_seq ASC
          LIMIT ${limit} OFFSET ${offset}
        `
      } else {
        rows = await sql`
          SELECT id, org_seq AS "orgSeq", org_id AS "orgId",
                 actor_id AS "actorId", actor_name AS "actorName",
                 actor_role AS "actorRole", task_id AS "taskId",
                 action_id AS "actionId", approval_id AS "approvalId",
                 execution_id AS "executionId", agent_mode AS "agentMode",
                 event_type AS "eventType", tool, args_redacted AS "argsRedacted",
                 provenance_label AS "provenanceLabel",
                 provenance_untrusted AS "provenanceUntrusted",
                 decision, rule_id AS "ruleId",
                 policy_version_id AS "policyVersionId",
                 reason, checks,
                 reviewer_id AS "reviewerId", reviewer_name AS "reviewerName",
                 reviewer_role AS "reviewerRole",
                 approval_outcome AS "approvalOutcome", denial_note AS "denialNote",
                 execution_status AS "executionStatus",
                 provider_receipt_id AS "providerReceiptId",
                 prev_hash AS "prevHash", hash,
                 request_id AS "requestId", created_at AS "createdAt"
          FROM audit_events
          WHERE org_id = ${user.orgId}
          ORDER BY org_seq DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      }

      // Count total events for this org
      const countRows = await sql<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM audit_events
        WHERE org_id = ${user.orgId}
      `
      const total = Number(countRows[0]?.count ?? 0)

      return reply.status(200).send({
        data: rows,
        total,
        limit,
        offset,
        requestId: req.id,
      })
    },
  )

  // ── GET /v1/audit/:entryId ────────────────────────────────────────────────
  app.get(
    '/v1/audit/:entryId',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!
      const { entryId } = req.params as { entryId: string }

      const rows = await sql`
        SELECT id, org_seq AS "orgSeq", org_id AS "orgId",
               actor_id AS "actorId", actor_name AS "actorName",
               actor_role AS "actorRole", task_id AS "taskId",
               action_id AS "actionId", approval_id AS "approvalId",
               execution_id AS "executionId", agent_mode AS "agentMode",
               event_type AS "eventType", tool, args_redacted AS "argsRedacted",
               provenance_label AS "provenanceLabel",
               provenance_untrusted AS "provenanceUntrusted",
               decision, rule_id AS "ruleId",
               policy_version_id AS "policyVersionId",
               reason, checks,
               reviewer_id AS "reviewerId", reviewer_name AS "reviewerName",
               reviewer_role AS "reviewerRole",
               approval_outcome AS "approvalOutcome", denial_note AS "denialNote",
               execution_status AS "executionStatus",
               provider_receipt_id AS "providerReceiptId",
               prev_hash AS "prevHash", hash,
               request_id AS "requestId", created_at AS "createdAt"
        FROM audit_events
        WHERE id = ${entryId} AND org_id = ${user.orgId}
        LIMIT 1
      `

      if (rows.length === 0) {
        return reply.status(404).send({
          error: 'entry_not_found',
          message: `Audit entry ${entryId} not found.`,
          requestId: req.id,
        })
      }

      return reply.status(200).send({
        data: rows[0],
        requestId: req.id,
      })
    },
  )

  // ── POST /v1/audit/verify ─────────────────────────────────────────────────
  app.post(
    '/v1/audit/verify',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!

      try {
        const verifyResult = await auditLog.verifyChain(user.orgId)
        return reply.status(200).send({
          data: {
            ok: verifyResult.ok,
            brokenAtSeq: verifyResult.brokenAtSeq !== null ? Number(verifyResult.brokenAtSeq) : null,
            checkedAt: new Date().toISOString(),
          },
          requestId: req.id,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({
          error: 'verify_failed',
          message: msg,
          requestId: req.id,
        })
      }
    },
  )
}
