import type { ProviderSettings } from '../codex/provider-settings'
import { createClaudeCodeProvider } from './claude-code/claude-code-provider'
import { createCodexProvider } from './codex/codex-provider'
import type { FullAgentProvider } from './provider'

export const createProvider = async (
  settings: ProviderSettings
): Promise<FullAgentProvider> => {
  if (settings.kind === 'codex') {
    return createCodexProvider(settings)
  }

  return createClaudeCodeProvider(settings)
}
