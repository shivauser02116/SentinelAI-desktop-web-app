/**
 * Demo-only tampering helper.
 *
 * Mutates one stored entry's reason in memory so that verifyChain fails
 * at that index.
 *
 * reset() restores the log.
 */
import type { AuditLog, GatewayAuditEntry } from '../gateway/audit'

let _backupEntries: GatewayAuditEntry[] | null = null

/**
 * Mutates one stored entry's reason in memory so that verifyChain fails at that index.
 * Target is entry index 4 if available, or the last entry if fewer than 4.
 *
 * @param log The AuditLog instance to tamper with.
 * @returns The 1-based index of the tampered entry, or null if log is empty.
 */
export function tamperDemo(log: AuditLog): number | null {
  const entries = log.getAll()
  if (entries.length === 0) return null

  // Save backup if not already saved
  if (!_backupEntries) {
    _backupEntries = [...entries]
  }

  return log._tamperForDemo()
}

/**
 * Restores the log from before tampering was applied, if a backup exists.
 * Otherwise resets the log.
 */
export function reset(log?: AuditLog): void {
  if (log && _backupEntries) {
    log._restoreEntries(_backupEntries)
  } else if (log) {
    log.reset()
  }
  _backupEntries = null
}
