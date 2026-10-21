import '@fastify/session'
import type { SessionUser } from './auth/session.js'

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser?: SessionUser
  }

  interface Session {
    oidc_state?: string | undefined
    oidc_nonce?: string | undefined
    userId?: string | undefined
    orgId?: string | undefined
    user?: SessionUser | undefined
    [key: string]: unknown
  }
}
