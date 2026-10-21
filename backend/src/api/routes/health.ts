/**
 * Health check endpoints.
 *
 * GET /health/live  - Liveness probe: returns 200 if the process is up.
 * GET /health/ready - Readiness probe: returns 200 if DB is reachable, 503 otherwise.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { db } from '../../db/index.js'

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    })
  })

  app.get('/health/ready', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const sql = db()
      await sql`SELECT 1`
      return reply.status(200).send({
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return reply.status(503).send({
        status: 'not_ready',
        database: 'disconnected',
        error: msg,
        timestamp: new Date().toISOString(),
      })
    }
  })
}
