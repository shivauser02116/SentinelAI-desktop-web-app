/**
 * Mock provider adapter — for offline demos and deterministic tests.
 *
 * Clearly labelled as simulated. Never represents real provider behavior.
 * Uses the same deterministic mock tools as the front-end offline demo.
 *
 * Call counts are per-instance and reset on construction.
 */
import type { ProviderAdapter, ToolResult, AdapterHealthStatus, ToolName } from './types.js'

// Deterministic refund counter (per-instance, resets on construction)
let _refundSeq = 7000

interface MockInvoice {
  id: string
  customerId: string
  total: number
  status: string
  lineItems: Array<{ name: string; amount: number }>
}

const MOCK_INVOICES: MockInvoice[] = [
  {
    id: 'INV-1042',
    customerId: 'C-204',
    total: 73000,
    status: 'Paid',
    lineItems: [
      { name: 'Platform licence', amount: 23000 },
      { name: 'Support add-on', amount: 25000 },
      { name: 'Support add-on (duplicate)', amount: 25000 },
    ],
  },
]

export class MockAdapter implements ProviderAdapter {
  readonly provider = 'mock'
  readonly capabilities = ['invoice_lookup', 'refund_issue', 'customer_export', 'payroll_export'] as const
  readonly isSandbox = true

  constructor() {
    // Each instance starts with a fresh refund counter
    _refundSeq = 7000
  }

  async execute(
    tool: ToolName,
    args: Record<string, unknown>,
    _idempotencyKey: string,
    _orgId: string,
  ): Promise<ToolResult> {
    // Simulate realistic async delay (5ms)
    await new Promise((r) => setTimeout(r, 5))

    switch (tool) {
      case 'invoice.lookup': {
        const invoiceId = args['invoice_id'] as string
        const invoice = MOCK_INVOICES.find((i) => i.id === invoiceId)
        if (!invoice) {
          return { ok: false, error: `Invoice ${invoiceId} not found. (simulated)` }
        }
        return {
          ok: true,
          data: {
            id: invoice.id,
            customerId: invoice.customerId,
            total: invoice.total,
            status: invoice.status,
            lineItems: invoice.lineItems,
            _simulated: true,
          },
        }
      }

      case 'refund.issue': {
        _refundSeq++
        const refundId = `R-${_refundSeq}`
        return {
          ok: true,
          data: {
            refund_id: refundId,
            invoice_id: args['invoice_id'],
            amount: args['amount'],
            currency: args['currency'] ?? 'INR',
            status: 'created',
            _simulated: true,
          },
          providerReceiptId: refundId,
        }
      }

      case 'customer.export': {
        return {
          ok: true,
          data: {
            records: 1240,
            fields: args['fields'],
            note: 'synthetic',
            _simulated: true,
          },
        }
      }

      case 'payroll.export': {
        return {
          ok: true,
          data: {
            rows: 86,
            period: args['period'],
            format: args['format'],
            note: 'synthetic',
            _simulated: true,
          },
        }
      }

      default: {
        const _exhaustive: never = tool
        return { ok: false, error: `Unknown tool: ${String(_exhaustive)}` }
      }
    }
  }

  async healthCheck(): Promise<AdapterHealthStatus> {
    return {
      connected: true,
      sandbox: true,
      lastChecked: new Date(),
    }
  }

  verifyWebhookSignature(_rawBody: string, _headers: Record<string, string>): boolean {
    // Mock adapter does not issue real webhooks
    return false
  }
}

/**
 * Disabled adapter scaffold — returned for any unconfigured provider.
 * All operations throw AdapterNotConnectedError.
 */
export class DisabledAdapter implements ProviderAdapter {
  readonly isSandbox = true
  constructor(
    readonly provider: string,
    readonly capabilities: ProviderAdapter['capabilities'],
  ) {}

  async execute(): Promise<ToolResult> {
    throw new Error(
      `Provider '${this.provider}' is not configured. Connect the integration before using real tools.`,
    )
  }

  async healthCheck(): Promise<AdapterHealthStatus> {
    return {
      connected: false,
      sandbox: true,
      lastChecked: new Date(),
      error: `Provider '${this.provider}' is not connected.`,
    }
  }

  verifyWebhookSignature(): boolean {
    return false
  }
}
