import type { ToolName } from '../gateway/types'

export type AgentEmit =
  | { kind: 'agent_message'; text: string }
  | { kind: 'proposed_call'; call: AgentProposedCall; provenance: AgentProvenance }

export interface AgentProposedCall {
  tool: ToolName
  args: Record<string, unknown>
  summary: string
}

export interface AgentProvenance {
  label: string
  untrusted: boolean
}

export type AgentEmitFn = (event: AgentEmit) => void

export interface AgentAdapter {
  mode: 'simulated' | 'live'
  run(scenarioId: string, userMessage: string, emit: AgentEmitFn): Promise<void>
}
