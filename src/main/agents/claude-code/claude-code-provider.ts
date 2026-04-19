import { randomUUID } from 'node:crypto'

import type {
  ClaudeCodeApiProviderSettings,
  ClaudeCodeCliProviderSettings
} from '../../codex/provider-settings'
import type {
  AgentProvider,
  AgentThread,
  AgentThreadOptions,
  FullAgentProvider,
  NormalizedEvent,
  OneOffAgentInput,
  OnApprovalRequest
} from '../provider'
import {
  normalizeClaudeCodeStream,
  type SDKLikeMessage
} from './claude-code-normalize'

export type ClaudeCodeProviderSettings =
  | ClaudeCodeCliProviderSettings
  | ClaudeCodeApiProviderSettings

type QueryPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'

type CanUseToolResponse =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: unknown
) => Promise<CanUseToolResponse>

type QueryOptions = {
  cwd?: string
  model?: string
  permissionMode?: QueryPermissionMode
  resume?: string
  pathToClaudeCodeExecutable?: string
  env?: Record<string, string>
  abortController?: AbortController
  canUseTool?: CanUseTool
}

type QueryInput = {
  prompt: string
  options?: QueryOptions
}

type ClaudeCodeSdkModule = {
  query: (input: QueryInput) => AsyncIterable<SDKLikeMessage>
}

export type ClaudeCodeSdkLoader = () => Promise<ClaudeCodeSdkModule>

const defaultLoader: ClaudeCodeSdkLoader = async () => {
  const mod = (await import(
    /* @vite-ignore */ '@anthropic-ai/claude-agent-sdk'
  )) as unknown as ClaudeCodeSdkModule

  return { query: mod.query }
}

const buildEnv = (
  settings: ClaudeCodeProviderSettings
): Record<string, string> | undefined => {
  if (settings.mode === 'api') {
    return { ANTHROPIC_API_KEY: settings.apiKey }
  }

  return undefined
}

const buildExecutablePath = (
  settings: ClaudeCodeProviderSettings
): string | undefined => {
  if (settings.mode === 'cli' && settings.executablePath) {
    return settings.executablePath
  }

  return undefined
}

