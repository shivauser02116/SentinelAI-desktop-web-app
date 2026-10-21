import type { AgentAdapter, AgentEmitFn } from './AgentAdapter'
import { SCENARIOS } from '../data/scenarios'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class SimulatedAgent implements AgentAdapter {
  readonly mode = 'simulated' as const
  private readonly delays: [number, number]

  constructor(delays: [number, number] = [0, 0]) {
    this.delays = delays
  }

  async run(scenarioId: string, _userMessage: string, emit: AgentEmitFn): Promise<void> {
    const sc = SCENARIOS.find((s) => s.id === scenarioId)
    if (!sc) return

    await sleep(this.delays[0])
    emit({ kind: 'agent_message', text: sc.agentLine })

    await sleep(this.delays[1])
    emit({
      kind: 'proposed_call',
      call: {
        tool: sc.call.tool,
        args: sc.call.args as Record<string, unknown>,
        summary: sc.call.summary,
      },
      provenance: {
        label: sc.call.source.label,
        untrusted: sc.call.source.kind === 'untrusted',
      },
    })
  }
}
