import { Codex, type CodexOptions } from '@openai/codex-sdk'

import type { ProviderSettings } from './provider-settings'

export type BuiltCodexOptions = Pick<
  CodexOptions,
  'apiKey' | 'codexPathOverride'
>

export const buildCodexOptions = (
  settings: ProviderSettings
): BuiltCodexOptions => {
  if (settings.mode === 'cli') {
    if (settings.binaryPath == null || settings.binaryPath === '') {
      return {}
    }

    return { codexPathOverride: settings.binaryPath }
  }

  return { apiKey: settings.apiKey }
}

export const createCodex = (settings: ProviderSettings): Codex =>
  new Codex(buildCodexOptions(settings))
