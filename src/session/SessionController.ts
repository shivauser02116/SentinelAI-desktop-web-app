/**
 * SessionController — single source of truth for all session state.
 *
 * Wraps the Gateway, SimulatedAgent, and AuditLog. Notifies React via
 * a subscribe() pattern. All UI timing is driven by setTimeout so React
 * never blocks on async work.
 */
import { Gateway, getRequiredReviewerRole } from '../gateway/gateway'
import { issueGrant } from '../gateway/grants'
import { getUserByRole, getUser } from '../gateway/mockDb'
import { verifyChain as gwVerifyChain, type GatewayAuditEntry } from '../gateway/audit'
import { tamperDemo as doTamper, reset as resetTamper } from '../demo/tamper'
import { SimulatedAgent } from '../agent/simulatedAgent'
import { SCENARIOS, USERS, RECORDS, DEMO_DATE, GRANT_EXPIRES } from '../data/scenarios'
import { deriveAlerts, summarizeInterventions, type Alert, type InterventionsSummary } from '../gateway/alerts'
import type {
  User,
  TaskGrant,
  ActionEvent,
  ApprovalRequest,
  AuditEntry,
  Activity,
  Toast,
  ArgValue,
  ToolName,
  Check,
} from '../types'
import type { ToolCall, EvalContext, Role } from '../gateway/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CallContext {
  id: string
  number: number
  time: string
  user: User
  taskId: string
  taskTitle?: string
  call: {
    tool: ToolName
    args: Record<string, unknown>
    summary: string
    source: {
      kind: 'request' | 'untrusted'
      label: string
      text?: string
      injected?: string
    }
  }
  decision?: 'allowed' | 'needs_approval' | 'blocked'
  rule?: string
  reason?: string
  checks?: Check[]
  approvalSentence?: string
  resolvedTime?: string
  grant?: {
    userId?: string
    allowTools?: ToolName[]
    allowResources?: string[]
    resourceLabel?: string
  }
}

interface ControllerSnapshot {
  currentTask: TaskGrant | null
  currentUser: User
  events: ActionEvent[]
  approvals: ApprovalRequest[]
  auditEntries: AuditEntry[]
  chainOk: boolean
  chainBrokenAt: number | null
  runningId: string | null
  doneIds: string[]
  selectedEventId: string | null
  activity: Activity | null
  toast: Toast | null
  liveMessage: string
  alerts: Alert[]
  interventions: InterventionsSummary
}

type SubscriberFn = (snap: ControllerSnapshot) => void

// ── Options (allow test overrides) ────────────────────────────────────────────

