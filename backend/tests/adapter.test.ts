import { describe, it, expect } from 'vitest'
import { MockAdapter, DisabledAdapter } from '../src/adapters/mock.js'

describe('Provider Adapters', () => {
  describe('MockAdapter (Simulated)', () => {
    it('executes invoice.lookup returning synthetic invoice data with _simulated flag', async () => {
      const adapter = new MockAdapter()
      const result = await adapter.execute('invoice.lookup', { invoice_id: 'INV-1042' }, 'idemp-1', 'org-1')

      expect(result.ok).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.data?.['id']).toBe('INV-1042')
      expect(result.data?.['total']).toBe(73000)
      expect(result.data?.['_simulated']).toBe(true)
    })

    it('returns error for non-existent invoice', async () => {
      const adapter = new MockAdapter()
      const result = await adapter.execute('invoice.lookup', { invoice_id: 'INV-9999' }, 'idemp-2', 'org-1')

      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('executes refund.issue returning unique refund receipt IDs with _simulated flag', async () => {
      const adapter = new MockAdapter()
      const r1 = await adapter.execute('refund.issue', { invoice_id: 'INV-1042', amount: 1500 }, 'idemp-3', 'org-1')
      const r2 = await adapter.execute('refund.issue', { invoice_id: 'INV-1042', amount: 2000 }, 'idemp-4', 'org-1')

      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
      expect(r1.data?.['_simulated']).toBe(true)
      expect(r2.data?.['_simulated']).toBe(true)
      expect(r1.providerReceiptId).not.toBe(r2.providerReceiptId)
      expect(r1.providerReceiptId).toBe('R-7001')
      expect(r2.providerReceiptId).toBe('R-7002')
    })

    it('executes customer.export with synthetic count and _simulated flag', async () => {
      const adapter = new MockAdapter()
      const result = await adapter.execute('customer.export', { scope: 'all_customers', fields: ['name'] }, 'idemp-5', 'org-1')

      expect(result.ok).toBe(true)
      expect(result.data?.['records']).toBe(1240)
      expect(result.data?.['_simulated']).toBe(true)
    })

    it('healthCheck returns connected: true and sandbox: true', async () => {
      const adapter = new MockAdapter()
      const health = await adapter.healthCheck()

      expect(health.connected).toBe(true)
      expect(health.sandbox).toBe(true)
    })
  })

  describe('DisabledAdapter (Unconfigured)', () => {
    it('throws when execute is called on an unconfigured provider', async () => {
      const adapter = new DisabledAdapter('stripe', ['refund_issue'])

      await expect(
        adapter.execute(),
      ).rejects.toThrow("Provider 'stripe' is not configured. Connect the integration before using real tools.")
    })

    it('healthCheck reports disconnected for unconfigured provider', async () => {
      const adapter = new DisabledAdapter('zendesk', ['customer_export'])
      const health = await adapter.healthCheck()

      expect(health.connected).toBe(false)
      expect(health.error).toContain("Provider 'zendesk' is not connected")
    })
  })
})
