import { describe, expect, test } from 'vitest'

import { buildCodexOptions } from './codex-client'

describe('buildCodexOptions', () => {
  test('CLI mode without a binary path maps to empty options', () => {
    expect(buildCodexOptions({ mode: 'cli', binaryPath: null })).toEqual({})
  })

  test('CLI mode with a binary path maps to codexPathOverride', () => {
    expect(
      buildCodexOptions({ mode: 'cli', binaryPath: '/usr/local/bin/codex' })
    ).toEqual({ codexPathOverride: '/usr/local/bin/codex' })
  })

  test('API mode maps to the apiKey option', () => {
    expect(buildCodexOptions({ mode: 'api', apiKey: 'sk-secret' })).toEqual({
      apiKey: 'sk-secret'
    })
  })
})