export interface ControllerOptions {
  /**
   * [agentMsg, agentCall, evaluating, decision, finalize]
   * Default: [600, 600, 600, 600, 400] which reproduces the 0/600/1200/1800/2200 timing.
   * Tests pass [0, 0, 0, 0, 0] to run synchronously.
   */
  delays?: [number, number, number, number, number]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHECK_NAMES: Record<string, string> = {
  role_access: 'Role access',
  task_scope: 'Task scope',
  arg_limits: 'Argument limits',
  input_source: 'Input source',
}

function formatTimeLeft(expiresAt: Date): string {
  const diffMs = Math.max(0, expiresAt.getTime() - Date.now())
  const totalSec = Math.floor(diffMs / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} left`
}

export function grantFor(sc: { id?: string; taskId: string; grant?: { userId: string; allowTools: ToolName[]; allowResources: string[]; resourceLabel?: string } }) {
  if (sc.grant) {
    return issueGrant({
      taskId: sc.taskId,
      userId: sc.grant.userId,
      allowTools: sc.grant.allowTools,
      allowResources: sc.grant.allowResources,
    })
  }
  const userId = sc.id === 's5' ? 'u-priya' : 'u-rohan'
  return issueGrant({
    taskId: sc.taskId,
    userId,
    allowTools: ['invoice.lookup', 'refund.issue'],
    allowResources: ['C-204'],
  })
}

let _toastSeq = 0

// ── Controller ────────────────────────────────────────────────────────────────

export class SessionController {
  private readonly _gw = new Gateway()
  private readonly _agent: SimulatedAgent
  private readonly _delays: [number, number, number, number, number]
  private readonly _subscribers = new Set<SubscriberFn>()
  private _previousAlertIds = new Set<string>()

  private _recomputeAlerts(suppressHighToast = false): {
    alerts: Alert[]
    interventions: InterventionsSummary
  } {
    const entries = this._gw.audit.getAll()
    const approvals = this._gw.getApprovals()
    const alerts = deriveAlerts({
      entries,
      approvals,
      chain: { ok: this._snap.chainOk, brokenAt: this._snap.chainBrokenAt },
    })
    const interventions = summarizeInterventions(entries)

    if (!suppressHighToast) {
      const newHigh = alerts.find(
        (a) => a.severity === 'high' && !this._previousAlertIds.has(a.id),
      )
      if (newHigh) {
        this._showToast({
          message: `Alert: ${newHigh.title}`,
          linkLabel: 'View',
          href: '#/alerts',
        })
        this._snap.liveMessage = `Alert: ${newHigh.title}`
      }
    }

    this._previousAlertIds = new Set(alerts.map((a) => a.id))
    return { alerts, interventions }
  }

  private _snap: ControllerSnapshot = {
    currentTask: null,
    currentUser: USERS.rohan,
    events: [],
    approvals: [],
    auditEntries: [],
    chainOk: true,
    chainBrokenAt: null,
    runningId: null,
    doneIds: [],
    selectedEventId: null,
    activity: null,
    toast: null,
    liveMessage: '',
    alerts: [],
    interventions: { blocked: 0, held: 0, approved: 0, denied: 0 },
  }

  // Internal tracking maps for approval resolution
  private _approvalToCallContext = new Map<string, CallContext>() // approvalId → callCtx
  private _currentGrant: ReturnType<typeof issueGrant> | null = null
  private _countdownInterval: ReturnType<typeof setInterval> | null = null
  private _toastTimeout: ReturnType<typeof setTimeout> | null = null
  private _timers: ReturnType<typeof setTimeout>[] = []
  private _eventSeq = 0

  constructor(opts?: ControllerOptions) {
    this._delays = opts?.delays ?? [600, 600, 600, 600, 400]
    this._agent = new SimulatedAgent([0, 0]) // agent delays are handled by controller
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getSnapshot(): ControllerSnapshot {
    return this._snap
  }

  subscribe(fn: SubscriberFn): () => void {
    this._subscribers.add(fn)
    return () => this._subscribers.delete(fn)
  }

  selectEvent(id: string | null): void {
    this._patch({ selectedEventId: id })
  }

  dismissToast(): void {
    this._patch({ toast: null })
  }

  requestLiveMode(): void {
    this._showToast({ message: "Live LLM mode isn't configured" })
  }

  // ── runScenario (fire-and-forget from React) ───────────────────────────────

  runScenario(id: string): void {
    const sc = SCENARIOS.find((s) => s.id === id)
    if (!sc || this._snap.runningId) return
    this._runScenarioInternal(sc)
  }

  /**
   * Awaitable version for tests — skips setTimeout, runs all steps sequentially.
   */
  async runScenarioSync(id: string): Promise<void> {
    const sc = SCENARIOS.find((s) => s.id === id)
    if (!sc) return

    // Issue grant
    const gwGrant = grantFor(sc)
    this._currentGrant = gwGrant

    // Build UI task grant
    const uiGrant = this._buildUIGrant(sc, gwGrant)

    // Set initial state
    const eventId = `EVT-${String(++this._eventSeq).padStart(3, '0')}`
    const gwUser = getUser(gwGrant.userId)!
    this._patch({
      currentUser: sc.user,
      currentTask: uiGrant,
      activity: { scenarioId: id, stage: 1 },
      runningId: id,
    })

    // Stage 2 — agent message received
    this._patch({ activity: { scenarioId: id, stage: 2 } })

    // Stage 3 — evaluating
    const evaluatingEvent: ActionEvent = {
      id: eventId,
      scenarioId: id,
      scenarioNumber: sc.number,
      time: sc.time,
      requestedBy: sc.user,
      taskId: sc.taskId,
      call: sc.call,
      decision: sc.decision,
      rule: sc.rule,
      reason: sc.reason,
      checks: sc.checks,
      status: 'evaluating',
      outcome: null,
    }
    this._patch({ events: [...this._snap.events, evaluatingEvent] })

    // Run gateway submit & status update & finalize via _processCall
    await this._processCall(sc, eventId, gwGrant, gwUser, 'simulated')
  }

  // ── resolveApproval ────────────────────────────────────────────────────────

  resolveApproval(id: string, action: 'approve' | 'deny', note: string): boolean {
    const ap = this._snap.approvals.find((a) => a.id === id)
    const cleanNote = note.trim()
    if (!ap || ap.status !== 'pending') return false
    if (action === 'deny' && !cleanNote) return false

    // fire async internally
    void this._resolveApprovalAsync(id, action, cleanNote, ap)
    return true
  }

  private async _resolveApprovalAsync(
    id: string,
    action: 'approve' | 'deny',
    cleanNote: string,
    ap: ApprovalRequest,
  ): Promise<void> {
    const callCtx = this._approvalToCallContext.get(id)
    if (!callCtx) return

    const gwReviewer = getUser(ap.reviewer.id)
    if (!gwReviewer) return

    const resolveResult = await this._gw.resolveApproval({
      approvalId: id,
      reviewer: gwReviewer,
      outcome: action === 'approve' ? 'approve' : 'deny',
      note: cleanNote,
    })
    if (!resolveResult.ok) return

    const approve = action === 'approve'
    const outcome = this._buildResolvedOutcome(callCtx, action, cleanNote, ap, resolveResult)

    // Map audit entry
    const auditEntries = this._snap.auditEntries
    if (resolveResult.auditEntry) {
      const uiEntry = this._mapAuditEntry(
        resolveResult.auditEntry,
        callCtx,
        action,
        cleanNote,
        ap.reviewer,
      )
      this._patch({ auditEntries: [...auditEntries, uiEntry] })
    }

    // Update approval
    const approvals = this._snap.approvals.map((a) =>
      a.id === id
        ? { ...a, status: (approve ? 'approved' : 'denied') as 'approved' | 'denied', note: cleanNote || null, outcome }
        : a,
    )

    // Update event
    const events = this._snap.events.map((e) =>
      e.id === ap.eventId
        ? { ...e, status: (approve ? 'approved' : 'denied') as ActionEvent['status'], outcome }
        : e,
    )

    const liveMessage = approve
      ? `Request approved: ${ap.tool} was executed.`
      : `Request denied: ${ap.tool} was not executed.`

    const { alerts, interventions } = this._recomputeAlerts()
    this._patch({ approvals, events, liveMessage, selectedEventId: ap.eventId, alerts, interventions })
  }

  // ── verifyChain ────────────────────────────────────────────────────────────

  verifyChain(): void {
    void this._verifyChainAsync()
  }

  private async _verifyChainAsync(): Promise<void> {
    const entries = this._gw.audit.getAll()
    const result = await gwVerifyChain(entries)
    this._snap.chainOk = result.ok
    this._snap.chainBrokenAt = result.brokenAt
    const { alerts, interventions } = this._recomputeAlerts()
    this._patch({ chainOk: result.ok, chainBrokenAt: result.brokenAt, alerts, interventions })
  }

  // ── tamperDemo ─────────────────────────────────────────────────────────────

  tamperDemo(): void {
    doTamper(this._gw.audit)
    // Update UI entries to show the tampered text
    const gwEntries = this._gw.audit.getAll()
    const uiEntries = this._snap.auditEntries.map((uiE) => {
      const gwe = gwEntries.find((g) => g.index === uiE.seq)
      if (!gwe) return uiE
      return { ...uiE, hash: gwe.hash.substring(0, 8), reason: gwe.reason }
    })
    void gwVerifyChain(gwEntries).then((result) => {
      this._snap.chainOk = result.ok
      this._snap.chainBrokenAt = result.brokenAt
      const { alerts, interventions } = this._recomputeAlerts()
      this._patch({
        auditEntries: uiEntries,
        chainOk: result.ok,
        chainBrokenAt: result.brokenAt,
        alerts,
        interventions,
      })
    })
  }

  // ── reset ──────────────────────────────────────────────────────────────────

  reset(): void {
    this._clearTimers()
    this._clearCountdown()
    this._gw.reset()
    resetTamper(this._gw.audit)
    this._eventSeq = 0
    this._approvalToCallContext.clear()
    this._previousAlertIds.clear()
    this._currentGrant = null
    this._snap = {
      currentTask: null,
      currentUser: USERS.rohan,
      events: [],
      approvals: [],
      auditEntries: [],
      chainOk: true,
      chainBrokenAt: null,
      runningId: null,
      doneIds: [],
      selectedEventId: null,
      activity: null,
      toast: null,
      liveMessage: '',
      alerts: [],
      interventions: { blocked: 0, held: 0, approved: 0, denied: 0 },
    }
    this._notify()
  }

  private _scheduleTimeout(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this._timers = this._timers.filter((timer) => timer !== t)
      fn()
    }, ms)
    this._timers.push(t)
  }

  private _clearTimers(): void {
    for (const t of this._timers) {
      clearTimeout(t)
    }
    this._timers = []
    if (this._toastTimeout != null) {
      clearTimeout(this._toastTimeout)
      this._toastTimeout = null
    }
  }

  // ── Internal: runScenario with setTimeout ──────────────────────────────────

  private _runScenarioInternal(sc: (typeof SCENARIOS)[0]): void {
    const id = sc.id
    const [d0, d1, d2, d3] = this._delays

    // Issue grant
    const gwGrant = grantFor(sc)
    this._currentGrant = gwGrant

    // Build UI task grant immediately (with live countdown)
    const uiGrant = this._buildUIGrant(sc, gwGrant)
    this._clearCountdown()
    this._startCountdown(gwGrant.expiresAt, uiGrant)

    const gwUser = getUser(gwGrant.userId)!

    // t=0: set user, task, activity stage 1, mark running
    const eventId = `EVT-${String(++this._eventSeq).padStart(3, '0')}`
    this._patch({
      currentUser: sc.user,
      currentTask: uiGrant,
      activity: { scenarioId: id, stage: 1 },
      runningId: id,
    })

    // Start agent (fire-and-forget — it emits events at 0ms and 0ms)
    void this._agent.run(sc.id, sc.request, (ev) => {
      if (ev.kind === 'agent_message') {
        // handled by t=d0 timer
      }
    })

    // t=d0: activity stage 2
    this._scheduleTimeout(() => {
      this._patch({ activity: { scenarioId: id, stage: 2 } })
    }, d0)

    // t=d0+d1: add evaluating event
    this._scheduleTimeout(() => {
      const evaluatingEvent: ActionEvent = {
        id: eventId,
        scenarioId: id,
        scenarioNumber: sc.number,
        time: sc.time,
        requestedBy: sc.user,
        taskId: sc.taskId,
        call: sc.call,
        decision: sc.decision,
        rule: sc.rule,
        reason: sc.reason,
        checks: sc.checks,
        status: 'evaluating',
        outcome: null,
      }
      this._patch({ events: [...this._snap.events, evaluatingEvent] })

      // Run gateway submit & status update & finalize via _processCall
      void this._processCall(sc, eventId, gwGrant, gwUser, 'simulated', { dStatus: d2, dFinalize: d3 })
    }, d0 + d1)
  }

  // ── Internal: processCall ──────────────────────────────────────────────────

  private async _processCall(
    callCtx: CallContext,
    eventId: string,
    grant: ReturnType<typeof issueGrant>,
    gwUser: ReturnType<typeof getUser>,
    agentMode: 'simulated' | 'live',
    delays?: { dStatus: number; dFinalize: number },
  ): Promise<Awaited<ReturnType<Gateway['submit']>>> {
    const toolCall: ToolCall = {
      tool: callCtx.call.tool,
      args: callCtx.call.args as Record<string, unknown>,
      provenance: {
        label: callCtx.call.source.label,
        untrusted: callCtx.call.source.kind === 'untrusted',
      },
    }
    const evalCtx: EvalContext = {
      user: { id: gwUser!.id, name: gwUser!.name, role: gwUser!.role },
      grant,
      agentMode,
    }
    const result = await this._gw.submit(toolCall, evalCtx, { eventId })

    const updateStatus = () => {
      const eventStatus = this._decisionToEventStatus(result.decision)
      this._patch({
        events: this._snap.events.map((e) =>
          e.id === eventId ? { ...e, status: eventStatus } : e
        ),
      })
    }

    if (delays && (delays.dStatus > 0 || delays.dFinalize > 0)) {
      this._scheduleTimeout(() => {
        updateStatus()
        this._scheduleTimeout(() => {
          void this._finalize(callCtx, eventId, result, grant)
        }, delays.dFinalize)
      }, delays.dStatus)
    } else {
      updateStatus()
      await this._finalize(callCtx, eventId, result, grant)
    }

    return result
  }

  // ── Internal: finalize ─────────────────────────────────────────────────────

  private async _finalize(
    callCtx: CallContext,
    eventId: string,
    result: Awaited<ReturnType<Gateway['submit']>>,
    gwGrant: ReturnType<typeof issueGrant>,
  ): Promise<void> {
    const decision = result.decision

    let outcome: string | null = null
    let approvalId: string | undefined

    if (decision === 'needs_approval') {
      approvalId = result.approvalId

      // Build pending outcome text
      const requiredReviewerRole = getRequiredReviewerRole(callCtx.user.role as Role) ?? 'Ops Manager'
      const reviewerGwUser = getUserByRole(requiredReviewerRole as Role)
      outcome = reviewerGwUser
        ? `Waiting for approval from ${reviewerGwUser.name} (${reviewerGwUser.role}).`
        : 'Waiting for approval.'

      // Build UI approval request
      const uiReviewer = this._gwRoleToUIUser(requiredReviewerRole as Role)

      const uiApproval: ApprovalRequest = {
        id: approvalId!,
        eventId,
        scenarioId: callCtx.id,
        title: callCtx.approvalSentence ?? callCtx.call.summary,
        requester: callCtx.user,
        reviewer: uiReviewer,
        taskId: callCtx.taskId,
        tool: callCtx.call.tool,
        args: callCtx.call.args as Record<string, ArgValue>,
        reason: callCtx.reason ?? result.reason,
        requestedAt: callCtx.time,
        status: 'pending',
        note: null,
        outcome,
      }

      this._approvalToCallContext.set(approvalId!, callCtx)

      const approvals = [...this._snap.approvals, uiApproval]
      this._patch({ approvals })

      this._showToast({
        message: 'Approval requested',
        linkLabel: 'Review',
        href: `#/approvals/${approvalId}`,
      })
    } else {
      outcome = this._buildOutcome(callCtx, result)
    }

    const uiChecks: Check[] = result.checks.map((c) => ({
      name: CHECK_NAMES[c.id] || c.id,
      status: c.status,
      text: c.note,
    }))

    // Update events with outcome and evaluated checks
    const events = this._snap.events.map((e) =>
      e.id === eventId
        ? {
            ...e,
            decision: result.decision,
            rule: result.ruleId,
            reason: result.reason,
            outcome,
            approvalId,
            checks: uiChecks,
          }
        : e
    )

    // Map audit entry to UI
    const auditEntries = this._snap.auditEntries
    let newAuditEntries = auditEntries
    if (result.auditEntry) {
      const uiEntry = this._mapAuditEntry(result.auditEntry, callCtx, undefined, undefined, undefined)
      newAuditEntries = [...auditEntries, uiEntry]
    }

    const tool = callCtx.call.tool
    const liveMessage =
      decision === 'allowed'
        ? `Action allowed: ${tool}.`
        : decision === 'blocked'
          ? `Action blocked: ${tool}. The tool was not called.`
          : `Approval needed: ${tool}. Waiting for review.`

    const { alerts, interventions } = this._recomputeAlerts(decision === 'needs_approval')

    this._patch({
      events,
      auditEntries: newAuditEntries,
      selectedEventId: eventId,
      doneIds: this._snap.doneIds.includes(callCtx.id)
        ? this._snap.doneIds
        : [...this._snap.doneIds, callCtx.id],
      runningId: null,
      liveMessage,
      alerts,
      interventions,
    })
  }

  // ── Internal: build UI types ───────────────────────────────────────────────

  private _buildUIGrant(
    sc: (typeof SCENARIOS)[0],
    gwGrant: ReturnType<typeof issueGrant>,
  ): TaskGrant {
    return {
      taskId: sc.taskId,
      title: sc.taskTitle,
      requestedBy: sc.user,
      customer: sc.grant?.resourceLabel ? '' : `${RECORDS.customer.id} · ${RECORDS.customer.name}`,
      tools: [...gwGrant.allowTools] as ToolName[],
      resource: sc.grant?.resourceLabel ?? `customer ${RECORDS.customer.id}`,
      expires: GRANT_EXPIRES,
      timeLeft: formatTimeLeft(gwGrant.expiresAt),
    }
  }

  private _startCountdown(expiresAt: Date, baseGrant: TaskGrant): void {
    this._countdownInterval = setInterval(() => {
      if (!this._snap.currentTask) {
        this._clearCountdown()
        return
      }
      const timeLeft = formatTimeLeft(expiresAt)
      this._patch({ currentTask: { ...this._snap.currentTask, timeLeft } })
    }, 1000)
  }

  private _clearCountdown(): void {
    if (this._countdownInterval != null) {
      clearInterval(this._countdownInterval)
      this._countdownInterval = null
    }
  }

  private _mapAuditEntry(
    gae: GatewayAuditEntry,
    callCtx: CallContext,
    action?: 'approve' | 'deny',
    note?: string,
    reviewerUser?: User,
  ): AuditEntry {
    const result = this._buildResultText(gae, callCtx, action, note, reviewerUser ?? undefined)
    return {
      seq: gae.index,
      date: DEMO_DATE,
      time: callCtx.resolvedTime && action ? callCtx.resolvedTime : callCtx.time,
      requestedBy: gae.user.name,
      role: gae.user.role,
      taskId: gae.taskId,
      tool: gae.tool,
      args: gae.args as Record<string, ArgValue>,
      decision: gae.decision,
      rule: gae.ruleId,
      reason: gae.reason,
      reviewer: gae.reviewer?.name ?? null,
      result,
      hash: gae.hash.substring(0, 8),
      prevHash: gae.prevHash.substring(0, 8),
      eventId: gae.eventId,
    }
  }

  private _buildResultText(
    gae: GatewayAuditEntry,
    callCtx: CallContext,
    action?: 'approve' | 'deny',
    note?: string,
    reviewerUser?: User,
  ): string {
    const decision = gae.decision
    const tool = gae.tool

    if (action === 'deny' && reviewerUser) {
      const cleanNote = (note ?? '').replace(/\.+$/, '')
      return `Not executed. Denied by ${reviewerUser.name}: ${cleanNote}.`
    }

    if (action === 'approve' && reviewerUser) {
      if (tool === 'refund.issue') {
        const exResult = gae.execution.result as Record<string, unknown> | undefined
        const refundId = (exResult?.refund_id as string) ?? ''
        const amount = (gae.args['amount'] as number) ?? 0
        return `Executed after approval by ${reviewerUser.name}. Refund ${refundId} for ₹${amount.toLocaleString('en-IN')} created in the mock payment system.`
      }
      if (tool === 'customer.export') {
        return `Executed after approval by ${reviewerUser.name}. Exported 1,240 synthetic customer records from the mock customer system.`
      }
      if (tool === 'payroll.export') {
        return `Executed after approval by ${reviewerUser.name}. Exported 86 synthetic payroll rows from the mock payroll system.`
      }
    }

    if (decision === 'blocked') {
      return 'Not executed. The tool was never called and no data left the system.'
    }

    if (decision === 'needs_approval') {
      const requiredReviewerRole = getRequiredReviewerRole(callCtx.user.role as Role) ?? 'Ops Manager'
      const rwUser = getUserByRole(requiredReviewerRole as Role)
      return rwUser
        ? `Waiting for approval from ${rwUser.name} (${rwUser.role}).`
        : 'Waiting for approval.'
    }

    if (decision === 'allowed') {
      if (tool === 'invoice.lookup') {
        return 'Executed. Returned invoice INV-1042: ₹73,000, Paid, 3 line items. The add-on appears twice.'
      }
      if (tool === 'refund.issue') {
        const exResult = gae.execution.result as Record<string, unknown> | undefined
        const refundId = (exResult?.refund_id as string) ?? ''
        const amount = (gae.args['amount'] as number) ?? 0
        return `Executed. Refund ${refundId} for ₹${amount.toLocaleString('en-IN')} created in the mock payment system.`
      }
    }

    return ''
  }

  private _buildOutcome(
    callCtx: CallContext,
    result: Awaited<ReturnType<Gateway['submit']>>,
  ): string {
    if (result.decision === 'blocked') {
      return 'Not executed. The tool was never called and no data left the system.'
    }
    if (result.decision === 'allowed') {
      const tool = callCtx.call.tool
      if (tool === 'invoice.lookup') {
        return 'Executed. Returned invoice INV-1042: ₹73,000, Paid, 3 line items. The add-on appears twice.'
      }
      if (tool === 'refund.issue') {
        const exResult = result.execution.result as Record<string, unknown> | undefined
        const refundId = (exResult?.refund_id as string) ?? ''
        const amount = (callCtx.call.args['amount'] as number) ?? 0
        return `Executed. Refund ${refundId} for ₹${amount.toLocaleString('en-IN')} created in the mock payment system.`
      }
    }
    return ''
  }

  private _buildResolvedOutcome(
    callCtx: CallContext,
    action: 'approve' | 'deny',
    note: string,
    ap: ApprovalRequest,
    resolveResult: Awaited<ReturnType<Gateway['resolveApproval']>>,
  ): string {
    if (!resolveResult.ok) return ''
    const approve = action === 'approve'
    if (!approve) {
      const cleanNote = note.replace(/\.+$/, '')
      return `Not executed. Denied by ${ap.reviewer.name}: ${cleanNote}.`
    }
    const tool = ap.tool
    if (tool === 'refund.issue') {
      const exResult = resolveResult.executionResult?.data as Record<string, unknown> | undefined
      const refundId = (exResult?.refund_id as string) ?? ''
      const amount = (ap.args['amount'] as number) ?? 0
      return `Executed after approval by ${ap.reviewer.name}. Refund ${refundId} for ₹${amount.toLocaleString('en-IN')} created in the mock payment system.`
    }
    if (tool === 'customer.export') {
      return `Executed after approval by ${ap.reviewer.name}. Exported 1,240 synthetic customer records from the mock customer system.`
    }
    if (tool === 'payroll.export') {
      return `Executed after approval by ${ap.reviewer.name}. Exported 86 synthetic payroll rows from the mock payroll system.`
    }
    return ''
  }

  private _decisionToEventStatus(
    decision: 'allowed' | 'needs_approval' | 'blocked',
  ): ActionEvent['status'] {
    if (decision === 'allowed') return 'allowed'
    if (decision === 'blocked') return 'blocked'
    return 'pending'
  }

  private _gwRoleToUIUser(role: Role): User {
    if (role === 'Support Lead') return USERS.priya
    if (role === 'Ops Manager') return USERS.dev
    if (role === 'Finance Admin') return USERS.anita
    return USERS.rohan
  }

  // ── Internal: toast ────────────────────────────────────────────────────────

  private _showToast(t: Omit<Toast, 'id'>): void {
    if (this._toastTimeout != null) {
      clearTimeout(this._toastTimeout)
    }
    const toast: Toast = { ...t, id: ++_toastSeq }
    this._patch({ toast })
    this._toastTimeout = setTimeout(() => {
      this._patch({ toast: null })
    }, 4000)
  }

  // ── Internal: state management ─────────────────────────────────────────────

  private _patch(partial: Partial<ControllerSnapshot>): void {
    this._snap = { ...this._snap, ...partial }
    this._notify()
  }

  private _notify(): void {
    for (const fn of this._subscribers) {
      fn(this._snap)
    }
  }
}
