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
      const result = await thread.runStreamed(input)

      return {
        events: result.events as AsyncIterable<NormalizedEvent>
      }
    }
  })

  const agentProvider: AgentProvider = {
    startThread: (options?: AgentThreadOptions) =>
      wrapThread(codex.startThread(options)),
    resumeThread: (externalId: string, options?: AgentThreadOptions) =>
      wrapThread(codex.resumeThread(externalId, options))
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
