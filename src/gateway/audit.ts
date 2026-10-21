/**
 * Append-only, SHA-256 hash-chained audit log.
 *
 * Hash algorithm:
 *   hash = SHA-256 hex of (prevHash + canonicalJSON(entry_without_hash))
 *
 * canonicalJSON: keys sorted recursively, no whitespace.
 * Genesis prevHash: 64 zero characters.
 * Uses globalThis.crypto.subtle (Web Crypto API, available in Node 18+).
 *
 * append() is the only mutation; no update or delete is exposed.
 */
import type { Role, ToolName, Decision, AgentMode, CheckResult, Provenance } from './types'

// ── Constants ────────────────────────────────────────────────────────────────

export const GENESIS_HASH = '0'.repeat(64)

// ── Entry types ──────────────────────────────────────────────────────────────

export interface AuditUser {
  id: string
  name: string
  role: Role
}

export interface AuditReviewer {
  id: string
  name: string
  role: Role
  outcome: 'approve' | 'deny'
  note: string | null
}

export interface AuditExecution {
  status: 'executed' | 'not_executed' | 'pending'
  result?: unknown
}

export interface GatewayAuditEntry {
  index: number            // 1-based, assigned by AuditLog
  timestamp: string        // ISO 8601
  eventId: string
  type: 'decision' | 'approval_outcome'
  taskId: string
  user: AuditUser
  agentMode: AgentMode
  tool: ToolName
  args: Record<string, unknown>
  provenance: Provenance
  decision: Decision
  ruleId: string
  reason: string
  checks: CheckResult[]
  reviewer?: AuditReviewer
  execution: AuditExecution
  prevHash: string         // assigned by AuditLog
  hash: string             // SHA-256 hex, assigned by AuditLog
}

/** Input to append() — everything except the fields computed by AuditLog */
export type AuditEntryInput = Omit<GatewayAuditEntry, 'index' | 'prevHash' | 'hash'>

// ── Canonical JSON ───────────────────────────────────────────────────────────

/**
 * Produces a deterministic, whitespace-free JSON string.
 * All object keys are sorted recursively. Array order is preserved.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJSON).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(',') + '}'
}

// ── SHA-256 via Web Crypto API ───────────────────────────────────────────────

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compute the hash for an entry (all fields present except hash itself).
 * Input to SHA-256: prevHash + canonicalJSON(entry_without_hash)
 */
export async function computeHash(
  entryWithoutHash: Omit<GatewayAuditEntry, 'hash'>,
): Promise<string> {
  const input = entryWithoutHash.prevHash + canonicalJSON(entryWithoutHash)
  return sha256hex(input)
}

// ── Chain verification ───────────────────────────────────────────────────────

/**
 * Verify the hash chain integrity.
 * Returns { ok: true } if every entry's hash and prevHash link correctly.
 * Returns { ok: false, brokenAt: index } at the first broken link.
 */
export async function verifyChain(
  entries: GatewayAuditEntry[],
): Promise<{ ok: boolean; brokenAt: number | null }> {
  let prev = GENESIS_HASH
  for (const entry of entries) {
    const { hash, ...rest } = entry
    const expected = await computeHash(rest as Omit<GatewayAuditEntry, 'hash'>)
    if (entry.prevHash !== prev || hash !== expected) {
      return { ok: false, brokenAt: entry.index }
    }
    prev = hash
  }
  return { ok: true, brokenAt: null }
}

// ── AuditLog class ───────────────────────────────────────────────────────────

export class AuditLog {
  private _entries: GatewayAuditEntry[] = []
  private _prevHash: string = GENESIS_HASH

  /**
   * Append a new entry to the log.
   * Computes index, prevHash and hash automatically.
   * Returns the completed entry.
   */
  async append(input: AuditEntryInput): Promise<GatewayAuditEntry> {
    const index = this._entries.length + 1
    const prevHash = this._prevHash
    const withoutHash: Omit<GatewayAuditEntry, 'hash'> = { ...input, index, prevHash }
    const hash = await computeHash(withoutHash)
    const entry: GatewayAuditEntry = { ...withoutHash, hash }
    this._entries.push(entry)
    this._prevHash = hash
    return entry
  }

  /** Returns a shallow copy of all entries (the array is not mutable externally). */
  getAll(): GatewayAuditEntry[] {
    return [...this._entries]
  }

  /** Clear the log and reset to genesis state. */
  reset(): void {
    this._entries = []
    this._prevHash = GENESIS_HASH
  }

  /** Restore exact entries (e.g. from a backup taken before tampering). */
  _restoreEntries(entries: GatewayAuditEntry[]): void {
    this._entries = [...entries]
    this._prevHash = entries.length > 0 ? entries[entries.length - 1].hash : GENESIS_HASH
  }

  /**
   * DEMO ONLY — mutates the `reason` of the 4th entry (index 4) in memory,
   * or the last entry if there are fewer than 4. After this call, verifyChain()
   * will return { ok: false, brokenAt: <targeted index> }.
   *
   * Call reset() to restore a clean state.
   *
   * @returns The 1-based index of the tampered entry, or null if log is empty.
   */
  _tamperForDemo(): number | null {
    if (this._entries.length === 0) return null
    const targetIndex = this._entries.length >= 4 ? 4 : this._entries.length
    this._entries = this._entries.map((e) =>
      e.index === targetIndex
        ? { ...e, reason: e.reason + ' (tampered: this entry was changed after recording)' }
        : e,
    )
    return targetIndex
  }
}
