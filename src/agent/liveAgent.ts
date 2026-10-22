import type { AgentAdapter, AgentEmitFn, AgentProposedCall, AgentProvenance } from './AgentAdapter'
import type { ToolName } from '../gateway/types'
import {
  createMessage,
  buildSystemPrompt,
  type AnthropicMessage,
  type AnthropicContentBlock,
} from './anthropicClient'

export interface LiveAgentConfig {
  apiKey: string
  model?: string
}

export interface RunTurnOptions {
  user: { name: string; role: string }
  taskTitle: string
  userMessage: string
  untrustedBlocks?: { label: string; text: string }[]
  onToolCall: (
    call: AgentProposedCall,
    provenance: AgentProvenance
  ) => Promise<{ status: 'executed' | 'blocked' | 'pending' | 'denied'; summary: string }>
  emit: AgentEmitFn
  signal?: AbortSignal
}

export function summarizeCall(tool: ToolName, args: Record<string, unknown>): string {
  switch (tool) {
    case 'invoice.lookup':
      return `Lookup invoice ${args['invoice_id'] ?? ''}`
    case 'refund.issue': {
      const amt = typeof args['amount'] === 'number' ? `₹${args['amount'].toLocaleString('en-IN')}` : 'refund'
      return `Refund ${amt} on ${args['invoice_id'] ?? ''}`
    }
    case 'customer.export':
      return 'Export customer records'
    case 'payroll.export': {
      const period = args['period'] ? `${args['period']} ` : ''
      const dest = args['destination'] ? ` to ${args['destination']}` : ''
      return `Export ${period}payroll${dest}`
    }
    default:
      return `${tool} execution`
  }
}

export class LiveAgent implements AgentAdapter {
  readonly mode = 'live' as const
  private config: LiveAgentConfig

  constructor(config: LiveAgentConfig) {
    this.config = config
  }

  setConfig(config: LiveAgentConfig) {
    this.config = config
  }

  async run(_scenarioId: string, _userMessage: string, _emit: AgentEmitFn): Promise<void> {
    throw new Error('Use runTurn for live agent execution.')
  }

  async runTurn({
    user,
    taskTitle,
    userMessage,
    untrustedBlocks,
    onToolCall,
    emit,
    signal,
  }: RunTurnOptions): Promise<void> {
    const hasUntrusted = !!untrustedBlocks && untrustedBlocks.length > 0
    const provenance: AgentProvenance = hasUntrusted
      ? { label: untrustedBlocks[0].label, untrusted: true }
      : { label: 'Your request', untrusted: false }

    let fullUserText = userMessage
    if (hasUntrusted) {
      const blocksText = untrustedBlocks
        .map((b) => `[Customer-supplied text from ${b.label}]:\n${b.text}`)
        .join('\n\n')
      fullUserText = `${blocksText}\n\nUser request:\n${userMessage}`
    }

    const system = buildSystemPrompt(user, taskTitle)
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: fullUserText,
      },
    ]

    let totalToolCalls = 0
    const maxToolCalls = 4

    while (totalToolCalls < maxToolCalls) {
      if (signal?.aborted) break

      const res = await createMessage({
        apiKey: this.config.apiKey,
        model: this.config.model,
        system,
        messages,
        signal,
      })

      // Emit assistant text as agent_message
      const textBlocks = res.content.filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      for (const tb of textBlocks) {
        if (tb.text.trim()) {
          emit({ kind: 'agent_message', text: tb.text.trim() })
        }
      }

      // Add assistant response to history
      messages.push({
        role: 'assistant',
        content: res.content,
      })

      // Find tool_use blocks
      const toolUseBlocks = res.content.filter(
        (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
          b.type === 'tool_use'
      )

      if (toolUseBlocks.length === 0) {
        break
      }

      const toolResults: AnthropicContentBlock[] = []
      for (const tub of toolUseBlocks) {
        if (totalToolCalls >= maxToolCalls) break
        totalToolCalls++

        const toolName = tub.name as ToolName
        const summary = summarizeCall(toolName, tub.input)
        const proposedCall: AgentProposedCall = {
          tool: toolName,
          args: tub.input,
          summary,
        }

        emit({
          kind: 'proposed_call',
          call: proposedCall,
          provenance,
        })

        const outcome = await onToolCall(proposedCall, provenance)

        let resultText = outcome.summary
        if (outcome.status === 'executed') {
          resultText = `Executed: ${outcome.summary}`
        } else if (outcome.status === 'blocked') {
          resultText = `Blocked by policy: ${outcome.summary}`
        } else if (outcome.status === 'pending') {
          resultText = `Pending approval: ${outcome.summary}`
        } else if (outcome.status === 'denied') {
          resultText = `Denied: ${outcome.summary}`
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tub.id,
          content: resultText,
        })
      }

      messages.push({
        role: 'user',
        content: toolResults,
      })
    }
  }
}
