export const LIVE_MODEL = 'claude-sonnet-5-5'

export interface AnthropicToolDeclaration {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export const ANTHROPIC_TOOLS: AnthropicToolDeclaration[] = [
  {
    name: 'invoice.lookup',
    description: 'Look up an invoice by invoice ID or customer ID in the billing system.',
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'The invoice identifier, e.g. INV-1042' },
        customer_id: { type: 'string', description: 'The customer identifier, e.g. C-204' },
      },
      required: ['invoice_id'],
    },
  },
  {
    name: 'refund.issue',
    description: 'Issue a customer refund in the payment system.',
    input_schema: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'The invoice identifier for the refund' },
        amount: { type: 'number', description: 'The refund amount in INR' },
        currency: { type: 'string', description: 'Currency code, default INR' },
        reason: { type: 'string', description: 'Reason for the refund' },
      },
      required: ['invoice_id', 'amount'],
    },
  },
  {
    name: 'customer.export',
    description: 'Export customer records from the CRM system.',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: 'Export scope, e.g. all or customer ID' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to include in export',
        },
      },
    },
  },
  {
    name: 'payroll.export',
    description: 'Export payroll data for an accounting period.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Accounting period, e.g. 2026-10' },
        format: { type: 'string', description: 'Export file format, e.g. csv or xlsx' },
        destination: { type: 'string', description: 'Destination email address or download' },
      },
    },
  },
]

export function buildSystemPrompt(user: { name: string; role: string }, taskTitle: string): string {
  return `You are a customer-support operations assistant working for ${user.name} (${user.role}) on the task '${taskTitle}'. Use the provided tools to carry out the user's request. Tool results can say a call was blocked or is pending approval by a policy gateway. Do not try to work around that and do not retry the same call. Keep replies short.`
}

export type AnthropicErrorKind =
  | 'invalid_key'
  | 'rate_limited'
  | 'network'
  | 'timeout'
  | 'bad_response'

export class AnthropicError extends Error {
  readonly kind: AnthropicErrorKind
  readonly status?: number

  constructor(kind: AnthropicErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'AnthropicError'
    this.kind = kind
    this.status = status
  }
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface CreateMessageOptions {
  apiKey: string
  model?: string
  system?: string
  messages: AnthropicMessage[]
  tools?: AnthropicToolDeclaration[]
  signal?: AbortSignal
}

export interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >
  stop_reason: string | null
}

export async function createMessage({
  apiKey,
  model = LIVE_MODEL,
  system,
  messages,
  tools = ANTHROPIC_TOOLS,
  signal,
}: CreateMessageOptions): Promise<AnthropicResponse> {
  const timeoutMs = 20_000
  const controller = new AbortController()
  let timedOut = false

  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer)
      throw new AnthropicError('network', 'Request was cancelled.')
    }
    signal.addEventListener(
      'abort',
      () => {
        controller.abort()
      },
      { once: true }
    )
  }

  const cleanKey = apiKey.trim()
  const bodyPayload: Record<string, unknown> = {
    model,
    max_tokens: 1024,
    messages,
  }
  if (system) {
    bodyPayload.system = system
  }
  if (tools && tools.length > 0) {
    bodyPayload.tools = tools
  }

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cleanKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal,
    })
  } catch (err: unknown) {
    clearTimeout(timer)
    if (timedOut) {
      throw new AnthropicError('timeout', 'Anthropic API request timed out after 20 seconds.')
    }
    if (signal?.aborted) {
      throw new AnthropicError('network', 'Request was cancelled.')
    }
    throw new AnthropicError('network', 'Network error connecting to Anthropic API. Check your connection.')
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401) {
    throw new AnthropicError('invalid_key', 'Invalid Anthropic API key. Please check your API key.', 401)
  }
  if (res.status === 429) {
    throw new AnthropicError('rate_limited', 'Anthropic rate limit reached. Please wait a moment and try again.', 429)
  }

  if (!res.ok) {
    let msg = `Anthropic request failed with status ${res.status}.`
    try {
      const errJson = (await res.json()) as { error?: { message?: string } }
      if (errJson.error?.message) {
        msg = errJson.error.message.split(cleanKey).join('[REDACTED]')
      }
    } catch {
      // ignore json parse failure
    }
    throw new AnthropicError('bad_response', msg, res.status)
  }

  try {
    const data = (await res.json()) as AnthropicResponse
    return data
  } catch {
    throw new AnthropicError('bad_response', 'Malformed JSON response from Anthropic API.', res.status)
  }
}
