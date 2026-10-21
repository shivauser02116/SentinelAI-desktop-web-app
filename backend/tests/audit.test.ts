import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { canonicalJSON, GENESIS_HASH, ServerAuditLog } from '../src/audit/log.js'

describe('Server Audit Hash Chain and Canonical JSON', () => {
  it('canonicalJSON produces deterministic, whitespace-free output with sorted keys', () => {
    const objA = { z: 1, a: 'test', m: { b: 2, a: 1 } }
    const objB = { a: 'test', m: { a: 1, b: 2 }, z: 1 }

    const canonA = canonicalJSON(objA)
    const canonB = canonicalJSON(objB)

    expect(canonA).toBe(canonB)
    expect(canonA).toBe('{"a":"test","m":{"a":1,"b":2},"z":1}')
    expect(canonA).not.toContain(' ')
    expect(canonA).not.toContain('\n')
  })

  it('canonicalJSON preserves array element ordering without sorting array items', () => {
    const array = ['banana', 'apple', 'cherry']
    const canon = canonicalJSON(array)
    expect(canon).toBe('["banana","apple","cherry"]')
  })

  it('canonicalJSON handles null values correctly', () => {
    expect(canonicalJSON(null)).toBe('null')
    expect(canonicalJSON({ a: null })).toBe('{"a":null}')
  })

  it('genesis hash is exactly 64 zeros', () => {
    expect(GENESIS_HASH).toHaveLength(64)
    expect(GENESIS_HASH).toBe('0'.repeat(64))
  })

  it('verifies a valid hash chain correctly', async () => {
    const sha256 = (str: string) => createHash('sha256').update(str).digest('hex')

    // Simulate 3 chained entries
    let prevHash = GENESIS_HASH
    const entries: Array<{ orgSeq: bigint; prevHash: string; hash: string; [k: string]: unknown }> = []

    for (let seq = 1n; seq <= 3n; seq++) {
      const data = {
        orgSeq: seq,
        orgId: 'org-test',
        actorName: 'Rohan Joshi',
        tool: 'invoice.lookup',
        decision: 'allowed',
        prevHash,
      }
      const hash = sha256(prevHash + canonicalJSON(data))
      entries.push({ ...data, hash })
      prevHash = hash
    }

    // Mock SQL returning the entries
    const mockSql = (async () => entries) as any
    const auditLog = new ServerAuditLog(mockSql)

    const verification = await auditLog.verifyChain('org-test')
    expect(verification.ok).toBe(true)
    expect(verification.brokenAtSeq).toBeNull()
  })

  it('detects tampering when an entry in the chain is modified', async () => {
    const sha256 = (str: string) => createHash('sha256').update(str).digest('hex')

    let prevHash = GENESIS_HASH
    const entries: Array<{ orgSeq: bigint; prevHash: string; hash: string; [k: string]: unknown }> = []

    for (let seq = 1n; seq <= 4n; seq++) {
      const data = {
        orgSeq: seq,
        orgId: 'org-test',
        actorName: 'Rohan Joshi',
        tool: 'invoice.lookup',
        decision: 'allowed',
        prevHash,
      }
      const hash = sha256(prevHash + canonicalJSON(data))
      entries.push({ ...data, hash })
      prevHash = hash
    }

    // Tamper with entry #2 (change decision from 'allowed' to 'blocked')
    const tamperedEntry = entries[1]!
    tamperedEntry['decision'] = 'blocked'

    const mockSql = (async () => entries) as any
    const auditLog = new ServerAuditLog(mockSql)

    const verification = await auditLog.verifyChain('org-test')
    expect(verification.ok).toBe(false)
    expect(verification.brokenAtSeq).toBe(2n)
  })
})
