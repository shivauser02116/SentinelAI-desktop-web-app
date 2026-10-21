/**
 * Approval Request endpoints.
 *
 * GET  /v1/approvals             - Lists approval requests for the organization.
 * GET  /v1/approvals/:approvalId - Gets details of an approval request.
 * POST /v1/approvals/:approvalId/resolve - Approves or denies a request.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate.js'
import { db } from '../../db/index.js'
import { ServerGateway } from '../../gateway/gateway.js'
import { MockAdapter } from '../../adapters/mock.js'

const ResolveApprovalSchema = z.object({
  outcome: z.enum(['approved', 'denied']),
  note: z.string().optional(),
}).strict().refine(
  (data) => data.outcome !== 'denied' || (typeof data.note === 'string' && data.note.trim().length > 0),
  { message: 'A note is required when denying an approval request.', path: ['note'] },
)

export async function registerApprovalRoutes(app: FastifyInstance): Promise<void> {
  const sql = db()
  const gateway = new ServerGateway(sql)
  const mockAdapter = new MockAdapter()

  // ── GET /v1/approvals ─────────────────────────────────────────────────────
  app.get(
    '/v1/approvals',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!
      const query = req.query as { status?: string; limit?: string; offset?: string }
      const status = query.status
      const limit = Math.min(Number(query.limit ?? 50), 100)
      const offset = Number(query.offset ?? 0)

      let rows
      if (status) {
        rows = await sql`
          SELECT a.id, a.org_id AS "orgId", a.action_id AS "actionId",
                 a.requester_id AS "requesterId",
                 u.name AS "requesterName", u.role AS "requesterRole",
                 a.required_reviewer_role AS "requiredReviewerRole",
                 a.reviewer_id AS "reviewerId",
                 a.status, a.denial_note AS "denialNote",
                 a.frozen_call AS "frozenCall",
                 a.expires_at AS "expiresAt",
                 a.created_at AS "createdAt",
                 a.resolved_at AS "resolvedAt"
          FROM approval_requests a
          JOIN users u ON u.id = a.requester_id
          WHERE a.org_id = ${user.orgId} AND a.status = ${status}
          ORDER BY a.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      } else {
        rows = await sql`
          SELECT a.id, a.org_id AS "orgId", a.action_id AS "actionId",
                 a.requester_id AS "requesterId",
                 u.name AS "requesterName", u.role AS "requesterRole",
                 a.required_reviewer_role AS "requiredReviewerRole",
                 a.reviewer_id AS "reviewerId",
                 a.status, a.denial_note AS "denialNote",
                 a.frozen_call AS "frozenCall",
                 a.expires_at AS "expiresAt",
                 a.created_at AS "createdAt",
                 a.resolved_at AS "resolvedAt"
          FROM approval_requests a
          JOIN users u ON u.id = a.requester_id
          WHERE a.org_id = ${user.orgId}
          ORDER BY a.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
      }

      return reply.status(200).send({
        data: rows,
        limit,
        offset,
        requestId: req.id,
      })
    },
  )

  // ── GET /v1/approvals/:approvalId ─────────────────────────────────────────
  app.get(
    '/v1/approvals/:approvalId',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!
      const { approvalId } = req.params as { approvalId: string }

      const rows = await sql`
        SELECT a.id, a.org_id AS "orgId", a.action_id AS "actionId",
               a.requester_id AS "requesterId",
               u.name AS "requesterName", u.role AS "requesterRole",
               a.required_reviewer_role AS "requiredReviewerRole",
               a.reviewer_id AS "reviewerId",
               a.status, a.denial_note AS "denialNote",
               a.frozen_call AS "frozenCall",
               a.expires_at AS "expiresAt",
               a.created_at AS "createdAt",
               a.resolved_at AS "resolvedAt"
        FROM approval_requests a
        JOIN users u ON u.id = a.requester_id
        WHERE a.id = ${approvalId} AND a.org_id = ${user.orgId}
        LIMIT 1
      `

      if (rows.length === 0) {
        return reply.status(404).send({
          error: 'approval_not_found',
          message: `Approval request ${approvalId} not found.`,
          requestId: req.id,
        })
      }

      return reply.status(200).send({
        data: rows[0],
        requestId: req.id,
      })
    },
  )

  // ── POST /v1/approvals/:approvalId/resolve ────────────────────────────────
  app.post(
    '/v1/approvals/:approvalId/resolve',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = ResolveApprovalSchema.safeParse(req.body)
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'validation_error',
          message: 'Invalid request body.',
          details: parseResult.error.format(),
          requestId: req.id,
        })
      }

      const body = parseResult.data
      const user = req.sessionUser!
      const { approvalId } = req.params as { approvalId: string }

      try {
        const result = await gateway.resolveApproval({
          approvalId,
          reviewer: user,
          outcome: body.outcome,
          note: body.note,
          orgId: user.orgId,
          adapter: mockAdapter,
          requestId: req.id,
        })

        return reply.status(200).send({
          data: result,
          requestId: req.id,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Check for specific security constraint errors
        const isClientError =
          msg.includes('Self-approval is forbidden') ||
          msg.includes('not authorized to review') ||
          msg.includes('already resolved') ||
          msg.includes('expired') ||
          msg.includes('denial note is required')

        const statusCode = isClientError ? 400 : 500

        return reply.status(statusCode).send({
          error: 'resolution_failed',
          message: msg,
          requestId: req.id,
        })
      }
    },
  )
}