const summarizeInput = (tool: string, input: unknown): string => {
  if (
    tool === 'Bash' &&
    typeof input === 'object' &&
    input !== null &&
    'command' in input
  ) {
    const command = (input as { command: unknown }).command

    if (typeof command === 'string') return command.slice(0, 200)
  }

  if (
    (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') &&
    typeof input === 'object' &&
    input !== null &&
    'file_path' in input
  ) {
    const path = (input as { file_path: unknown }).file_path

    if (typeof path === 'string') return `${tool} ${path}`
  }

  return tool
}

// A minimal async channel: values pushed via `push`, consumed by the async
// iterable returned from `stream()`. Closing the channel ends the stream.
type Channel<T> = {
  push: (value: T) => void
  close: () => void
  stream: () => AsyncIterable<T>
}

const createChannel = <T>(): Channel<T> => {
  const queue: T[] = []
  const waiters: Array<(value: IteratorResult<T>) => void> = []
  let closed = false

  const push = (value: T) => {
    if (closed) return

    const waiter = waiters.shift()

    if (waiter) {
      waiter({ value, done: false })
    } else {
      queue.push(value)
    }
  }

  const close = () => {
    closed = true

    while (waiters.length > 0) {
      const waiter = waiters.shift()

      waiter?.({ value: undefined as unknown as T, done: true })
    }
  }

  const stream = (): AsyncIterable<T> => ({
    [Symbol.asyncIterator]: () => ({
      next: () =>
        new Promise<IteratorResult<T>>((resolve) => {
          if (queue.length > 0) {
            const value = queue.shift() as T

            resolve({ value, done: false })

            return
          }

          if (closed) {
            resolve({ value: undefined as unknown as T, done: true })

            return
          }

          waiters.push(resolve)
        })
    })
  })

  return { push, close, stream }
}

const buildCanUseTool = (
  onApprovalRequest: OnApprovalRequest,
  channel: Channel<NormalizedEvent>
): CanUseTool => {
  return async (toolName, input) => {
    const request = {
      id: randomUUID(),
      tool: toolName,
      input,
      summary: summarizeInput(toolName, input)
    }
    const requestedAt = new Date().toISOString()

    channel.push({
      type: 'item.approval_requested',
      item: { ...request, requestedAt }
    } as NormalizedEvent)

    const decision = await onApprovalRequest(request)

    const resolvedAt = new Date().toISOString()

    channel.push({
      type: 'item.approval_resolved',
      item: {
        id: request.id,
        decision: decision.decision,
        reason:
          decision.decision === 'reject' ? decision.reason : undefined,
        resolvedAt
      }
    } as NormalizedEvent)

    if (decision.decision === 'approve') {
      return { behavior: 'allow' }
    }

    return {
      behavior: 'deny',
      message: decision.reason ?? 'Rejected by user.'
    }
  }
}

const captureSessionId = (
  stream: AsyncIterable<SDKLikeMessage>
): {
  events: AsyncIterable<SDKLikeMessage>
  getSessionId: () => string | null
} => {
  let sessionId: string | null = null

  const events: AsyncIterable<SDKLikeMessage> = {
    [Symbol.asyncIterator]: async function* () {
      for await (const message of stream) {
        if (
          message.type === 'system' &&
          (message as { subtype?: string }).subtype === 'init'
        ) {
          const candidate = (message as { session_id?: string }).session_id

          if (typeof candidate === 'string' && sessionId == null) {
            sessionId = candidate
          }
        }

        yield message
      }
    }
  }

  return {
    events,
    getSessionId: () => sessionId
  }
}

export const createClaudeCodeProvider = async (
  settings: ClaudeCodeProviderSettings,
  loadSdk: ClaudeCodeSdkLoader = defaultLoader
): Promise<FullAgentProvider> => {
  const { query } = await loadSdk()
  const env = buildEnv(settings)
  const pathToClaudeCodeExecutable = buildExecutablePath(settings)

  const baseOptions = (
    threadOptions?: AgentThreadOptions
  ): QueryOptions => ({
    ...(threadOptions?.workingDirectory != null
      ? { cwd: threadOptions.workingDirectory }
      : {}),
    // Approvals now flow through `canUseTool`; stay in the SDK default mode
    // so it routes tool calls to us instead of auto-accepting.
    permissionMode: 'default',
    ...(pathToClaudeCodeExecutable
      ? { pathToClaudeCodeExecutable }
      : {}),
    ...(env ? { env } : {})
  })

  const createThread = (
    threadOptions: AgentThreadOptions | undefined,
    resumeFrom: string | null
  ): AgentThread => {
    let currentSessionId: string | null = resumeFrom

    return {
      get id() {
        return currentSessionId
      },
      runStreamed: async (input: string) => {
        const eventChannel = createChannel<NormalizedEvent>()
        const onApprovalRequest = threadOptions?.onApprovalRequest

        const options: QueryOptions = {
          ...baseOptions(threadOptions),
          ...(currentSessionId ? { resume: currentSessionId } : {}),
          ...(onApprovalRequest
            ? {
                canUseTool: buildCanUseTool(
                  onApprovalRequest,
                  eventChannel
                )
              }
            : {})
        }

        const raw = query({ prompt: input, options })
        const { events: sdkEvents, getSessionId } = captureSessionId(raw)

        const generator = normalizeClaudeCodeStream(
          sdkEvents,
          currentSessionId
        )

        // Single-channel merge: approval events are pushed from canUseTool
        // while the SDK stream is blocked awaiting a decision. We drain the
        // SDK in the background into the same channel so consumers see both
        // in the order they arrive.
        const drainPromise = (async () => {
          try {
            for await (const event of generator) {
              eventChannel.push(event)
            }
          } finally {
            const captured = getSessionId()

            if (captured != null) currentSessionId = captured

            eventChannel.close()
          }
        })()

        const merged: AsyncIterable<NormalizedEvent> = {
          [Symbol.asyncIterator]: async function* () {
            for await (const event of eventChannel.stream()) {
              yield event
            }

            await drainPromise
          }
        }

        return { events: merged }
      }
    }
  }

  const agentProvider: AgentProvider = {
    startThread: (options) => createThread(options, null),
    resumeThread: (externalId, options) => createThread(options, externalId)
  }

  const runOneOff = async (input: OneOffAgentInput): Promise<string> => {
    const options: QueryOptions = {
      cwd: input.workingDirectory,
      permissionMode: 'plan',
      ...(pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable }
        : {}),
      ...(env ? { env } : {})
    }

    const controller = input.signal ? new AbortController() : undefined

    if (controller && input.signal) {
      const signal = input.signal

      if (signal.aborted) controller.abort()
      else
        signal.addEventListener('abort', () => controller.abort(), {
          once: true
        })

      options.abortController = controller
    }

    const stream = query({ prompt: input.prompt, options })
    let assembled = ''

    for await (const message of stream) {
      if (message.type !== 'assistant') continue

      const blocks = (
        message as { message?: { content?: Array<{ type: string; text?: string }> } }
      ).message?.content

      if (!Array.isArray(blocks)) continue

      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string') {
          assembled += block.text
        }
      }
    }

    return assembled.trim()
  }

  return { ...agentProvider, runOneOff }
}
