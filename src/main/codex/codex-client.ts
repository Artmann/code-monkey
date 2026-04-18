import type { Codex, CodexOptions } from '@openai/codex-sdk'

import type { ProviderSettings } from './provider-settings'

export type BuiltCodexOptions = Pick<
  CodexOptions,
  'apiKey' | 'codexPathOverride'
>

export type CodexClient = Pick<Codex, 'resumeThread' | 'startThread'>

type CodexConstructor = new (options: BuiltCodexOptions) => CodexClient

export type CodexSdkModule = {
  Codex: CodexConstructor
}

export type CodexSdkLoader = () => Promise<CodexSdkModule>

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

const loadCodexSdk: CodexSdkLoader = async () => {
  const { Codex } = await import('@openai/codex-sdk')

  return { Codex }
}

export const createCodex = async (
  settings: ProviderSettings,
  loadSdk: CodexSdkLoader = loadCodexSdk
): Promise<CodexClient> => {
  const { Codex } = await loadSdk()

  return new Codex(buildCodexOptions(settings))
}
