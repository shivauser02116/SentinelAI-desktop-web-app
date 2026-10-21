// Mock in-memory database — all data is synthetic

import type { GatewayUser, Role } from './types'

export interface Invoice {
  id: string
  customerId: string
  total: number
  status: string
  lineItems: Array<{ name: string; amount: number }>
}

export interface Customer {
  id: string
  name: string
}

export const MOCK_USERS: GatewayUser[] = [
  { id: 'u-rohan', name: 'Rohan Mehta', role: 'Support Agent' },
  { id: 'u-priya', name: 'Priya Nair', role: 'Support Lead' },
  { id: 'u-dev', name: 'Dev Malhotra', role: 'Ops Manager' },
  { id: 'u-anita', name: 'Anita Rao', role: 'Finance Admin' },
]

export function getUser(id: string): GatewayUser | undefined {
  return MOCK_USERS.find((u) => u.id === id)
}

const INVOICES: Invoice[] = [
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

const CUSTOMERS: Customer[] = [{ id: 'C-204', name: 'Meridian Textiles Pvt Ltd (synthetic)' }]

// Counters — reset on reset()
let _refundSeq = 7000

export function getInvoice(id: string): Invoice | undefined {
  return INVOICES.find((inv) => inv.id === id)
}

export function getCustomer(id: string): Customer | undefined {
  return CUSTOMERS.find((c) => c.id === id)
}

export function getCustomerForInvoice(invoiceId: string): string | undefined {
  return INVOICES.find((inv) => inv.id === invoiceId)?.customerId
}

export function nextRefundId(): string {
  _refundSeq++
  return `R-${_refundSeq}`
}

export function getCustomerExportCount(): number {
  return 1240
}

export function getPayrollExportRows(): number {
  return 86
}

export function resetCounters(): void {
  _refundSeq = 7000
}

export function getUserByRole(role: Role): GatewayUser | undefined {
  return MOCK_USERS.find((u) => u.role === role)
}
