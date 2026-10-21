import { describe, it, expect } from 'vitest'
import { ServerGateway } from '../src/gateway/gateway.js'
import { MockAdapter } from '../src/adapters/mock.js'
import type { SessionUser } from '../src/auth/session.js'
import type { TaskGrantRecord } from '../src/gateway/grants.js'

describe('ServerGateway End-to-End Workflow', () => {
  const user: SessionUser = {
    id: 'u-1',
    orgId: '00000000-0000-0000-0000-000000000001',
    email: 'rohan@example.com',
    name: 'Rohan Joshi',
    role: 'support_agent',
    initials: 'RJ',
  }

  const grant: TaskGrantRecord = {
    id: 'g-1',
    orgId: user.orgId,
    userId: user.id,
    policyVersionId: '00000000-0000-0000-0000-000000000002',
    taskId: 'TSK-101',
    taskTitle: 'Investigate dispute',
    allowTools: ['invoice.lookup', 'refund.issue'],
    allowResources: ['C-204'],
    requireApprovalAboveMinor: 200000,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 900000),
    revokedAt: null,
    revocationReason: null,
  }

  // In-memory mock database state for testing gateway methods
  const createMockDb = () => {
    const insertedActions: any[] = []
    const insertedApprovals: any[] = []
    const insertedExecutions: any[] = []
    const auditEvents: any[] = []

    const mockSql = ((strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.join('?')

      // Mock policy query
      if (query.includes('FROM policy_versions')) {
        return [
          {
            id: '00000000-0000-0000-0000-000000000002',
            versionNum: 1,
            snapshot: {
              roleTools: {
                support_agent: ['invoice.lookup', 'refund.issue'],
                support_lead: ['invoice.lookup', 'refund.issue', 'customer.export'],
                finance_admin: ['payroll.export'],
                ops_manager: [],
              },
              reviewerChain: {
                support_agent: 'support_lead',
                support_lead: 'ops_manager',
              },
              refundApprovalThresholdMinorUnits: 200000,
            },
          },
        ]
      }

      // Mock audit last entry query
      if (query.includes('FROM audit_events') && query.includes('FOR UPDATE')) {
        const last = auditEvents[auditEvents.length - 1]
        return last ? [{ hash: last.hash, orgSeq: BigInt(last.orgSeq) }] : []
      }

      // Mock audit insert
      if (query.includes('INSERT INTO audit_events')) {
        const event = {
          id: values[0],
          orgSeq: BigInt(auditEvents.length + 1),
          orgId: values[2],
          actorName: values[4],
          decision: values[16],
          prevHash: values[30],
          hash: values[31],
        }
        auditEvents.push(event)
        return [event]
      }

      // Mock proposed_actions insert
      if (query.includes('INSERT INTO proposed_actions')) {
        insertedActions.push(values)
        return []
      }

      // Mock approval_requests insert
      if (query.includes('INSERT INTO approval_requests')) {
        insertedApprovals.push(values)
        return []
      }

      // Mock execution_attempts insert
      if (query.includes('INSERT INTO execution_attempts')) {
        insertedExecutions.push(values)
        return []
      }

      return []
    }) as any

    mockSql.begin = async (cb: any) => cb(mockSql)

    return {
      sql: mockSql,
      insertedActions,
      insertedApprovals,
      insertedExecutions,
      auditEvents,
    }
  }

  it('handles allowed call: submits, evaluates, executes with adapter, logs audit events', async () => {
    const mock = createMockDb()
    const gateway = new ServerGateway(mock.sql)
    const adapter = new MockAdapter()

    const result = await gateway.submit({
      call: {
        tool: 'invoice.lookup',
        args: { invoice_id: 'INV-1042' },
        provenance: { label: 'Ticket', untrusted: false },
      },
      user,
      grant,
      agentMode: 'simulated',
      adapter,
    })

    expect(result.decision).toBe('allowed')
    expect(result.ruleId).toBe('allow.default')
    expect(result.execution?.status).toBe('executed')
    expect(result.execution?.data?.['id']).toBe('INV-1042')
    expect(result.execution?.data?.['_simulated']).toBe(true)
    expect(result.approvalId).toBeUndefined()
    expect(mock.insertedActions).toHaveLength(1)
    expect(mock.insertedExecutions).toHaveLength(1)
    expect(mock.insertedApprovals).toHaveLength(0)
    expect(mock.auditEvents.length).toBeGreaterThanOrEqual(2) // decision + execution_outcome
  })

  it('handles needs_approval call: creates approval_request and does NOT call tool adapter', async () => {
    const mock = createMockDb()
    const gateway = new ServerGateway(mock.sql)
    const adapter = new MockAdapter()

    const result = await gateway.submit({
      call: {
        tool: 'refund.issue',
        args: { invoice_id: 'INV-1042', amount: 25000 },
        provenance: { label: 'Ticket', untrusted: false },
      },
      user,
      grant,
      agentMode: 'simulated',
      adapter,
    })

    expect(result.decision).toBe('needs_approval')
    expect(result.ruleId).toBe('args.refund_limit')
    expect(result.approvalId).toBeDefined()
    expect(result.execution?.status).toBe('not_executed')
    expect(mock.insertedApprovals).toHaveLength(1)
    expect(mock.insertedExecutions).toHaveLength(0) // Tool was NOT called!
  })

  it('handles blocked call: blocks, logs decision, does NOT create approval, does NOT call adapter', async () => {
    const mock = createMockDb()
    const gateway = new ServerGateway(mock.sql)
    const adapter = new MockAdapter()

    const result = await gateway.submit({
      call: {
        tool: 'payroll.export',
        args: { period: '2026-10', format: 'csv' },
        provenance: { label: 'Dispute attachment page 3', untrusted: true },
      },
      user,
      grant,
      agentMode: 'simulated',
      adapter,
    })

    expect(result.decision).toBe('blocked')
    expect(result.ruleId).toBe('role.tool_access')
    expect(result.approvalId).toBeUndefined()
    expect(result.execution?.status).toBe('not_executed')
    expect(mock.insertedApprovals).toHaveLength(0)
    expect(mock.insertedExecutions).toHaveLength(0) // Tool was NOT called!
  })
})
