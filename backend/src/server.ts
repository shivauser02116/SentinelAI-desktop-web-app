/**
 * Fastify Server Factory.
 *
 * Configures all security headers, CORS, cookies, sessions, rate-limiting,
 * Swagger/OpenAPI documentation, and registers all API routes.
 */
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify'
import { randomUUID } from 'node:crypto'
import fastifyCookie from '@fastify/cookie'
import fastifyCors from '@fastify/cors'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifySession from '@fastify/session'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import './types.js'
import { getConfig } from './config.js'
import { registerAuthRoutes } from './auth/oidc.js'
import { registerHealthRoutes } from './api/routes/health.js'
import { registerMeRoutes } from './api/routes/me.js'
import { registerPolicyRoutes } from './api/routes/policies.js'
import { registerTaskRoutes } from './api/routes/tasks.js'
import { registerActionRoutes } from './api/routes/actions.js'
import { registerApprovalRoutes } from './api/routes/approvals.js'
import { registerAuditRoutes } from './api/routes/audit.js'
import { registerIntegrationRoutes } from './api/routes/integrations.js'

export interface ServerOptions {
  logger?: boolean | Record<string, unknown>
}

export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const cfg = getConfig()

  const app = Fastify({
    logger: opts.logger ?? {
      level: cfg.nodeEnv === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    genReqId: () => randomUUID(),
  })

  // ── Security Headers ──────────────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", cfg.frontendOrigin],
      },
    },
    crossOriginEmbedderPolicy: false,
  })

  // ── CORS ──────────────────────────────────────────────────────────────────
  await app.register(fastifyCors, {
    origin: [cfg.frontendOrigin],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })

  // ── Cookies & Sessions ────────────────────────────────────────────────────
  await app.register(fastifyCookie, {
    secret: cfg.sessionSecret,
  })

  await app.register(fastifySession, {
    secret: cfg.sessionSecret,
    cookie: {
      secure: cfg.nodeEnv === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    },
    saveUninitialized: false,
  })

  // ── Rate Limiting ─────────────────────────────────────────────────────────
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  // ── Swagger / OpenAPI ─────────────────────────────────────────────────────
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'SentinelAI Policy Gateway API',
        description:
          'Server-side policy enforcement, task-scoped grants, human approvals, and tamper-evident audit log for AI agents.',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://${cfg.host}:${cfg.port}`,
          description: 'Development server',
        },
      ],
      tags: [
        { name: 'Health', description: 'Liveness and readiness checks' },
        { name: 'Auth', description: 'OpenID Connect authentication' },
        { name: 'Identity', description: 'Current user profile and organization' },
        { name: 'Policy', description: 'Active policy version and rules' },
        { name: 'Tasks', description: 'Task-scoped authority grants' },
        { name: 'Actions', description: 'Tool call evaluation and execution' },
        { name: 'Approvals', description: 'Human-in-the-loop approval workflows' },
        { name: 'Audit', description: 'Cryptographically chained audit trail' },
        { name: 'Integrations', description: 'Business system connections and webhooks' },
      ],
    },
  })

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  })

  // ── Register Routes ───────────────────────────────────────────────────────
  await registerHealthRoutes(app)
  await registerAuthRoutes(app)
  await registerMeRoutes(app)
  await registerPolicyRoutes(app)
  await registerTaskRoutes(app)
  await registerActionRoutes(app)
  await registerApprovalRoutes(app)
  await registerAuditRoutes(app)
  await registerIntegrationRoutes(app)

  // ── Global Error Handler ──────────────────────────────────────────────────
  app.setErrorHandler((error: FastifyError, req, reply) => {
    req.log.error({ err: error.message, stack: error.stack }, 'Request error')

    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500

    const isClientError = statusCode < 500
    const message = isClientError ? error.message : 'Internal Server Error'

    return reply.status(statusCode).send({
      error: error.name || 'internal_error',
      message,
      requestId: req.id,
    })
  })

  return app
}
