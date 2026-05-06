export type ProviderKind = 'codex' | 'claude-code'

// Mirrors t3code's runtimeMode. Drives the Claude SDK permissionMode and
// whether code-monkey routes tool calls through `onApprovalRequest`.
//   full-access      — bypass all prompts (SDK runs every tool unattended)
//   approval-required — every non-allowlisted tool waits for the user
//   auto-accept-edits — file writes auto-allowed; other tools still prompt
//   plan              — SDK plan mode: agent plans without executing tools
export type RuntimeMode =
  | 'approval-required'
  | 'auto-accept-edits'
  | 'full-access'
  | 'plan'

export type RequestKind =
  | 'command'
  | 'file_read'
  | 'file_write'
  | 'network'
  | 'other'

export type ApprovalRequest = {
  id: string
  input: unknown
  kind: RequestKind
  summary: string
  tool: string
}

export type ApprovalDecision =
  | { decision: 'approve' }
  | { decision: 'reject'; reason?: string }

export type OnApprovalRequest = (
  request: ApprovalRequest
) => Promise<ApprovalDecision>

// Question shape mirrors the SDK AskUserQuestion tool input. We pass it
// through so the UI can render a real question form instead of a generic
// approval card.
export type UserInputOption = {
  description: string
  label: string
  preview?: string
}

export type UserInputQuestion = {
  header: string
  multiSelect: boolean
  options: UserInputOption[]
  question: string
}

export type UserInputRequest = {
  id: string
  questions: UserInputQuestion[]
}

// Answers keyed by question text — same shape the AskUserQuestion tool
// expects to receive back as `answers`.
export type UserInputAnswers = Record<string, string>

export type OnUserInputRequest = (
  request: UserInputRequest
) => Promise<UserInputAnswers>

export type AgentThreadOptions = {
  workingDirectory?: string
  skipGitRepoCheck?: boolean
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted'
  // Extra writable roots beyond the workspace. Needed for git worktrees, where
  // `.git` is a pointer to <main-repo>/.git/worktrees/<name>/ — outside the
  // worktree cwd — so `git add`/`commit` would otherwise be sandbox-blocked.
  additionalDirectories?: string[]
  onApprovalRequest?: OnApprovalRequest
  onUserInputRequest?: OnUserInputRequest
  runtimeMode?: RuntimeMode
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

export type RunStreamedOptions = {
  abortSignal?: AbortSignal
}

export type AgentThread = {
  readonly id: string | null
  runStreamed: (
    input: string,
    options?: RunStreamedOptions
  ) => Promise<{
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
