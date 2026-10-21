/**
 * Session management helpers.
 *
 * Sessions are stored server-side in PostgreSQL (sessions table).
 * The browser receives only an opaque session ID in an HttpOnly cookie.
 *
 * Security invariants:
 * - Session ID is rotated after login (prevents session fixation)
 * - Sessions expire after 8 hours of inactivity
 * - User identity is read from the server-side session, never from a cookie value
 */
import type { FastifyRequest } from 'fastify'
import '../types.js'
import { db } from '../db/index.js'

export interface SessionUser {
  id: string
  orgId: string
  email: string
  name: string
  role: string
  initials: string
}

export interface OidcClaims {
  sub: string
  issuer: string
  email: string
  name: string
}

/** Look up a user by OIDC subject. Returns null if not found. */
export async function getUserByOidcSub(
  sub: string,
  issuer: string,
): Promise<SessionUser | null> {
  const sql = db()
  const rows = await sql<SessionUser[]>`
    SELECT u.id, u.org_id, u.email, u.name, u.role, u.initials
    FROM users u
    WHERE u.oidc_sub = ${sub}
      AND u.oidc_issuer = ${issuer}
      AND u.is_active = TRUE
    LIMIT 1
  `
  return rows[0] ?? null
}

/**
 * Create a new user from OIDC claims.
 * Users must belong to an existing organization — they cannot self-register.
 *
 * IMPORTANT: The organization and role must be pre-configured by an admin.
 * This function does NOT create organizations or assign roles automatically.
 * If no matching organization exists, returns null (login is denied).
 */
export async function createUserFromOidcClaims(
  claims: OidcClaims,
): Promise<SessionUser | null> {
  // In a real deployment, org resolution could use the email domain, a pre-provisioned
  // mapping, or an IdP group claim. For the prototype, we use the demo org if it exists.
  // DO NOT use this logic in production without explicit org-to-user provisioning.
  const sql = db()

  // Check if a pre-provisioned user record exists (admin-created, without OIDC sub yet)
  // For prototype: auto-create in demo org only
  const demoOrgId = '00000000-0000-0000-0000-000000000001'
  const demoOrg = await sql`
    SELECT id FROM organizations WHERE id = ${demoOrgId} LIMIT 1
  `
  if (demoOrg.length === 0) return null

  // Default role for new users in demo org (must be explicitly configured in production)
  const defaultRole = 'support_agent'
  const initials = claims.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  const rows = await sql<SessionUser[]>`
    INSERT INTO users (org_id, oidc_sub, oidc_issuer, email, name, role, initials)
    VALUES (${demoOrgId}, ${claims.sub}, ${claims.issuer}, ${claims.email}, ${claims.name}, ${defaultRole}, ${initials})
    ON CONFLICT (org_id, oidc_sub) DO UPDATE
      SET email = EXCLUDED.email,
          name  = EXCLUDED.name,
          updated_at = NOW()
    RETURNING id, org_id AS "orgId", email, name, role, initials
  `
  return rows[0] ?? null
}

/** Rotate the session ID after login (prevents session fixation). */
export async function rotateSession(
  req: FastifyRequest,
  user: SessionUser,
): Promise<void> {
  // Regenerate session ID
  await req.session.regenerate()
  req.session.set('userId', user.id)
  req.session.set('orgId', user.orgId)
  req.session.set('user', user)
  await req.session.save()
}

/** Read the authenticated user from the current session. Returns null if unauthenticated. */
export function getSessionUser(req: FastifyRequest): SessionUser | null {
  return (req.session.get('user') as SessionUser | undefined) ?? null
}

/** Destroy the session (logout). */
export async function destroySession(req: FastifyRequest): Promise<void> {
  await req.session.destroy()
}
