/**
 * Provider adapter interface.
 *
 * Every business-tool integration implements this contract.
 * The gateway calls adapters; adapters never call back into the gateway.
 *
 * Security invariants:
 * - Credentials are fetched from the server-side credentials table, never from the browser.
 * - Tool execution results are sanitized before being stored or returned to clients.
 * - Sandbox mode must be enforced by the adapter; the gateway does not distinguish real vs sandbox.
 * - Adapters must be idempotent: retrying with the same idempotency key must not duplicate side effects.
 */

export type ToolName = 'invoice.lookup' | 'refund.issue' | 'customer.export' | 'payroll.export'

export interface ToolArgs {
  'invoice.lookup': { invoice_id: string; customer_id?: string }
  'refund.issue': { invoice_id: string; amount: number; currency: string; reason?: string }
  'customer.export': { scope: string; fields: string[] }
  'payroll.export': { period: string; format: string; destination?: string }
}

export interface ToolResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
  providerReceiptId?: string
}

export type ProviderCapability = 'invoice_lookup' | 'refund_issue' | 'customer_export' | 'payroll_export'

export interface AdapterHealthStatus {
  connected: boolean
  sandbox: boolean
  lastChecked: Date
  error?: string
}

export interface ProviderAdapter {
  /** Unique identifier for this provider (e.g., 'stripe', 'zendesk', 'mock'). */
  readonly provider: string

  /** Which tool calls this adapter can handle. */
  readonly capabilities: readonly ProviderCapability[]

  /** Is this adapter in sandbox/test mode? Real adapters must verify this. */
  readonly isSandbox: boolean

  /**
   * Execute a tool call with an idempotency key.
   * The idempotency key ensures retrying with the same key returns the original result
   * without duplicating side effects (e.g., double-issuing a refund).
   *
   * If the provider request times out and the outcome cannot be confirmed,
   * throw ProviderTimeoutError rather than returning a success or failure.
   * The gateway will record execution_unknown status for reconciliation.
   */
  execute(
    tool: ToolName,
    args: Record<string, unknown>,
    idempotencyKey: string,
    orgId: string,
  ): Promise<ToolResult>

  /** Health check — verify the adapter can reach the provider. */
  healthCheck(): Promise<AdapterHealthStatus>

  /** Verify a provider webhook signature. Returns true if valid. */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
  ): boolean
}

/** Thrown when a provider request times out and its outcome is unknown. */
export class ProviderTimeoutError extends Error {
  readonly providerReceiptId?: string
  constructor(message: string, providerReceiptId?: string) {
    super(message)
    this.name = 'ProviderTimeoutError'
    if (providerReceiptId !== undefined) {
      this.providerReceiptId = providerReceiptId
    }
  }
}

/** Thrown when the adapter is not connected or not configured. */
export class AdapterNotConnectedError extends Error {
  constructor(provider: string) {
    super(`Provider adapter '${provider}' is not connected. Configure the integration first.`)
    this.name = 'AdapterNotConnectedError'
  }
}
