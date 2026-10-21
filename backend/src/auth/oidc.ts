/**
 * OIDC authentication adapter.
 *
 * Supports any standards-compliant OpenID Connect provider. Configure via
 * OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URI.
 *
 * Security invariants:
 * - state and nonce are generated per-request and verified on callback
 * - exact redirect URI matching enforced by openid-client
 * - session rotated after successful login (see session.ts)
 * - ID token validated: issuer, audience, expiry, signature
 * - access token never sent to browser
 */
import { Issuer, type Client, generators } from 'openid-client'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import '../types.js'
import { getConfig } from '../config.js'
import {
  getUserByOidcSub,
  createUserFromOidcClaims,
  rotateSession,
  destroySession,
} from './session.js'

let _client: Client | null = null

export async function getOidcClient(): Promise<Client> {
  if (_client) return _client
  const cfg = getConfig()
  const issuer = await Issuer.discover(cfg.oidcIssuerUrl)
  _client = new issuer.Client({
    client_id: cfg.oidcClientId,
    client_secret: cfg.oidcClientSecret,
    redirect_uris: [cfg.oidcRedirectUri],
    response_types: ['code'],
  })
  return _client
}

/** Register OIDC routes: /auth/login, /auth/callback, /auth/logout */
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /auth/login ────────────────────────────────────────────────────────
  app.get('/auth/login', async (req: FastifyRequest, reply: FastifyReply) => {
    const client = await getOidcClient()
    const cfg = getConfig()

    const state = generators.state()
    const nonce = generators.nonce()

    // Store state/nonce in the session for CSRF verification on callback
    req.session.set('oidc_state', state)
    req.session.set('oidc_nonce', nonce)
    await req.session.save()

    const authorizationUrl = client.authorizationUrl({
      scope: cfg.oidcScopes,
      state,
      nonce,
      redirect_uri: cfg.oidcRedirectUri,
    })

    return reply.redirect(authorizationUrl, 302)
  })

  // ── GET /auth/callback ────────────────────────────────────────────────────
  app.get(
    '/auth/callback',
    async (req: FastifyRequest<{ Querystring: Record<string, string> }>, reply: FastifyReply) => {
      const client = await getOidcClient()
      const cfg = getConfig()

      const storedState = req.session.get('oidc_state') as string | undefined
      const storedNonce = req.session.get('oidc_nonce') as string | undefined

      if (!storedState || !storedNonce) {
        return reply.status(400).send({ error: 'invalid_session', message: 'No OIDC state in session.' })
      }

      try {
        // Validate state, code exchange, id_token signature, issuer, aud, nonce, expiry
        const tokenSet = await client.callback(
          cfg.oidcRedirectUri,
          client.callbackParams(req.url),
          { state: storedState, nonce: storedNonce },
        )

        const claims = tokenSet.claims()
        // claims.sub = unique user identifier from IdP
        // claims.email, claims.name = display info

        if (!claims.sub || !claims.email) {
          return reply.status(400).send({ error: 'missing_claims', message: 'IdP did not return required claims.' })
        }

        // Upsert user record
        const user = await getUserByOidcSub(claims.sub, claims.iss ?? cfg.oidcIssuerUrl)
          ?? await createUserFromOidcClaims({
            sub: claims.sub,
            issuer: claims.iss ?? cfg.oidcIssuerUrl,
            email: claims.email as string,
            name: (claims.name as string) ?? (claims.email as string),
          })

        if (!user) {
          // User's org does not exist or user is not permitted
          return reply.status(403).send({
            error: 'not_authorized',
            message: 'Your account is not associated with a SentinelAI organization. Contact your administrator.',
          })
        }

        // Rotate session ID after privilege elevation (prevents session fixation)
        await rotateSession(req, user)

        // Clear OIDC state/nonce from session
        req.session.set('oidc_state', undefined)
        req.session.set('oidc_nonce', undefined)
        await req.session.save()

        return reply.redirect(cfg.frontendOrigin, 302)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Log at warn level — may be benign (double submit, expired state)
        req.log.warn({ err: msg }, 'OIDC callback error')
        return reply.status(400).send({ error: 'auth_failed', message: 'Authentication failed. Please try again.' })
      }
    },
  )

  // ── POST /auth/logout ─────────────────────────────────────────────────────
  // POST (not GET) to prevent logout CSRF via image tags / links
  app.post('/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    await destroySession(req)
    return reply.status(204).send()
  })
}
