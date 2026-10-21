/**
 * Policy management endpoints.
 *
 * GET /v1/policies/current - Returns the current policy configuration for the organization.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate } from '../middleware/authenticate.js'
import { loadOrgPolicy } from '../../gateway/policy.js'

export async function registerPolicyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/policies/current',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const orgId = req.sessionUser!.orgId
      const policy = await loadOrgPolicy(orgId)

      if (!policy) {
        return reply.status(404).send({
          error: 'policy_not_found',
          message: 'No active policy found for this organization.',
          requestId: req.id,
        })
      }

      return reply.status(200).send({
        data: policy,
        requestId: req.id,
      })
    },
  )
}
