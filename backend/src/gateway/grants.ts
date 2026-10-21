/**
 * Server-side Task Grant management.
 *
 * Task grants define the temporary, scoped authority issued to a user for
 * completing a specific task. Authority comes from the signed-in user and the grant,
 * NEVER from the AI agent or text the agent reads.
 *
 * Invariants:
 * - Grants are bound to an organization and user.
 * - Grants have an explicit expiry (default 15 minutes).
 * - A grant can be revoked before expiry.
 * - Tool calls outside allow_tools or allow_resources require approval.
 */
import type { Sql, TransactionSql } from 'postgres'
import { randomUUID } from 'node:crypto'

export interface TaskGrantRecord {
  id: string
  orgId: string
  userId: string
  policyVersionId: string
  taskId: string
  taskTitle: string
  allowTools: string[]
  allowResources: string[]
  requireApprovalAboveMinor: number
  issuedAt: Date
  expiresAt: Date
  revokedAt: Date | null
  revocationReason: string | null
}

export interface IssueGrantParams {
  orgId: string
  userId: string
  policyVersionId: string
  taskId: string
  taskTitle: string
  allowTools: string[]
  allowResources: string[]
  requireApprovalAboveMinor?: number | undefined
  ttlMinutes?: number | undefined
}

/** Issue a new task grant. */
export async function issueGrant(
  params: IssueGrantParams,
  sql: Sql | TransactionSql,
): Promise<TaskGrantRecord> {
  const runner = sql as Sql
  const id = randomUUID()
  const ttl = params.ttlMinutes ?? 15
  const requireApprovalAboveMinor = params.requireApprovalAboveMinor ?? 200000 // ₹2,000

  const rows = await runner<TaskGrantRecord[]>`
    INSERT INTO task_grants (
      id, org_id, user_id, policy_version_id,
      task_id, task_title, allow_tools, allow_resources,
      require_approval_above_minor, issued_at, expires_at
    ) VALUES (
      ${id}, ${params.orgId}, ${params.userId}, ${params.policyVersionId},
      ${params.taskId}, ${params.taskTitle}, ${params.allowTools}, ${params.allowResources},
      ${requireApprovalAboveMinor}, NOW(), NOW() + (${ttl} || ' minutes')::interval
    )
    RETURNING id, org_id AS "orgId", user_id AS "userId",
              policy_version_id AS "policyVersionId",
              task_id AS "taskId", task_title AS "taskTitle",
              allow_tools AS "allowTools", allow_resources AS "allowResources",
              require_approval_above_minor AS "requireApprovalAboveMinor",
              issued_at AS "issuedAt", expires_at AS "expiresAt",
              revoked_at AS "revokedAt", revocation_reason AS "revocationReason"
  `

  const grant = rows[0]
  if (!grant) throw new Error('Failed to issue task grant')
  return grant
}

/** Get a task grant by ID and orgId. */
export async function getGrant(
  grantId: string,
  orgId: string,
  sql: Sql | TransactionSql,
): Promise<TaskGrantRecord | null> {
  const runner = sql as Sql
  const rows = await runner<TaskGrantRecord[]>`
    SELECT id, org_id AS "orgId", user_id AS "userId",
           policy_version_id AS "policyVersionId",
           task_id AS "taskId", task_title AS "taskTitle",
           allow_tools AS "allowTools", allow_resources AS "allowResources",
           require_approval_above_minor AS "requireApprovalAboveMinor",
           issued_at AS "issuedAt", expires_at AS "expiresAt",
           revoked_at AS "revokedAt", revocation_reason AS "revocationReason"
    FROM task_grants
    WHERE id = ${grantId} AND org_id = ${orgId}
    LIMIT 1
  `
  return rows[0] ?? null
}

/** Check if a grant is currently valid (not revoked and not expired). */
export function isGrantValid(grant: TaskGrantRecord, now: Date = new Date()): boolean {
  if (grant.revokedAt !== null && grant.revokedAt !== undefined) return false
  return new Date(grant.expiresAt) > now
}

/**
 * Check if a tool and resource fall within the grant's scope.
 * Returns true if both tool and resource are permitted.
 */
export function checkScope(
  grant: TaskGrantRecord,
  tool: string,
  resource: string | null,
): { toolAllowed: boolean; resourceAllowed: boolean; inScope: boolean } {
  const toolAllowed = grant.allowTools.includes(tool)
  if (!resource) {
    return { toolAllowed, resourceAllowed: true, inScope: toolAllowed }
  }

  const resourceAllowed =
    grant.allowResources.includes('ALL') ||
    grant.allowResources.includes(resource)

  return {
    toolAllowed,
    resourceAllowed,
    inScope: toolAllowed && resourceAllowed,
  }
}
