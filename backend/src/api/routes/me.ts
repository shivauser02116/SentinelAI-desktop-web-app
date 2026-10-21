/**
 * Identity and Session endpoint.
 *
 * GET /v1/me - Returns authenticated user details and organization information.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate } from '../middleware/authenticate.js'
import { ROLE_MAP } from '../../gateway/policy.js'

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/me',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.sessionUser!
      return reply.status(200).send({
        data: {
          id: user.id,
          orgId: user.orgId,
          email: user.email,
          name: user.name,
          role: user.role,
          roleDisplay: ROLE_MAP[user.role] ?? user.role,
          initials: user.initials,
        },
        requestId: req.id,
      })
    },
  )
}
