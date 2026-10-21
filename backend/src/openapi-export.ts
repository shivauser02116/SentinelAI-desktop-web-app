/**
 * OpenAPI Specification Exporter.
 *
 * Boots the Fastify server, extracts the generated OpenAPI 3.1 schema,
 * and writes it to backend/openapi.json.
 *
 * Run via: npm run openapi:export
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildServer } from './server.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

async function exportOpenApi(): Promise<void> {
  // Ensure required environment variables have fallback defaults for spec export
  process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/sentinelai_dev'
  process.env['SESSION_SECRET'] = process.env['SESSION_SECRET'] ?? 'dev-secret-at-least-32-chars-long-here'
  process.env['CSRF_SECRET'] = process.env['CSRF_SECRET'] ?? 'dev-csrf-secret-at-least-32-chars-long'
  process.env['OIDC_ISSUER_URL'] = process.env['OIDC_ISSUER_URL'] ?? 'https://accounts.google.com'
  process.env['OIDC_CLIENT_ID'] = process.env['OIDC_CLIENT_ID'] ?? 'mock-client-id'
  process.env['OIDC_CLIENT_SECRET'] = process.env['OIDC_CLIENT_SECRET'] ?? 'mock-dev-secret'
  process.env['OIDC_REDIRECT_URI'] = process.env['OIDC_REDIRECT_URI'] ?? 'http://localhost:3001/auth/callback'
  process.env['FRONTEND_ORIGIN'] = process.env['FRONTEND_ORIGIN'] ?? 'http://localhost:5173'
  process.env['CREDENTIAL_ENCRYPTION_KEY'] =
    process.env['CREDENTIAL_ENCRYPTION_KEY'] ?? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

  const app = await buildServer({ logger: false })
  await app.ready()

  const openapiSpec = app.swagger()
  const outputPath = join(__dirname, '../openapi.json')

  writeFileSync(outputPath, JSON.stringify(openapiSpec, null, 2), 'utf8')
  // eslint-disable-next-line no-console
  console.log(`OpenAPI specification exported to: ${outputPath}`)

  await app.close()
}

exportOpenApi().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to export OpenAPI spec:', err)
  process.exit(1)
})
