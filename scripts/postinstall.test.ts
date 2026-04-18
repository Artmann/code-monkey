import { describe, expect, test, vi } from 'vitest'

import { runPostinstall } from './postinstall-lib.mjs'

describe('runPostinstall', () => {
  test('skips the rebuild in a development checkout', async () => {
    const rebuildNativeModule = vi.fn()
    const log = vi.fn()

    await expect(
      runPostinstall({
        root: 'C:/repo',
        hasBetterSqlite: true,
        hasElectron: true,
        hasSourceTree: true,
        electronVersion: '41.2.1',
        rebuildNativeModule,
        log
      })
    ).resolves.toEqual(0)

    expect(rebuildNativeModule).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  test('rebuilds better-sqlite3 against the installed Electron version', async () => {
    const rebuildNativeModule = vi.fn(async () => undefined)
    const log = vi.fn()

    await expect(
      runPostinstall({
        root: 'C:/temp/node_modules/@artmann/codemonkey',
        hasBetterSqlite: true,
        hasElectron: true,
        hasSourceTree: false,
        electronVersion: '41.2.1',
        rebuildNativeModule,
        log
      })
    ).resolves.toEqual(0)

    expect(rebuildNativeModule).toHaveBeenCalledWith({
      buildPath: 'C:/temp/node_modules/@artmann/codemonkey',
      electronVersion: '41.2.1',
      force: true,
      mode: 'sequential',
      onlyModules: ['better-sqlite3']
    })
  })

  test('keeps install non-fatal when the rebuild fails', async () => {
    const log = vi.fn()
    const rebuildNativeModule = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(
      runPostinstall({
        root: 'C:/temp/node_modules/@artmann/codemonkey',
        hasBetterSqlite: true,
        hasElectron: true,
        hasSourceTree: false,
        electronVersion: '41.2.1',
        rebuildNativeModule,
        log
      })
    ).resolves.toEqual(0)

    expect(log).toHaveBeenCalledWith(
      'warn',
      '[@artmann/codemonkey] native rebuild did not succeed. The app may fail to load better-sqlite3 at runtime.',
      expect.any(Error)
    )
  })
})
