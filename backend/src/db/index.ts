/**
 * Database connection pool.
 * Uses the `postgres` (porsager/postgres) driver.
 *
 * Import `db` everywhere you need SQL access.
 * Never import this from front-end code.
 */
import postgres from 'postgres'
import { getConfig } from '../config.js'

let _db: ReturnType<typeof postgres> | null = null

export function getDb(): ReturnType<typeof postgres> {
  if (!_db) {
    const cfg = getConfig()
    _db = postgres(cfg.databaseUrl, {
      // Connection pool: max 10 connections per server instance
      max: 10,
      // Abort idle connections after 30 seconds
      idle_timeout: 30,
      // Abort queries after 10 seconds
      connect_timeout: 10,
      // Prefer SSL in production
      ssl: cfg.nodeEnv === 'production' ? { rejectUnauthorized: true } : false,
      // Transform column names: snake_case DB → camelCase TS
      transform: postgres.camel,
      // Log slow queries in development
      ...(cfg.nodeEnv === 'development' && {
        debug: (_, query, params) => {
          if (query.trim().startsWith('--')) return
          // Only log in verbose mode to avoid noise
          if (process.env['DB_DEBUG']) {
            console.debug('[sql]', query.slice(0, 200), params?.slice(0, 5))
          }
        },
      }),
    })
  }
  return _db
}

/** Graceful shutdown — call before process.exit() */
export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.end()
    _db = null
  }
}

// Convenience re-export so callers can use: import { db } from '../db/index.js'
export const db = getDb
