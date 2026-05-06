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
  OnApprovalRequest,
  OnUserInputRequest,
  RequestKind,
  RuntimeMode,
  UserInputAnswers,
  UserInputQuestion,
  UserInputRequest
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

type SettingSource = 'user' | 'project' | 'local'

type QueryOptions = {
  cwd?: string
  model?: string
  permissionMode?: QueryPermissionMode
  resume?: string
  pathToClaudeCodeExecutable?: string
  env?: Record<string, string>
  abortController?: AbortController
  canUseTool?: CanUseTool
  settingSources?: SettingSource[]
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

const permissionModeFor = (
  runtimeMode: RuntimeMode | undefined
): QueryPermissionMode => {
  if (runtimeMode === 'full-access') {
    return 'bypassPermissions'
  }

  if (runtimeMode === 'auto-accept-edits') {
    return 'acceptEdits'
  }

  if (runtimeMode === 'plan') {
    return 'plan'
  }

  // 'approval-required' or unset: stay in default so the SDK routes tool
  // calls through canUseTool instead of auto-accepting.
  return 'default'
}

const classifyAndSummarize = (
  tool: string,
  input: unknown
): { kind: RequestKind; summary: string } => {
  if (
    tool === 'Bash' &&
    typeof input === 'object' &&
    input !== null &&
    'command' in input
  ) {
    const command = (input as { command: unknown }).command

    if (typeof command === 'string') {
      return { kind: 'command', summary: command.slice(0, 200) }
    }
  }

  if (
    (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') &&
    typeof input === 'object' &&
    input !== null &&
    'file_path' in input
  ) {
    const path = (input as { file_path: unknown }).file_path

    if (typeof path === 'string') {
      return { kind: 'file_write', summary: `${tool} ${path}` }
    }
  }

  if (
    (tool === 'Read' || tool === 'Glob' || tool === 'Grep') &&
    typeof input === 'object' &&
    input !== null
  ) {
    const record = input as Record<string, unknown>
    const target =
      typeof record.file_path === 'string'
        ? record.file_path
        : typeof record.pattern === 'string'
          ? record.pattern
          : ''

    return {
      kind: 'file_read',
      summary: target ? `${tool} ${target}` : tool
    }
  }

  if (tool === 'WebFetch' || tool === 'WebSearch') {
    if (typeof input === 'object' && input !== null) {
      const record = input as Record<string, unknown>
      const target =
        typeof record.url === 'string'
          ? record.url
          : typeof record.query === 'string'
            ? record.query
            : ''

      return {
        kind: 'network',
        summary: target ? `${tool} ${target}` : tool
      }
    }
  }

  return { kind: 'other', summary: tool }
}

const extractQuestions = (input: unknown): UserInputQuestion[] => {
  if (typeof input !== 'object' || input === null) {
    return []
  }

  const record = input as Record<string, unknown>

  if (!Array.isArray(record.questions)) {
    return []
  }

  const questions: UserInputQuestion[] = []

  for (const candidate of record.questions) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue
    }

    const entry = candidate as Record<string, unknown>

    if (
      typeof entry.question !== 'string' ||
      typeof entry.header !== 'string' ||
      !Array.isArray(entry.options)
    ) {
      continue
    }

    const options = entry.options.flatMap((option) => {
      if (typeof option !== 'object' || option === null) {
        return []
      }

      const optionEntry = option as Record<string, unknown>

      if (
        typeof optionEntry.label !== 'string' ||
        typeof optionEntry.description !== 'string'
      ) {
        return []
      }

      return [
        {
          description: optionEntry.description,
          label: optionEntry.label,
          ...(typeof optionEntry.preview === 'string'
            ? { preview: optionEntry.preview }
            : {})
        }
      ]
    })

    questions.push({
      header: entry.header,
      multiSelect: entry.multiSelect === true,
      options,
      question: entry.question
    })
  }

  return questions
}

const extractPlan = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) {
    return ''
  }

  const record = input as Record<string, unknown>

  if (typeof record.plan === 'string') {
    return record.plan
  }

  return ''
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

type CanUseToolDependencies = {
  channel: Channel<NormalizedEvent>
  onApprovalRequest?: OnApprovalRequest
  onUserInputRequest?: OnUserInputRequest
}

