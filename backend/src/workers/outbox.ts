/**
 * Transactional Outbox Worker.
 *
 * Polls the outbox_jobs table for pending/failed jobs, executes them with
 * exponential backoff retries, and records execution status and audit logs.
 *
 * Invariants:
 * - Jobs are claimed using SELECT ... FOR UPDATE SKIP LOCKED to prevent worker race conditions.
 * - Max retry attempts enforced; dead-letter state ('dead') after max attempts.
 * - Idempotency key passed to provider adapters to prevent duplicate side effects.
 */
import type { Sql } from 'postgres'
import { db } from '../db/index.js'
import { MockAdapter } from '../adapters/mock.js'
import type { ProviderAdapter, ToolName } from '../adapters/types.js'

export interface OutboxJob {
  id: string
  jobType: string
  payload: Record<string, unknown>
  idempotencyKey: string | null
  status: 'pending' | 'processing' | 'done' | 'failed' | 'dead'
  attempts: number
  maxAttempts: number
  errorMessage: string | null
  scheduledAfter: Date
}

export class OutboxWorker {
  private readonly sql: Sql
  private readonly adapter: ProviderAdapter
  private isRunning = false

  constructor(sql?: Sql, adapter?: ProviderAdapter) {
    this.sql = sql ?? db()
    this.adapter = adapter ?? new MockAdapter()
  }

  /**
   * Process a single batch of pending jobs (up to batchSize).
   * Returns the number of jobs processed.
   */
  async processBatch(batchSize: number = 10): Promise<number> {
    const sql = this.sql

    // Claim jobs using SKIP LOCKED
    const jobs = await sql<OutboxJob[]>`
      UPDATE outbox_jobs
      SET status = 'processing',
          attempts = attempts + 1,
          last_attempted_at = NOW()
      WHERE id IN (
        SELECT id FROM outbox_jobs
        WHERE status IN ('pending', 'failed')
          AND scheduled_after <= NOW()
        ORDER BY scheduled_after ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, job_type AS "jobType", payload,
                idempotency_key AS "idempotencyKey",
                status, attempts, max_attempts AS "maxAttempts",
                error_message AS "errorMessage",
                scheduled_after AS "scheduledAfter"
    `

    for (const job of jobs) {
      await this.processJob(job)
    }

    return jobs.length
  }

  private async processJob(job: OutboxJob): Promise<void> {
    const sql = this.sql

    try {
      if (job.jobType === 'execute_action') {
        const payload = job.payload as {
          tool: ToolName
          args: Record<string, unknown>
          orgId: string
          actionId: string
          idempotencyKey: string
        }

        const result = await this.adapter.execute(
          payload.tool,
          payload.args,
          payload.idempotencyKey ?? job.id,
          payload.orgId,
        )

        if (!result.ok) {
          throw new Error(result.error ?? 'Provider execution failed')
        }
      }

      // Mark job done
      await sql`
        UPDATE outbox_jobs
        SET status = 'done',
            completed_at = NOW(),
            error_message = NULL
        WHERE id = ${job.id}
      `
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isDead = job.attempts >= job.maxAttempts
      const newStatus = isDead ? 'dead' : 'failed'

      // Exponential backoff: 2^attempts seconds
      const backoffSeconds = Math.pow(2, job.attempts)

      await sql`
        UPDATE outbox_jobs
        SET status = ${newStatus},
            error_message = ${msg},
            scheduled_after = NOW() + (${backoffSeconds} || ' seconds')::interval
        WHERE id = ${job.id}
      `
    }
  }

  /** Run the worker poll loop until stop() is called. */
  async start(pollIntervalMs: number = 2000): Promise<void> {
    this.isRunning = true
    while (this.isRunning) {
      try {
        await this.processBatch()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Outbox worker error:', err)
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }
  }

  stop(): void {
    this.isRunning = false
  }
}
