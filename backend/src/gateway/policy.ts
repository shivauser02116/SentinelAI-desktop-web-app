/**
 * Server-side policy wrapper.
 *
 * Re-exports the front-end pure policy engine (src/gateway/policy.ts) and
 * wraps it with server-side concerns: org config, policy version loading,
 * and the DB-backed role-permission table.
 *
 * The existing src/gateway/policy.ts is the SINGLE authoritative policy engine.
 * We do not duplicate it here. Instead, we load the org's policy config from
 * the database and construct the EvalContext that the pure evaluate() function needs.
 *
 * IMPORTANT: The server-side decision is authoritative. The browser may display
 * a decision returned by the server, but must never compute or override it.
 */

/**
 * Org-level policy configuration loaded from DB.
 * This extends the prototype defaults with org-specific overrides.
 */
export interface OrgPolicyConfig {
  /** Map of role → allowed tool names */
  roleTools: Record<string, string[]>
  /** Reviewer chain: role → required reviewer role */
  reviewerChain: Record<string, string>
  /** Refund amount (in minor units, e.g., paise) above which approval is required */
  refundApprovalThresholdMinorUnits: number
  /** Policy version number for audit trail */
  version: number
  versionId: string
}

/**
 * Map application role names (DB) to the type system the pure policy engine uses.
 * DB stores snake_case; the policy engine uses the UI-facing role strings.
 */
export const ROLE_MAP: Record<string, string> = {
  support_agent: 'Support Agent',
  support_lead: 'Support Lead',
  ops_manager: 'Ops Manager',
  finance_admin: 'Finance Admin',
}

export const ROLE_MAP_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(ROLE_MAP).map(([k, v]) => [v, k]),
)

/** Load the current active policy version for an organization. */
export async function loadOrgPolicy(
  orgId: string,
  customSql?: any,
): Promise<OrgPolicyConfig | null> {
  const sql = customSql ?? (await import('../db/index.js')).db()

  const rows = await sql`
    SELECT id, version_num, snapshot
    FROM policy_versions
    WHERE org_id = ${orgId}
    ORDER BY version_num DESC
    LIMIT 1
  `

  if (rows.length === 0) return null

  const row = rows[0]!
  const snap = row['snapshot'] as Record<string, unknown>

  return {
    roleTools: (snap['roleTools'] as Record<string, string[]>) ?? {},
    reviewerChain: (snap['reviewerChain'] as Record<string, string>) ?? {},
    refundApprovalThresholdMinorUnits:
      (snap['refundApprovalThresholdMinorUnits'] as number) ?? 200000,
    version: row['versionNum'] as number,
    versionId: row['id'] as string,
  }
}

/**
 * Determine the required reviewer role for a given requester role.
 * Returns null if no reviewer chain is configured (role cannot request approvals).
 */
export function getRequiredReviewerRole(
  requesterRole: string,
  policy: OrgPolicyConfig,
): string | null {
  const dbRole = ROLE_MAP_REVERSE[requesterRole] ?? requesterRole
  return policy.reviewerChain[dbRole] ?? null
}
