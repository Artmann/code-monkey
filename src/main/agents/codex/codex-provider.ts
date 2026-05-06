import type {
  AgentProvider,
  AgentThread,
  AgentThreadOptions,
  FullAgentProvider,
  NormalizedEvent,
  OneOffAgentInput
} from '../provider'
import {
  createCodex,
  type CodexProviderSettings,
  type CodexSdkLoader
} from '../../codex/codex-client'
import { runOneOffAgent } from '../../codex/one-off-agent'

// Codex SDK (as of this version) does not expose a per-tool-call approval
// callback nor emit approval-request events in its stream. `onApprovalRequest`
// is accepted for API parity with the Claude Code provider but is not invoked
// — Codex relies on its own `approvalPolicy` + sandbox settings. If a future
// SDK version surfaces per-call approval events, wire them here.
const stripUnsupportedOptions = (options?: AgentThreadOptions) => {
  if (!options) return undefined

  const { onApprovalRequest: _onApprovalRequest, ...supported } = options

  return supported
}

export const createCodexProvider = async (
  settings: CodexProviderSettings,
  loadSdk?: CodexSdkLoader
): Promise<FullAgentProvider> => {
  const codex = await createCodex(settings, loadSdk)

  const wrapThread = (
    thread: ReturnType<typeof codex.startThread>
  ): AgentThread => ({
    get id() {
      return thread.id ?? null
    },
    runStreamed: async (input) => {
      // The Codex SDK does not currently expose an abort handle on its
      // streamed run. The runner relies on its synthetic turn.failed event
      // to flip the UI out of the working state when a user cancels.
      const result = await thread.runStreamed(input)

      return {
        events: result.events as AsyncIterable<NormalizedEvent>
      }
    }
  })

  const agentProvider: AgentProvider = {
    startThread: (options?: AgentThreadOptions) =>
      wrapThread(codex.startThread(stripUnsupportedOptions(options))),
    resumeThread: (externalId: string, options?: AgentThreadOptions) =>
      wrapThread(
        codex.resumeThread(externalId, stripUnsupportedOptions(options))
      )
  }

  // The Codex SDK's ThreadOptions accepts the additionalDirectories field
  // directly (typed as string[] of extra writable roots). AgentThreadOptions
  // is a structural superset, so pass-through works without explicit mapping.

  const runOneOff = async (input: OneOffAgentInput): Promise<string> =>
    runOneOffAgent({
      codex,
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      signal: input.signal
    })

  return { ...agentProvider, runOneOff }
}
