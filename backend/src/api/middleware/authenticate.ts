/**
 * Authentication middleware.
 * Attach to any route that requires an authenticated user.
 *
 * Usage:
 *   app.get('/v1/me', { preHandler: [authenticate] }, handler)
 */
import type { FastifyRequest, FastifyReply } from 'fastify'
import '../../types.js'
import { getSessionUser } from '../../auth/session.js'

export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = getSessionUser(req)
  if (!user) {
    return reply.status(401).send({
      error: 'unauthenticated',
      message: 'You must be logged in to access this resource.',
      requestId: req.id,
    })
  }
  // Attach user to request for downstream handlers
  req.sessionUser = user
}
