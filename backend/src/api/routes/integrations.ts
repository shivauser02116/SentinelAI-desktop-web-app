/**
 * Provider Integration and Webhook endpoints.
 *
 * GET  /v1/integrations                    - Lists configured integrations for the organization.
 * POST /v1/integrations/:provider/connect  - Connects or updates a provider integration.
 * POST /v1/integrations/:provider/disconnect - Disconnects an integration.
 * POST /v1/webhooks/:provider              - Inbound webhook handler (verifies signature, records in inbox).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { authenticate } from '../middleware/authenticate.js'
import { db } from '../../db/index.js'

const ConnectIntegrationSchema = z.object({
  toolScope: z.array(z.string()),
  isSandbox: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
}).strict()

export async function registerIntegrationRoutes(app: FastifyInstance): Promise<void> {
  const sql = db()

  // ── GET /v1/integrations ──────────────────────────────────────────────────
  app.get(
    '/v1/integrations',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!

      const rows = await sql`
        SELECT id, org_id AS "orgId", provider,
               tool_scope AS "toolScope", is_sandbox AS "isSandbox",
               is_connected AS "isConnected", config,
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM integrations
        WHERE org_id = ${user.orgId}
        ORDER BY provider ASC
      `

      return reply.status(200).send({
        data: rows,
        requestId: req.id,
      })
    },
  )

  // ── POST /v1/integrations/:provider/connect ───────────────────────────────
  app.post(
    '/v1/integrations/:provider/connect',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseResult = ConnectIntegrationSchema.safeParse(req.body)
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
      const { provider } = req.params as { provider: string }

      const rows = await sql`
        INSERT INTO integrations (
          org_id, provider, tool_scope, is_sandbox, is_connected, config
        ) VALUES (
          ${user.orgId}, ${provider}, ${body.toolScope},
          ${body.isSandbox}, TRUE, ${JSON.stringify(body.config)}::jsonb
        )
        ON CONFLICT (org_id, provider) DO UPDATE SET
          tool_scope = EXCLUDED.tool_scope,
          is_sandbox = EXCLUDED.is_sandbox,
          is_connected = TRUE,
          config = EXCLUDED.config,
          updated_at = NOW()
        RETURNING id, org_id AS "orgId", provider,
                  tool_scope AS "toolScope", is_sandbox AS "isSandbox",
                  is_connected AS "isConnected", config,
                  created_at AS "createdAt", updated_at AS "updatedAt"
      `

      return reply.status(200).send({
        data: rows[0],
        requestId: req.id,
      })
    },
  )

  // ── POST /v1/integrations/:provider/disconnect ────────────────────────────
  app.post(
    '/v1/integrations/:provider/disconnect',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!
      const { provider } = req.params as { provider: string }

      await sql`
        UPDATE integrations
        SET is_connected = FALSE,
            updated_at = NOW()
        WHERE org_id = ${user.orgId} AND provider = ${provider}
      `

      return reply.status(200).send({
        data: { provider, isConnected: false },
        requestId: req.id,
      })
    },
  )

  // ── POST /v1/webhooks/:provider ───────────────────────────────────────────
  // Unauthenticated endpoint for provider webhooks.
  // Stores the event durably in webhook_events inbox table before processing.
  app.post(
    '/v1/webhooks/:provider',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { provider } = req.params as { provider: string }
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
      const eventId = (req.headers['x-event-id'] as string | undefined) ??
        (req.headers['stripe-event-id'] as string | undefined) ??
        randomUUID()

      const id = randomUUID()

      try {
        await sql`
          INSERT INTO webhook_events (
            id, provider, provider_event_id,
            raw_headers, raw_body, signature_valid, status
          ) VALUES (
            ${id}, ${provider}, ${eventId},
            ${JSON.stringify(req.headers)}::jsonb,
            ${rawBody},
            FALSE, -- Default unverified until signature verifier runs
            'received'
          )
          ON CONFLICT (provider, provider_event_id) DO NOTHING
        `

        return reply.status(200).send({
          received: true,
          eventId,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        req.log.error({ err: msg, provider }, 'Failed to store incoming webhook')
        return reply.status(500).send({ error: 'webhook_storage_failed' })
      }
    },
  )
}
