import type { Role, ToolName } from './types'
import type { GatewayAuditEntry } from './audit'
import type { ApprovalRecord } from './types'
import { getUserByRole } from './mockDb'

export type AlertSeverity = 'high' | 'medium' | 'low'
export type AlertState = 'action_needed' | 'contained' | 'resolved'

export interface Alert {
  id: string
  severity: AlertSeverity
  state: AlertState
  title: string
  detail: string
  tags: string[]
  tool: ToolName
  entryIndex: number
  eventId: string
  timestamp: string
  user: { name: string; role: Role }
  approvalId?: string
  reviewer?: { name: string; role: Role }
}

export interface ChainStatusInput {
  ok: boolean
  brokenAt: number | null
}

export interface DeriveAlertsInput {
  entries: GatewayAuditEntry[]
  approvals: ApprovalRecord[]
  chain: ChainStatusInput
}

export interface InterventionsSummary {
  blocked: number
  held: number
  approved: number
  denied: number
}

function getRuleTags(ruleId: string, untrusted: boolean): string[] {
  const tags: string[] = []
  if (ruleId === 'task.scope') tags.push('Outside task grant')
  else if (ruleId === 'args.refund_limit') tags.push('Over refund limit')
  else if (ruleId === 'args.export_destination') tags.push('Outside company domain')
  else if (ruleId === 'source.untrusted_input') tags.push('Untrusted source')

  if (untrusted && !tags.includes('Untrusted source')) {
    tags.push('Untrusted source')
  }
  return tags
}

export function deriveAlerts({ entries, approvals, chain }: DeriveAlertsInput): Alert[] {
  const alerts: Alert[] = []

  // Map outcome entries by eventId for quick lookup
  const outcomeByEventId = new Map<string, GatewayAuditEntry>()
  for (const entry of entries) {
    if (entry.type === 'approval_outcome') {
      outcomeByEventId.set(entry.eventId, entry)
    }
  }

  // Map approval records by eventId
  const approvalByEventId = new Map<string, ApprovalRecord>()
  for (const ap of approvals) {
    approvalByEventId.set(ap.eventId, ap)
  }

  // Iterate decision entries (chronological)
  for (const entry of entries) {
    if (entry.type !== 'decision') continue

    const { decision, tool, reason, ruleId, provenance, eventId, index, timestamp, user } = entry

    if (decision === 'blocked') {
      const tags = ['Blocked']
      if (provenance.untrusted) {
        tags.push('Untrusted source')
      }
      alerts.push({
        id: `ALR-${eventId}`,
        severity: 'high',
        state: 'contained',
        title: `${tool} was blocked`,
        detail: reason,
        tags,
        tool,
        entryIndex: index,
        eventId,
        timestamp,
        user: { name: user.name, role: user.role },
      })
    } else if (decision === 'needs_approval') {
      const outcomeEntry = outcomeByEventId.get(eventId)
      const apRecord = approvalByEventId.get(eventId)
      const approvalId = apRecord?.id

      if (!outcomeEntry) {
        // Pending approval
        const tags = getRuleTags(ruleId, provenance.untrusted)
        let reviewer: { name: string; role: Role } | undefined
        if (apRecord?.requiredReviewerRole) {
          const rwUser = getUserByRole(apRecord.requiredReviewerRole)
          if (rwUser) {
            reviewer = { name: rwUser.name, role: rwUser.role }
          }
        }

        alerts.push({
          id: `ALR-${eventId}`,
          severity: 'medium',
          state: 'action_needed',
          title: `${tool} is waiting for approval`,
          detail: reason,
          tags,
          tool,
          entryIndex: index,
          eventId,
          timestamp,
          user: { name: user.name, role: user.role },
          approvalId,
          reviewer,
        })
      } else {
        // Resolved approval
        const rev = outcomeEntry.reviewer
        const outcome = rev?.outcome ?? 'approve'
        const reviewerName = rev?.name ?? 'Reviewer'
        const reviewerRole = rev?.role ?? 'Ops Manager'
        const note = rev?.note ?? ''
        const cleanNote = note.replace(/\.+$/, '')

        const isApproved = outcome === 'approve'
        const title = isApproved ? `${tool} was approved` : `${tool} was denied`
        const detail = isApproved
          ? `Approved by ${reviewerName}.`
          : `Denied by ${reviewerName}: ${cleanNote || note}.`

        const tags = getRuleTags(ruleId, provenance.untrusted)

        alerts.push({
          id: `ALR-${eventId}`,
          severity: 'low',
          state: 'resolved',
          title,
          detail,
          tags,
          tool,
          entryIndex: index,
          eventId,
          timestamp,
          user: { name: user.name, role: user.role },
          approvalId,
          reviewer: { name: reviewerName, role: reviewerRole },
        })
      }
    } else if (decision === 'allowed' && provenance.untrusted) {
      alerts.push({
        id: `ALR-${eventId}`,
        severity: 'medium',
        state: 'action_needed',
        title: `${tool} ran after reading untrusted text`,
        detail: reason,
        tags: ['Untrusted source'],
        tool,
        entryIndex: index,
        eventId,
        timestamp,
        user: { name: user.name, role: user.role },
      })
    }
  }

  // Sort alerts newest first (descending entryIndex)
  alerts.sort((a, b) => b.entryIndex - a.entryIndex)

  // Chain alert goes first if broken
  if (!chain.ok && chain.brokenAt !== null) {
    const brokenEntry = entries.find((e) => e.index === chain.brokenAt)
    const chainAlert: Alert = {
      id: 'ALR-CHAIN',
      severity: 'high',
      state: 'action_needed',
      title: `Audit chain is broken at entry #${chain.brokenAt}`,
      detail: 'This entry, or an earlier one, was changed.',
      tags: ['Audit'],
      tool: brokenEntry?.tool ?? 'invoice.lookup',
      entryIndex: chain.brokenAt,
      eventId: brokenEntry?.eventId ?? 'CHAIN',
      timestamp: brokenEntry?.timestamp ?? '',
      user: brokenEntry?.user
        ? { name: brokenEntry.user.name, role: brokenEntry.user.role }
        : { name: 'System', role: 'Ops Manager' },
    }
    alerts.unshift(chainAlert)
  }

  return alerts
}

export function summarizeInterventions(entries: GatewayAuditEntry[]): InterventionsSummary {
  let blocked = 0
  let held = 0
  let approved = 0
  let denied = 0

  for (const entry of entries) {
    if (entry.type === 'decision') {
      if (entry.decision === 'blocked') blocked++
      if (entry.decision === 'needs_approval') held++
    } else if (entry.type === 'approval_outcome') {
      if (entry.reviewer?.outcome === 'approve') approved++
      if (entry.reviewer?.outcome === 'deny') denied++
    }
  }

  return { blocked, held, approved, denied }
}
