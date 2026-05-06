import { describe, expect, test, vi } from 'vitest'

import {
  buildCodexOptions,
  createCodex,
  type BuiltCodexOptions,
  type CodexProviderSettings,
  type CodexSdkModule
} from './codex-client'

describe('buildCodexOptions', () => {
  test('CLI mode without a binary path maps to empty options', () => {
    expect(
      buildCodexOptions({ kind: 'codex', mode: 'cli', binaryPath: null })
    ).toEqual({})
  })

  test('CLI mode with a binary path maps to codexPathOverride', () => {
    expect(
      buildCodexOptions({
        kind: 'codex',
        mode: 'cli',
        binaryPath: '/usr/local/bin/codex'
      })
    ).toEqual({ codexPathOverride: '/usr/local/bin/codex' })
  })

  test('API mode maps to the apiKey option', () => {
    expect(
      buildCodexOptions({ kind: 'codex', mode: 'api', apiKey: 'sk-secret' })
    ).toEqual({
      apiKey: 'sk-secret'
    })
  })

  test('loads the SDK lazily when creating a Codex client', async () => {
    const settings: CodexProviderSettings = {
      kind: 'codex',
      mode: 'api',
      apiKey: 'sk-secret'
    }
    let constructedOptions: unknown
    const loader = vi.fn(
      async (): Promise<CodexSdkModule> => ({
        Codex: class {
          readonly kind = 'codex-instance'
          readonly resumeThread = vi.fn()
          readonly startThread = vi.fn()

          constructor(readonly options: BuiltCodexOptions) {
            constructedOptions = options
          }
        }
      })
    )

    await expect(createCodex(settings, loader)).resolves.toMatchObject({
      kind: 'codex-instance',
      options: { apiKey: 'sk-secret' }
    })

    expect(loader).toHaveBeenCalledTimes(1)
    expect(constructedOptions).toEqual({ apiKey: 'sk-secret' })
  })
})
