import type { PolicySettings } from '../types'

export const POLICY: PolicySettings = {
  tools: ['invoice.lookup', 'refund.issue', 'customer.export', 'payroll.export'],
  roles: [
    {
      role: 'Support Agent',
      person: 'Rohan Mehta',
      note: 'approval above ₹2,000',
      access: { 'invoice.lookup': 'yes', 'refund.issue': 'approval', 'customer.export': 'no', 'payroll.export': 'no' },
    },
    {
      role: 'Support Lead',
      person: 'Priya Nair',
      note: 'approval above ₹2,000',
      access: { 'invoice.lookup': 'yes', 'refund.issue': 'approval', 'customer.export': 'yes', 'payroll.export': 'no' },
    },
    {
      role: 'Finance Admin',
      person: 'Anita Rao',
      access: { 'invoice.lookup': 'no', 'refund.issue': 'no', 'customer.export': 'no', 'payroll.export': 'yes' },
    },
    {
      role: 'Ops Manager',
      person: 'Dev Malhotra · reviewer only',
      access: { 'invoice.lookup': 'no', 'refund.issue': 'no', 'customer.export': 'no', 'payroll.export': 'no' },
    },
  ],
  limits: ['Refund without approval: up to ₹2,000', 'Refund can never exceed the invoice total'],
  reviewers: [
    'Support Agent requests → Support Lead',
    'Support Lead requests → Ops Manager',
    'Nobody approves their own request',
  ],
  grantExample: `task:             TASK-1002 "Resolve duplicate charge on INV-1042"
user:             u-rohan (Support Agent)
allow_tools:      [invoice.lookup, refund.issue]
allow_resources:  [customer:C-204]
limits:           refund.issue <= invoice total; approval above ₹2,000
expires:          when the task closes or after 15 min`,
}
