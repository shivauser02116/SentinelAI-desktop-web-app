import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createMessage,
  AnthropicError,
  LIVE_MODEL,
  buildSystemPrompt,
} from '../anthropicClient'
import { LiveAgent } from '../liveAgent'
import type { AgentEmit } from '../AgentAdapter'

describe('AnthropicClient & LiveAgent', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sets the right headers and never puts the key in an error message on 401', async () => {
    const mockApiKey = 'sk-ant-test-secret-key-12345'
    let capturedHeaders: HeadersInit | undefined

    global.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedHeaders = opts.headers
      return new Response(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: `Invalid key: ${mockApiKey}` },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      )
    })

    await expect(
      createMessage({
        apiKey: mockApiKey,
        messages: [{ role: 'user', content: 'hello' }],
      })
    ).rejects.toThrow(AnthropicError)

    try {
      await createMessage({
        apiKey: mockApiKey,
        messages: [{ role: 'user', content: 'hello' }],
      })
    } catch (err) {
      const anthropicErr = err as AnthropicError
      expect(anthropicErr.kind).toBe('invalid_key')
      expect(anthropicErr.message).not.toContain(mockApiKey)
    }

    const headers = capturedHeaders as Record<string, string>
    expect(headers['x-api-key']).toBe(mockApiKey)
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
  })

  it('never puts the secret key in error messages on bad_response', async () => {
    const mockApiKey = 'sk-ant-super-secret-key'
    global.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          error: { message: `Bad request for key ${mockApiKey} on model` },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    })

    try {
      await createMessage({
        apiKey: mockApiKey,
        messages: [{ role: 'user', content: 'test' }],
      })
      expect.fail('Should have thrown')
    } catch (err) {
      const e = err as AnthropicError
      expect(e.kind).toBe('bad_response')
      expect(e.message).not.toContain(mockApiKey)
      expect(e.message).toContain('[REDACTED]')
    }
  })

  it('handles text-only assistant response', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello, how can I help you today?' }],
          stop_reason: 'end_turn',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    const agent = new LiveAgent({ apiKey: 'test-key' })
    const emitted: AgentEmit[] = []
    const onToolCall = vi.fn()

    await agent.runTurn({
      user: { name: 'Rohan Mehta', role: 'Support Agent' },
      taskTitle: 'Help customer',
      userMessage: 'Hello',
      onToolCall,
      emit: (e) => emitted.push(e),
    })

    expect(emitted).toEqual([
      { kind: 'agent_message', text: 'Hello, how can I help you today?' },
    ])
    expect(onToolCall).not.toHaveBeenCalled()
  })

  it('runs tool_use, emits proposed_call, and feeds back tool_result', async () => {
    let callCount = 0
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'text', text: 'Looking up invoice...' },
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'invoice.lookup',
                input: { invoice_id: 'INV-1042' },
              },
            ],
            stop_reason: 'tool_use',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      } else {
        return new Response(
          JSON.stringify({
            id: 'msg_2',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Invoice INV-1042 is ₹73,000 paid.' }],
            stop_reason: 'end_turn',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
    })

    const agent = new LiveAgent({ apiKey: 'test-key' })
    const emitted: AgentEmit[] = []
    const onToolCall = vi.fn().mockResolvedValue({
      status: 'executed',
      summary: 'Returned invoice INV-1042',
    })

    await agent.runTurn({
      user: { name: 'Rohan Mehta', role: 'Support Agent' },
      taskTitle: 'Billing question',
      userMessage: 'Check invoice INV-1042',
      onToolCall,
      emit: (e) => emitted.push(e),
    })

    expect(emitted).toEqual([
      { kind: 'agent_message', text: 'Looking up invoice...' },
      {
        kind: 'proposed_call',
        call: {
          tool: 'invoice.lookup',
          args: { invoice_id: 'INV-1042' },
          summary: 'Lookup invoice INV-1042',
        },
        provenance: { label: 'Your request', untrusted: false },
      },
      { kind: 'agent_message', text: 'Invoice INV-1042 is ₹73,000 paid.' },
    ])
    expect(onToolCall).toHaveBeenCalledOnce()
  })

  it('stops at 4 calls max even if the model continues requesting tools', async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          id: 'msg_repeat',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_repeat',
              name: 'invoice.lookup',
              input: { invoice_id: 'INV-1042' },
            },
          ],
          stop_reason: 'tool_use',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })

    const agent = new LiveAgent({ apiKey: 'test-key' })
    const emitted: AgentEmit[] = []
    const onToolCall = vi.fn().mockResolvedValue({
      status: 'executed',
      summary: 'OK',
    })

    await agent.runTurn({
      user: { name: 'Rohan Mehta', role: 'Support Agent' },
      taskTitle: 'Repeated tool loop',
      userMessage: 'Go in a loop',
      onToolCall,
      emit: (e) => emitted.push(e),
    })

    expect(onToolCall).toHaveBeenCalledTimes(4)
  })

  it('coarse taint tracking marks calls untrusted when untrustedBlocks is given', async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          id: 'msg_taint',
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_taint',
              name: 'refund.issue',
              input: { invoice_id: 'INV-1042', amount: 1500 },
            },
          ],
          stop_reason: 'tool_use',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })

    const agent = new LiveAgent({ apiKey: 'test-key' })
    const emitted: AgentEmit[] = []
    const onToolCall = vi.fn().mockResolvedValue({
      status: 'pending',
      summary: 'Waiting for approval',
    })

    await agent.runTurn({
      user: { name: 'Rohan Mehta', role: 'Support Agent' },
      taskTitle: 'Ticket T-9012',
      userMessage: 'Check ticket',
      untrustedBlocks: [
        { label: 'Ticket T-9012 · customer-supplied text (untrusted)', text: 'Refund me' },
      ],
      onToolCall,
      emit: (e) => emitted.push(e),
    })

    const propCall = emitted.find((e) => e.kind === 'proposed_call')
    expect(propCall).toBeDefined()
    if (propCall?.kind === 'proposed_call') {
      expect(propCall.provenance).toEqual({
        label: 'Ticket T-9012 · customer-supplied text (untrusted)',
        untrusted: true,
      })
    }
  })
})
