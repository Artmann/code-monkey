import type {
  ApprovalMode,
  ModelReasoningEffort,
  SandboxMode,
  ThreadOptions
} from '@openai/codex-sdk'

export type OneOffAgentTurn = {
  finalResponse: string
}

export type OneOffAgentThread = {
  run: (
    input: string,
    turnOptions?: { signal?: AbortSignal }
  ) => Promise<OneOffAgentTurn>
}

export type OneOffAgentCodex = {
  startThread: (options?: ThreadOptions) => OneOffAgentThread
}

export type RunOneOffAgentInput = {
  codex: OneOffAgentCodex
  prompt: string
  workingDirectory: string
  sandboxMode?: SandboxMode
  approvalPolicy?: ApprovalMode
  modelReasoningEffort?: ModelReasoningEffort
  networkAccessEnabled?: boolean
  skipGitRepoCheck?: boolean
  signal?: AbortSignal
}

export const runOneOffAgent = async ({
  codex,
  prompt,
  workingDirectory,
  sandboxMode = 'read-only',
  approvalPolicy = 'never',
  modelReasoningEffort,
  networkAccessEnabled = false,
  skipGitRepoCheck,
  signal
}: RunOneOffAgentInput): Promise<string> => {
  const thread = codex.startThread({
    workingDirectory,
    sandboxMode,
    approvalPolicy,
    networkAccessEnabled,
    ...(modelReasoningEffort != null ? { modelReasoningEffort } : {}),
    ...(skipGitRepoCheck != null ? { skipGitRepoCheck } : {})
  })

  const turn = await thread.run(prompt, signal ? { signal } : undefined)

  return turn.finalResponse.trim()
}
