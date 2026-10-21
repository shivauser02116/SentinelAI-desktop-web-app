import type { TaskGrant, ToolName } from './types'

export interface IssueGrantOptions {
  taskId: string
  userId: string
  allowTools: ToolName[]
  allowResources: string[]
  limits?: {
    requireApprovalAbove?: number
  }
  now?: () => Date
}

/** Issue a new task grant valid for 15 minutes from now. */
export function issueGrant(opts: IssueGrantOptions): TaskGrant {
  const now = opts.now ? opts.now() : new Date()
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000)
  return {
    taskId: opts.taskId,
    userId: opts.userId,
    allowTools: opts.allowTools,
    allowResources: opts.allowResources,
    limits: {
      requireApprovalAbove: opts.limits?.requireApprovalAbove ?? 2000,
    },
    issuedAt: now,
    expiresAt,
  }
}

export function isGrantExpired(grant: TaskGrant, now: Date): boolean {
  return now.getTime() >= grant.expiresAt.getTime()
}

export function isToolInGrant(grant: TaskGrant, tool: ToolName): boolean {
  return grant.allowTools.includes(tool)
}

/** Check whether the resolved resource is covered by the grant. */
export function isResourceInGrant(grant: TaskGrant, resource: string): boolean {
  if (grant.allowResources.includes('ALL')) return true
  return grant.allowResources.includes(resource)
}

/** Format expiresAt as HH:mm for use in reason strings. */
export function formatExpiry(grant: TaskGrant): string {
  const h = grant.expiresAt.getHours().toString().padStart(2, '0')
  const m = grant.expiresAt.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}
