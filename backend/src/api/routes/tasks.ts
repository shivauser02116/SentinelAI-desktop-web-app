/**
 * Task and Grant endpoints.
 *
 * POST /v1/tasks - Issues a scoped task grant.
 * GET /v1/tasks/:taskId - Retrieves task grant details.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate.js'
import { db } from '../../db/index.js'
import { issueGrant } from '../../gateway/grants.js'
import { loadOrgPolicy } from '../../gateway/policy.js'

const CreateTaskSchema = z.object({
  taskId: z.string().min(1),
  taskTitle: z.string().min(1),
  allowTools: z.array(z.string()),
  allowResources: z.array(z.string()),
  requireApprovalAboveMinor: z.number().int().positive().optional(),
  ttlMinutes: z.number().int().positive().max(1440).optional(),
}).strict()

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  const sql = db()

  app.post(
    '/v1/tasks',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateTaskSchema.safeParse(req.body)
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

      const policy = await loadOrgPolicy(user.orgId)
      if (!policy) {
        return reply.status(400).send({
          error: 'policy_missing',
          message: 'Cannot issue task grant: no active policy configured for organization.',
          requestId: req.id,
        })
      }

      try {
        const grant = await issueGrant(
          {
            orgId: user.orgId,
            userId: user.id,
            policyVersionId: policy.versionId,
            taskId: body.taskId,
            taskTitle: body.taskTitle,
            allowTools: body.allowTools,
            allowResources: body.allowResources,
            requireApprovalAboveMinor: body.requireApprovalAboveMinor,
            ttlMinutes: body.ttlMinutes,
          },
          sql,
        )

        return reply.status(201).send({
          data: grant,
          requestId: req.id,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({
          error: 'server_error',
          message: msg,
          requestId: req.id,
        })
      }
    },
  )

  app.get(
    '/v1/tasks/:taskId',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!
      const { taskId } = req.params as { taskId: string }

      const rows = await sql`
        SELECT id, org_id AS "orgId", user_id AS "userId",
               policy_version_id AS "policyVersionId",
               task_id AS "taskId", task_title AS "taskTitle",
               allow_tools AS "allowTools", allow_resources AS "allowResources",
               require_approval_above_minor AS "requireApprovalAboveMinor",
               issued_at AS "issuedAt", expires_at AS "expiresAt",
               revoked_at AS "revokedAt", revocation_reason AS "revocationReason"
        FROM task_grants
        WHERE org_id = ${user.orgId} AND task_id = ${taskId}
        ORDER BY issued_at DESC
        LIMIT 1
      `

      if (rows.length === 0) {
        return reply.status(404).send({
          error: 'task_not_found',
          message: `Task grant for task ${taskId} not found.`,
          requestId: req.id,
        })
      }

      return reply.status(200).send({
        data: rows[0],
        requestId: req.id,
      })
    },
  )
}
