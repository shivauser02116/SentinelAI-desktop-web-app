/**
 * Centralized configuration loader.
 * All environment variables are read here; the rest of the server uses typed values.
 *
 * NEVER read process.env directly outside this module.
 * NEVER log the Config object (contains session/csrf secrets).
 */
import { z } from 'zod'

const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().int().min(1).max(65535).default(3001),
  host: z.string().default('0.0.0.0'),

  databaseUrl: z.string().url({ message: 'DATABASE_URL must be a valid postgres:// URL' }),

  sessionSecret: z.string().min(32, { message: 'SESSION_SECRET must be at least 32 characters' }),
  csrfSecret: z.string().min(32, { message: 'CSRF_SECRET must be at least 32 characters' }),

  oidcIssuerUrl: z.string().url({ message: 'OIDC_ISSUER_URL must be a valid URL' }),
  oidcClientId: z.string().min(1),
  oidcClientSecret: z.string().min(1),
  oidcRedirectUri: z.string().url({ message: 'OIDC_REDIRECT_URI must be a valid URL' }),
  oidcScopes: z.string().default('openid profile email'),

  frontendOrigin: z.string().url({ message: 'FRONTEND_ORIGIN must be a valid URL' }),

  credentialEncryptionKey: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, { message: 'CREDENTIAL_ENCRYPTION_KEY must be 64 hex chars (32 bytes)' }),

  auditCheckpointUrl: z.string().url().optional().or(z.literal('')).transform((v) => v || undefined),

  rateLimitMax: z.coerce.number().int().positive().default(100),
  rateLimitWindowMs: z.coerce.number().int().positive().default(60_000),
})

export type Config = z.infer<typeof ConfigSchema>

let _config: Config | null = null

export function getConfig(): Config {
  if (_config) return _config

  const raw = {
    nodeEnv: process.env['NODE_ENV'],
    port: process.env['PORT'],
    host: process.env['HOST'],
    databaseUrl: process.env['DATABASE_URL'],
    sessionSecret: process.env['SESSION_SECRET'],
    csrfSecret: process.env['CSRF_SECRET'],
    oidcIssuerUrl: process.env['OIDC_ISSUER_URL'],
    oidcClientId: process.env['OIDC_CLIENT_ID'],
    oidcClientSecret: process.env['OIDC_CLIENT_SECRET'],
    oidcRedirectUri: process.env['OIDC_REDIRECT_URI'],
    oidcScopes: process.env['OIDC_SCOPES'],
    frontendOrigin: process.env['FRONTEND_ORIGIN'],
    credentialEncryptionKey: process.env['CREDENTIAL_ENCRYPTION_KEY'],
    auditCheckpointUrl: process.env['AUDIT_CHECKPOINT_URL'],
    rateLimitMax: process.env['RATE_LIMIT_MAX'],
    rateLimitWindowMs: process.env['RATE_LIMIT_WINDOW_MS'],
  }

  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Configuration error — check your .env file:\n${issues}`)
  }

  _config = result.data
  return _config
}

/** Call in tests only to reset the config singleton. */
export function _resetConfig(): void {
  _config = null
}
