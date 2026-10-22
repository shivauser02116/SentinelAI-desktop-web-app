export type Role = 'Support Agent' | 'Support Lead' | 'Ops Manager' | 'Finance Admin'
export type ToolName = 'invoice.lookup' | 'refund.issue' | 'customer.export' | 'payroll.export'
export type Decision = 'allowed' | 'needs_approval' | 'blocked'
export type CheckStatus = 'passed' | 'failed' | 'not_evaluated'
export type EventStatus = 'evaluating' | 'allowed' | 'pending' | 'approved' | 'denied' | 'blocked'
export type ArgValue = string | number | string[]

export interface User {
  id: string
  name: string
  role: Role
  initials: string
}

export interface Check {
  name: string
  status: CheckStatus
  text: string
}

export interface CallSource {
  kind: 'request' | 'untrusted'
  label: string
  text: string
  injected?: string
}

export interface ProposedCall {
  tool: ToolName
  args: Record<string, ArgValue>
  summary: string
  source: CallSource
}

export interface TaskGrant {
  taskId: string
  title: string
  requestedBy: User
  customer: string
  tools: ToolName[]
  resource: string
  expires: string
  timeLeft: string
}

export interface Scenario {
  id: string
  number: number
  title: string
  expected: Decision
  time: string
  taskId: string
  taskTitle: string
  user: User
  reviewer?: User
  request: string
  agentLine: string
  call: ProposedCall
  decision: Decision
  rule: string
  reason: string
  checks: Check[]
  outcome?: string
  pendingText?: string
  approvedText?: string
  deniedText?: string
  approvalSentence?: string
  resolvedTime?: string
  grant?: { userId: string; allowTools: ToolName[]; allowResources: string[]; resourceLabel?: string }
}

export interface ActionEvent {
  id: string
  scenarioId: string
  scenarioNumber: number
  time: string
  requestedBy: User
  taskId: string
  call: ProposedCall
  decision: Decision
  rule: string
  reason: string
  checks: Check[]
  status: EventStatus
  outcome: string | null
  approvalId?: string
  agentMode?: 'simulated' | 'live'
}

export interface ApprovalRequest {
  id: string
  eventId: string
  scenarioId: string
  title: string
  requester: User
  reviewer: User
  taskId: string
  tool: ToolName
  args: Record<string, ArgValue>
  reason: string
  requestedAt: string
  status: 'pending' | 'approved' | 'denied'
  note: string | null
  outcome: string | null
}

export interface AuditEntry {
  seq: number
  date: string
  time: string
  requestedBy: string
  role: Role
  taskId: string
  tool: ToolName
  args: Record<string, ArgValue>
  decision: Decision
  rule: string
  reason: string
  reviewer: string | null
  result: string
  hash: string
  prevHash: string
  eventId: string
}

export interface ChainStatus {
  ok: boolean
  brokenAt: number | null
  count: number
}

export interface Toast {
  id: number
  message: string
  linkLabel?: string
  href?: string
}

export interface Activity {
  scenarioId: string
  stage: 1 | 2
}

export interface LiveActivity {
  request: string
  untrusted?: {
    kind: string
    label: string
    text?: string
    injected?: string
  }
  agentLines: string[]
}

export type Access = 'yes' | 'approval' | 'no'
export interface PolicyRole {
  role: Role
  person: string
  note?: string
  access: Record<ToolName, Access>
}
export interface PolicySettings {
  tools: ToolName[]
  roles: PolicyRole[]
  limits: string[]
  reviewers: string[]
  grantExample: string
}

export type {
  Alert,
  AlertSeverity,
  AlertState,
  InterventionsSummary,
} from './gateway/alerts'

export interface SessionState {
  currentTask: TaskGrant | null
  currentUser: User
  events: ActionEvent[]
  approvals: ApprovalRequest[]
  auditEntries: AuditEntry[]
  chainStatus: ChainStatus
  scenarios: Scenario[]
  policy: PolicySettings
  runningId: string | null
  doneIds: string[]
  selectedEventId: string | null
  activity: Activity | null
  toast: Toast | null
  liveMessage: string
  pendingCount: number
  alerts: import('./gateway/alerts').Alert[]
  interventions: import('./gateway/alerts').InterventionsSummary
  mode: 'simulated' | 'live'
  liveReady: boolean
  liveError: string | null
  liveActivity: LiveActivity | null
  runScenario: (id: string) => void
  resolveApproval: (id: string, action: 'approve' | 'deny', note: string) => boolean
  verifyChain: () => void
  tamperDemo: () => void
  reset: () => void
  selectEvent: (id: string | null) => void
  dismissToast: () => void
  requestLiveMode: () => void
  setMode: (mode: 'simulated' | 'live') => void
  setLiveConfig: (config: { apiKey: string; model?: string }) => void
  clearLiveConfig: () => void
  runLive: (input: string) => Promise<void>
}
