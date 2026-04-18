export type ProviderKind = 'codex' | 'claude-code'

export type AgentThreadOptions = {
  workingDirectory?: string
  skipGitRepoCheck?: boolean
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted'
}

export type NormalizedEventType =
  | 'thread.started'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'item.started'
  | 'item.updated'
  | 'item.completed'
  | 'error'

export type NormalizedEvent = {
  type: NormalizedEventType | string
  thread_id?: string
  item?: unknown
  message?: string
  error?: { message: string }
  usage?: unknown
}

export type AgentThread = {
  readonly id: string | null
  runStreamed: (input: string) => Promise<{
    events: AsyncIterable<NormalizedEvent>
  }>
}

export type AgentProvider = {
  startThread: (options?: AgentThreadOptions) => AgentThread
  resumeThread: (
    externalId: string,
    options?: AgentThreadOptions
  ) => AgentThread
}

export type OneOffAgentInput = {
  prompt: string
  workingDirectory: string
  signal?: AbortSignal
}

export type OneOffAgentProvider = {
  runOneOff: (input: OneOffAgentInput) => Promise<string>
}

export type FullAgentProvider = AgentProvider & OneOffAgentProvider
