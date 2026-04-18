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
  OneOffAgentInput
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

type QueryOptions = {
  cwd?: string
  model?: string
  permissionMode?: QueryPermissionMode
  resume?: string
  pathToClaudeCodeExecutable?: string
  env?: Record<string, string>
  abortController?: AbortController
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

const mapPermissionMode = (
  approvalPolicy?: AgentThreadOptions['approvalPolicy']
): QueryPermissionMode => {
  if (approvalPolicy === 'never') return 'acceptEdits'

  return 'default'
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
    permissionMode: mapPermissionMode(threadOptions?.approvalPolicy),
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
        const options: QueryOptions = {
          ...baseOptions(threadOptions),
          ...(currentSessionId ? { resume: currentSessionId } : {})
        }

        const raw = query({ prompt: input, options })
        const { events, getSessionId } = captureSessionId(raw)

        const generator = normalizeClaudeCodeStream(
          events,
          currentSessionId
        )

        const normalized: AsyncIterable<NormalizedEvent> = {
          [Symbol.asyncIterator]: async function* () {
            for await (const event of generator) {
              yield event
            }

            const captured = getSessionId()

            if (captured != null) currentSessionId = captured
          }
        }

        return { events: normalized }
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
