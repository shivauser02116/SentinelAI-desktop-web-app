/**
 * SentinelAI Backend Server Entry Point.
 *
 * Starts the Fastify server, connects to PostgreSQL, and registers graceful shutdown.
 */
import { getConfig } from './config.js'
import { buildServer } from './server.js'
import { closeDb } from './db/index.js'

async function main(): Promise<void> {
  const cfg = getConfig()
  const app = await buildServer()

  try {
    const address = await app.listen({
      host: cfg.host,
      port: cfg.port,
    })
    app.log.info({ address }, `SentinelAI Backend running at ${address}`)
    app.log.info({ docs: `${address}/docs` }, `OpenAPI documentation available at ${address}/docs`)
  } catch (err) {
    app.log.error(err, 'Failed to start server')
    process.exit(1)
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Received shutdown signal, stopping gracefully...')
    try {
      await app.close()
      await closeDb()
      app.log.info('Shutdown complete.')
      process.exit(0)
    } catch (err) {
      app.log.error(err, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal initialization error:', err)
  process.exit(1)
})