const buildCanUseTool = ({
  channel,
  onApprovalRequest,
  onUserInputRequest
}: CanUseToolDependencies): CanUseTool => {
  return async (toolName, input) => {
    // ExitPlanMode: never allow the SDK to execute it. Capture the proposed
    // plan as an event the UI can render, then deny so the SDK leaves plan
    // mode cleanly.
    if (toolName === 'ExitPlanMode') {
      const plan = extractPlan(input)

      channel.push({
        type: 'item.plan_proposed',
        item: {
          id: randomUUID(),
          plan,
          proposedAt: new Date().toISOString()
        }
      } as NormalizedEvent)

      return { behavior: 'deny', message: 'Plan captured; awaiting user.' }
    }

    // AskUserQuestion: route through onUserInputRequest if available so the
    // UI shows a real question form. Returns the answers as updatedInput so
    // the SDK proceeds with the user's responses.
    if (toolName === 'AskUserQuestion' && onUserInputRequest) {
      const request: UserInputRequest = {
        id: randomUUID(),
        questions: extractQuestions(input)
      }

      const requestedAt = new Date().toISOString()

      channel.push({
        type: 'item.user_input_requested',
        item: { ...request, requestedAt }
      } as NormalizedEvent)

      let answers: UserInputAnswers

      try {
        answers = await onUserInputRequest(request)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        channel.push({
          type: 'item.user_input_resolved',
          item: {
            id: request.id,
            answers: {},
            error: message,
            resolvedAt: new Date().toISOString()
          }
        } as NormalizedEvent)

        return { behavior: 'deny', message }
      }

      channel.push({
        type: 'item.user_input_resolved',
        item: {
          id: request.id,
          answers,
          resolvedAt: new Date().toISOString()
        }
      } as NormalizedEvent)

      return { behavior: 'allow', updatedInput: { answers } }
    }

    if (!onApprovalRequest) {
      // No approval handler configured — fall back to allow so the SDK can
      // still proceed when the host opted into a permissive mode but didn't
      // wire up an approval channel.
      return { behavior: 'allow' }
    }

    const { kind, summary } = classifyAndSummarize(toolName, input)
    const request = {
      id: randomUUID(),
      tool: toolName,
      input,
      kind,
      summary
    }
    const requestedAt = new Date().toISOString()

    channel.push({
      type: 'item.approval_requested',
      item: { ...request, requestedAt }
    } as NormalizedEvent)

    let decision

    try {
      decision = await onApprovalRequest(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      channel.push({
        type: 'item.approval_resolved',
        item: {
          id: request.id,
          decision: 'reject',
          reason: message,
          resolvedAt: new Date().toISOString()
        }
      } as NormalizedEvent)

      return { behavior: 'deny', message }
    }

    const resolvedAt = new Date().toISOString()

    channel.push({
      type: 'item.approval_resolved',
      item: {
        id: request.id,
        decision: decision.decision,
        reason: decision.decision === 'reject' ? decision.reason : undefined,
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

  const baseOptions = (threadOptions?: AgentThreadOptions): QueryOptions => ({
    ...(threadOptions?.workingDirectory != null
      ? { cwd: threadOptions.workingDirectory }
      : {}),
    permissionMode: permissionModeFor(threadOptions?.runtimeMode),
    settingSources: [],
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
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
      runStreamed: async (input, runOptions) => {
        const eventChannel = createChannel<NormalizedEvent>()
        const onApprovalRequest = threadOptions?.onApprovalRequest
        const onUserInputRequest = threadOptions?.onUserInputRequest

        // Register canUseTool whenever a host callback is wired. The runtime
        // mode still governs permissionMode independently — a full-access
        // mode + no callbacks means the SDK runs unattended.
        const shouldRegisterCanUseTool =
          onApprovalRequest != null || onUserInputRequest != null

        const abortSignal = runOptions?.abortSignal
        const abortController = abortSignal ? new AbortController() : undefined

        if (abortController && abortSignal) {
          if (abortSignal.aborted) {
            abortController.abort()
          } else {
            abortSignal.addEventListener(
              'abort',
              () => abortController.abort(),
              { once: true }
            )
          }
        }

        const options: QueryOptions = {
          ...baseOptions(threadOptions),
          ...(currentSessionId ? { resume: currentSessionId } : {}),
          ...(abortController ? { abortController } : {}),
          ...(shouldRegisterCanUseTool
            ? {
                canUseTool: buildCanUseTool({
                  channel: eventChannel,
                  onApprovalRequest,
                  onUserInputRequest
                })
              }
            : {})
        }

        const raw = query({ prompt: input, options })
        const { events: sdkEvents, getSessionId } = captureSessionId(raw)

        const generator = normalizeClaudeCodeStream(sdkEvents, currentSessionId)

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
      settingSources: [],
      ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
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
        message as {
          message?: { content?: Array<{ type: string; text?: string }> }
        }
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
