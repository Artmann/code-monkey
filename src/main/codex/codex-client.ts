import type { Codex, CodexOptions } from '@openai/codex-sdk'

import type {
  CodexApiProviderSettings,
  CodexCliProviderSettings
} from './provider-settings'

export type CodexProviderSettings =
  | CodexCliProviderSettings
  | CodexApiProviderSettings

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
  settings: CodexProviderSettings
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
  settings: CodexProviderSettings,
  loadSdk: CodexSdkLoader = loadCodexSdk
): Promise<CodexClient> => {
  const { Codex } = await loadSdk()

  return new Codex(buildCodexOptions(settings))
}
