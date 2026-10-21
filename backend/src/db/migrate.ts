/**
 * Database migration runner.
 * Usage: npm run db:migrate
 *
 * Reads all SQL files from src/db/migrations/ in filename order
 * and applies any that have not yet been recorded in the migrations log table.
 *
 * For production, use a dedicated migration tool (e.g., Flyway, Liquibase, or
 * a CI migration step) rather than this lightweight runner.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { getConfig } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, 'migrations')

async function migrate(): Promise<void> {
  const cfg = getConfig()
  const sql = postgres(cfg.databaseUrl, { ssl: cfg.nodeEnv === 'production' })

  try {
    // Ensure the migrations tracking table exists
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         SERIAL PRIMARY KEY,
        filename   TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    const applied = new Set(
      (await sql`SELECT filename FROM _migrations`).map((r) => r.filename as string),
    )

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort()

    let count = 0
    for (const file of files) {
      if (applied.has(file)) continue
      const contents = await readFile(join(MIGRATIONS_DIR, file), 'utf-8')
      console.log(`Applying migration: ${file}`)
      await sql.begin(async (trx) => {
        await trx.unsafe(contents)
        await trx`INSERT INTO _migrations (filename) VALUES (${file})`
      })
      count++
    }

    if (count === 0) {
      console.log('No new migrations to apply.')
    } else {
      console.log(`Applied ${count} migration(s).`)
    }
  } finally {
    await sql.end()
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
