/**
 * Action proposal and execution endpoints.
 *
 * POST /v1/actions/propose - Evaluates a proposed tool call against policy.
 * GET /v1/actions          - Lists proposed actions for the organization.
 * GET /v1/actions/:actionId - Retrieves details for a specific action.
 * POST /v1/agent-runs      - Records an agent execution session.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { authenticate } from '../middleware/authenticate.js'
import { db } from '../../db/index.js'
import { ServerGateway } from '../../gateway/gateway.js'
import { getGrant } from '../../gateway/grants.js'
import { MockAdapter } from '../../adapters/mock.js'
import type { ToolName } from '../../adapters/types.js'

const ProposeActionSchema = z.object({
  grantId: z.string().uuid(),
  tool: z.enum(['invoice.lookup', 'refund.issue', 'customer.export', 'payroll.export']),
  args: z.record(z.unknown()),
  provenance: z.object({
    label: z.string().min(1),
    untrusted: z.boolean(),
  }),
  agentMode: z.enum(['simulated', 'live']).default('simulated'),
  agentRunId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).optional(),
}).strict()

const CreateAgentRunSchema = z.object({
  grantId: z.string().uuid().optional(),
  mode: z.enum(['simulated', 'live']).default('simulated'),
  userMessage: z.string().min(1),
}).strict()

export async function registerActionRoutes(app: FastifyInstance): Promise<void> {
  const sql = db()
  const gateway = new ServerGateway(sql)
  const mockAdapter = new MockAdapter()

  // ── POST /v1/actions/propose ──────────────────────────────────────────────
  app.post(
    '/v1/actions/propose',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = ProposeActionSchema.safeParse(req.body)
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

      // Fetch task grant
      const grant = await getGrant(body.grantId, user.orgId, sql)
      if (!grant) {
        return reply.status(404).send({
          error: 'grant_not_found',
          message: `Task grant ${body.grantId} not found or does not belong to your organization.`,
          requestId: req.id,
        })
      }

      try {
        const result = await gateway.submit({
          call: {
            tool: body.tool as ToolName,
            args: body.args,
            provenance: body.provenance,
          },
          user,
          grant,
          agentMode: body.agentMode,
          agentRunId: body.agentRunId,
          idempotencyKey: body.idempotencyKey,
          requestId: req.id,
          adapter: body.agentMode === 'simulated' ? mockAdapter : undefined,
        })

        const statusCode = result.decision === 'allowed' ? 200 : result.decision === 'needs_approval' ? 202 : 403

        return reply.status(statusCode).send({
          data: result,
          requestId: req.id,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return reply.status(500).send({
          error: 'gateway_error',
          message: msg,
          requestId: req.id,
        })
      }
    },
  )

  // ── GET /v1/actions ───────────────────────────────────────────────────────
  app.get(
    '/v1/actions',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!
      const query = req.query as { limit?: string; offset?: string }
      const limit = Math.min(Number(query.limit ?? 50), 100)
      const offset = Number(query.offset ?? 0)

      const rows = await sql`
        SELECT id, org_id AS "orgId", user_id AS "userId",
               agent_run_id AS "agentRunId", grant_id AS "grantId",
               policy_version_id AS "policyVersionId",
               tool, args, provenance_label AS "provenanceLabel",
               provenance_untrusted AS "provenanceUntrusted",
               decision, rule_id AS "ruleId", reason, checks,
               created_at AS "createdAt"
        FROM proposed_actions
        WHERE org_id = ${user.orgId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `

      return reply.status(200).send({
        data: rows,
        limit,
        offset,
        requestId: req.id,
      })
    },
  )

  // ── GET /v1/actions/:actionId ─────────────────────────────────────────────
  app.get(
    '/v1/actions/:actionId',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!
      const { actionId } = req.params as { actionId: string }

      const rows = await sql`
        SELECT id, org_id AS "orgId", user_id AS "userId",
               agent_run_id AS "agentRunId", grant_id AS "grantId",
               policy_version_id AS "policyVersionId",
               tool, args, provenance_label AS "provenanceLabel",
               provenance_untrusted AS "provenanceUntrusted",
               decision, rule_id AS "ruleId", reason, checks,
               created_at AS "createdAt"
        FROM proposed_actions
        WHERE id = ${actionId} AND org_id = ${user.orgId}
        LIMIT 1
      `

      if (rows.length === 0) {
        return reply.status(404).send({
          error: 'action_not_found',
          message: `Action ${actionId} not found.`,
          requestId: req.id,
        })
      }

      return reply.status(200).send({
        data: rows[0],
        requestId: req.id,
      })
    },
  )

  // ── POST /v1/agent-runs ───────────────────────────────────────────────────
  app.post(
    '/v1/agent-runs',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = CreateAgentRunSchema.safeParse(req.body)
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
      const id = randomUUID()

      const rows = await sql`
        INSERT INTO agent_runs (
          id, org_id, user_id, grant_id, mode, user_message, status
        ) VALUES (
          ${id}, ${user.orgId}, ${user.id}, ${body.grantId ?? null},
          ${body.mode}, ${body.userMessage}, 'running'
        )
        RETURNING id, org_id AS "orgId", user_id AS "userId",
                  grant_id AS "grantId", mode, user_message AS "userMessage",
                  status, created_at AS "createdAt"
      `

      return reply.status(201).send({
        data: rows[0],
        requestId: req.id,
      })
    },
  )
}
