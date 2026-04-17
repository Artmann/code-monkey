import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'

import * as schema from '../database/schema'
import {
  clearProviderSettings,
  getProviderSettings,
  getProviderSettingsSummary,
  setProviderSettings,
  type SafeStorageLike
} from './provider-settings'

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

const migrationsFolder = resolve(__dirname, '..', 'database', 'migrations')

const createFakeSafeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain: string) =>
    Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (buffer: Buffer) => {
    const text = buffer.toString('utf8')

    if (!text.startsWith('enc:')) {
      throw new Error('decrypt received non-encrypted bytes')
    }

    return text.slice('enc:'.length)
  }
})

const createTestDatabase = (): TestDatabase => {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')

  const database = drizzle(sqlite, { schema })

  migrate(database, { migrationsFolder })

  return database
}

describe('provider-settings', () => {
  let database: TestDatabase
  let safeStorage: SafeStorageLike

  beforeEach(() => {
    database = createTestDatabase()
    safeStorage = createFakeSafeStorage()
  })

  test('returns null when nothing is configured', () => {
    expect(getProviderSettings({ database, safeStorage })).toEqual(null)
    expect(getProviderSettingsSummary({ database, safeStorage })).toEqual(null)
  })

  test('persists CLI mode with a binary path', () => {
    setProviderSettings(
      { database, safeStorage },
      { mode: 'cli', binaryPath: '/usr/local/bin/codex' }
    )

    expect(getProviderSettings({ database, safeStorage })).toEqual({
      mode: 'cli',
      binaryPath: '/usr/local/bin/codex'
    })
    expect(getProviderSettingsSummary({ database, safeStorage })).toEqual({
      mode: 'cli',
      binaryPath: '/usr/local/bin/codex'
    })
  })

  test('persists CLI mode without a binary path', () => {
    setProviderSettings({ database, safeStorage }, { mode: 'cli' })

    expect(getProviderSettings({ database, safeStorage })).toEqual({
      mode: 'cli',
      binaryPath: null
    })
  })

  test('persists API mode with an encrypted key', () => {
    setProviderSettings(
      { database, safeStorage },
      { mode: 'api', apiKey: 'sk-secret' }
    )

    expect(getProviderSettings({ database, safeStorage })).toEqual({
      mode: 'api',
      apiKey: 'sk-secret'
    })
  })

  test('summary for API mode reports the key is stored without exposing it', () => {
    setProviderSettings(
      { database, safeStorage },
      { mode: 'api', apiKey: 'sk-secret' }
    )

    expect(getProviderSettingsSummary({ database, safeStorage })).toEqual({
      mode: 'api',
      hasApiKey: true
    })
  })

  test('raw DB value for the API key is encrypted, not plaintext', () => {
    setProviderSettings(
      { database, safeStorage },
      { mode: 'api', apiKey: 'sk-secret' }
    )

    const rows = database.select().from(schema.settings).all()
    const apiKeyRow = rows.find(
      (row) => row.key === 'provider.codex.apiKeyEncrypted'
    )

    expect(apiKeyRow).toBeDefined()
    expect(apiKeyRow?.value).not.toContain('sk-secret')
  })

  test('switching modes replaces prior keys', () => {
    setProviderSettings(
      { database, safeStorage },
      { mode: 'api', apiKey: 'sk-first' }
    )
    setProviderSettings(
      { database, safeStorage },
      { mode: 'cli', binaryPath: '/usr/bin/codex' }
    )

    expect(getProviderSettings({ database, safeStorage })).toEqual({
      mode: 'cli',
      binaryPath: '/usr/bin/codex'
    })
    expect(getProviderSettingsSummary({ database, safeStorage })).toEqual({
      mode: 'cli',
      binaryPath: '/usr/bin/codex'
    })
  })

  test('clearProviderSettings removes all provider rows', () => {
    setProviderSettings(
      { database, safeStorage },
      { mode: 'api', apiKey: 'sk-x' }
    )

    clearProviderSettings({ database, safeStorage })

    expect(getProviderSettings({ database, safeStorage })).toEqual(null)
  })

  test('refuses to save an API key when encryption is unavailable', () => {
    const unavailable = createFakeSafeStorage(false)

    expect(() =>
      setProviderSettings(
        { database, safeStorage: unavailable },
        { mode: 'api', apiKey: 'sk-x' }
      )
    ).toThrow(/encryption is not available/i)
  })

  test('allows CLI mode even when encryption is unavailable', () => {
    const unavailable = createFakeSafeStorage(false)

    expect(() =>
      setProviderSettings(
        { database, safeStorage: unavailable },
        { mode: 'cli' }
      )
    ).not.toThrow()
  })
})
