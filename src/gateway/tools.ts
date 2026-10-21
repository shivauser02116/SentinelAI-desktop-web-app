/**
 * Mock tool implementations.
 *
 * IMPORTANT: This module must NOT be imported by anything under
 * src/components, src/screens, or src/state. Tools are only reachable
 * via the gateway (src/gateway/gateway.ts). The architecture guard test
 * enforces this constraint.
 */
import type { ToolName, ToolExecutionResult } from './types'
import { getInvoice, nextRefundId, getCustomerExportCount, getPayrollExportRows } from './mockDb'

type ToolFn = (args: Record<string, unknown>) => ToolExecutionResult

interface ToolRegistry {
  call(tool: ToolName, args: Record<string, unknown>): ToolExecutionResult
  getCallCount(tool: ToolName): number
  resetCounts(): void
}

function lookupInvoice(args: Record<string, unknown>): ToolExecutionResult {
  const invoiceId = args['invoice_id'] as string
  const invoice = getInvoice(invoiceId)
  if (!invoice) {
    return { ok: false, error: `Invoice ${invoiceId} not found.` }
  }
  return {
    ok: true,
    data: {
      id: invoice.id,
      customerId: invoice.customerId,
      total: invoice.total,
      status: invoice.status,
      lineItems: invoice.lineItems,
    },
  }
}

function issueRefund(args: Record<string, unknown>): ToolExecutionResult {
  const invoiceId = args['invoice_id'] as string
  const amount = args['amount'] as number
  const currency = (args['currency'] as string) ?? 'INR'
  const refundId = nextRefundId()
  return {
    ok: true,
    data: {
      refund_id: refundId,
      invoice_id: invoiceId,
      amount,
      currency,
      status: 'created',
    },
  }
}

function exportCustomers(args: Record<string, unknown>): ToolExecutionResult {
  const fields = args['fields'] as string[]
  return {
    ok: true,
    data: {
      records: getCustomerExportCount(),
      fields,
      note: 'synthetic',
    },
  }
}

function exportPayroll(args: Record<string, unknown>): ToolExecutionResult {
  const period = args['period'] as string
  const format = args['format'] as string
  return {
    ok: true,
    data: {
      rows: getPayrollExportRows(),
      period,
      format,
      note: 'synthetic',
    },
  }
}

const TOOL_FNS: Record<ToolName, ToolFn> = {
  'invoice.lookup': lookupInvoice,
  'refund.issue': issueRefund,
  'customer.export': exportCustomers,
  'payroll.export': exportPayroll,
}

export function createToolRegistry(): ToolRegistry {
  const counts: Record<ToolName, number> = {
    'invoice.lookup': 0,
    'refund.issue': 0,
    'customer.export': 0,
    'payroll.export': 0,
  }

  return {
    call(tool, args) {
      counts[tool]++
      return TOOL_FNS[tool](args)
    },
    getCallCount(tool) {
      return counts[tool]
    },
    resetCounts() {
      for (const key of Object.keys(counts) as ToolName[]) {
        counts[key] = 0
      }
    },
  }
}
