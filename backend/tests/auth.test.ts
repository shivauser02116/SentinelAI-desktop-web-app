import { describe, it, expect } from 'vitest'
import { ROLE_MAP, ROLE_MAP_REVERSE, getRequiredReviewerRole, type OrgPolicyConfig } from '../src/gateway/policy.js'
import { authenticate } from '../src/api/middleware/authenticate.js'
import type { SessionUser } from '../src/auth/session.js'

describe('Auth & Identity Layer', () => {
  describe('Role Mapping Fidelity', () => {
    it('correctly maps all standard DB snake_case roles to UI display roles', () => {
      expect(ROLE_MAP['support_agent']).toBe('Support Agent')
      expect(ROLE_MAP['support_lead']).toBe('Support Lead')
      expect(ROLE_MAP['ops_manager']).toBe('Ops Manager')
      expect(ROLE_MAP['finance_admin']).toBe('Finance Admin')
    })

    it('correctly maps all UI display roles back to DB snake_case roles', () => {
      expect(ROLE_MAP_REVERSE['Support Agent']).toBe('support_agent')
      expect(ROLE_MAP_REVERSE['Support Lead']).toBe('support_lead')
      expect(ROLE_MAP_REVERSE['Ops Manager']).toBe('ops_manager')
      expect(ROLE_MAP_REVERSE['Finance Admin']).toBe('finance_admin')
    })

    it('reviewer chain lookup handles both UI and DB role formats', () => {
      const policy: OrgPolicyConfig = {
        roleTools: {},
        reviewerChain: {
          support_agent: 'support_lead',
          support_lead: 'ops_manager',
        },
        refundApprovalThresholdMinorUnits: 200000,
        version: 1,
        versionId: 'v-1',
      }

      // Looking up via UI display string
      expect(getRequiredReviewerRole('Support Agent', policy)).toBe('support_lead')
      expect(getRequiredReviewerRole('Support Lead', policy)).toBe('ops_manager')
      expect(getRequiredReviewerRole('Ops Manager', policy)).toBeNull()

      // Looking up via DB snake_case string
      expect(getRequiredReviewerRole('support_agent', policy)).toBe('support_lead')
      expect(getRequiredReviewerRole('support_lead', policy)).toBe('ops_manager')
    })
  })

  describe('Authentication Middleware', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const mockReq = {
        session: {
          get: () => undefined,
        },
        id: 'req-123',
      } as any

      let statusCode = 0
      let responseBody: any = null

      const mockReply = {
        status: (code: number) => {
          statusCode = code
          return {
            send: (body: any) => {
              responseBody = body
            },
          }
        },
      } as any

      await authenticate(mockReq, mockReply)

      expect(statusCode).toBe(401)
      expect(responseBody.error).toBe('unauthenticated')
      expect(responseBody.requestId).toBe('req-123')
      expect(mockReq.sessionUser).toBeUndefined()
    })

    it('attaches sessionUser to request when authenticated session exists', async () => {
      const testUser: SessionUser = {
        id: 'u-99',
        orgId: 'org-test',
        email: 'priya@example.com',
        name: 'Priya Sharma',
        role: 'support_lead',
        initials: 'PS',
      }

      const mockReq = {
        session: {
          get: (key: string) => (key === 'user' ? testUser : undefined),
        },
        id: 'req-456',
      } as any

      const mockReply = {
        status: () => ({ send: () => {} }),
      } as any

      await authenticate(mockReq, mockReply)

      expect(mockReq.sessionUser).toBeDefined()
      expect(mockReq.sessionUser.id).toBe('u-99')
      expect(mockReq.sessionUser.name).toBe('Priya Sharma')
      expect(mockReq.sessionUser.role).toBe('support_lead')
    })
  })
})
