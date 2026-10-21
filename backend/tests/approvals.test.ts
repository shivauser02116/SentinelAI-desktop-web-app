import { describe, it, expect } from 'vitest'
import { ServerGateway, type ResolveApprovalParams } from '../src/gateway/gateway.js'
import type { SessionUser } from '../src/auth/session.js'

describe('Approval Workflow Constraints', () => {
  const requester: SessionUser = {
    id: 'u-requester',
    orgId: 'org-test',
    email: 'rohan@example.com',
    name: 'Rohan Joshi',
    role: 'support_agent',
    initials: 'RJ',
  }

  const validReviewer: SessionUser = {
    id: 'u-reviewer-lead',
    orgId: 'org-test',
    email: 'priya@example.com',
    name: 'Priya Sharma',
    role: 'support_lead',
    initials: 'PS',
  }

  const wrongRoleReviewer: SessionUser = {
    id: 'u-reviewer-ops',
    orgId: 'org-test',
    email: 'dev@example.com',
    name: 'Dev Malik',
    role: 'ops_manager',
    initials: 'DM',
  }

  // Simulated DB returning approval record
  const createMockSql = (approvalRecord: {
    id: string
    orgId: string
    actionId: string
    requesterId: string
    requiredReviewerRole: string
    status: string
    frozenCall: { tool: string; args: Record<string, unknown>; provenance: { label: string; untrusted: boolean } }
    expiresAt: Date
  } | null) => {
    const fn = (async () => {
      return approvalRecord ? [approvalRecord] : []
    }) as any
    fn.begin = async (cb: any) => cb(fn)
    return fn
  }

  it('rejects self-approval: requester cannot approve their own request', async () => {
    const mockSql = createMockSql({
      id: 'appr-1',
      orgId: 'org-test',
      actionId: 'act-1',
      requesterId: requester.id,
      requiredReviewerRole: 'support_agent',
      status: 'pending',
      frozenCall: { tool: 'refund.issue', args: { amount: 25000 }, provenance: { label: 'Ticket', untrusted: false } },
      expiresAt: new Date(Date.now() + 3600000),
    })

    const gateway = new ServerGateway(mockSql)

    await expect(
      gateway.resolveApproval({
        approvalId: 'appr-1',
        reviewer: requester, // Self-approval!
        outcome: 'approved',
        orgId: 'org-test',
      }),
    ).rejects.toThrow('Self-approval is forbidden')
  })

  it('rejects reviewer with wrong role', async () => {
    const mockSql = createMockSql({
      id: 'appr-2',
      orgId: 'org-test',
      actionId: 'act-2',
      requesterId: requester.id,
      requiredReviewerRole: 'support_lead', // Requires support_lead
      status: 'pending',
      frozenCall: { tool: 'refund.issue', args: { amount: 25000 }, provenance: { label: 'Ticket', untrusted: false } },
      expiresAt: new Date(Date.now() + 3600000),
    })

    const gateway = new ServerGateway(mockSql)

    await expect(
      gateway.resolveApproval({
        approvalId: 'appr-2',
        reviewer: wrongRoleReviewer, // ops_manager, not support_lead!
        outcome: 'approved',
        orgId: 'org-test',
      }),
    ).rejects.toThrow("Reviewer role 'ops_manager' is not authorized to review this request")
  })

  it('rejects denial without an explanatory note', async () => {
    const mockSql = createMockSql({
      id: 'appr-3',
      orgId: 'org-test',
      actionId: 'act-3',
      requesterId: requester.id,
      requiredReviewerRole: 'support_lead',
      status: 'pending',
      frozenCall: { tool: 'refund.issue', args: { amount: 25000 }, provenance: { label: 'Ticket', untrusted: false } },
      expiresAt: new Date(Date.now() + 3600000),
    })

    const gateway = new ServerGateway(mockSql)

    await expect(
      gateway.resolveApproval({
        approvalId: 'appr-3',
        reviewer: validReviewer,
        outcome: 'denied',
        note: '', // Empty note!
        orgId: 'org-test',
      }),
    ).rejects.toThrow('A denial note is required when rejecting a request')
  })

  it('rejects resolution of an expired approval request', async () => {
    const mockSql = createMockSql({
      id: 'appr-4',
      orgId: 'org-test',
      actionId: 'act-4',
      requesterId: requester.id,
      requiredReviewerRole: 'support_lead',
      status: 'pending',
      frozenCall: { tool: 'refund.issue', args: { amount: 25000 }, provenance: { label: 'Ticket', untrusted: false } },
      expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
    })

    const gateway = new ServerGateway(mockSql)

    await expect(
      gateway.resolveApproval({
        approvalId: 'appr-4',
        reviewer: validReviewer,
        outcome: 'approved',
        orgId: 'org-test',
      }),
    ).rejects.toThrow('has expired')
  })

  it('rejects duplicate resolution of an already resolved approval', async () => {
    const mockSql = createMockSql({
      id: 'appr-5',
      orgId: 'org-test',
      actionId: 'act-5',
      requesterId: requester.id,
      requiredReviewerRole: 'support_lead',
      status: 'approved', // Already approved!
      frozenCall: { tool: 'refund.issue', args: { amount: 25000 }, provenance: { label: 'Ticket', untrusted: false } },
      expiresAt: new Date(Date.now() + 3600000),
    })

    const gateway = new ServerGateway(mockSql)

    await expect(
      gateway.resolveApproval({
        approvalId: 'appr-5',
        reviewer: validReviewer,
        outcome: 'approved',
        orgId: 'org-test',
      }),
    ).rejects.toThrow('is already resolved')
  })
})
