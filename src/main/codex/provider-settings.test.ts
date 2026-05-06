import { createClient } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import * as schema from '../database/schema'
import {
  clearProviderSettings,
  getProviderSettings,
  getProviderSettingsSummary,
  setProviderSettings,
  type SafeStorageLike
} from './provider-settings'

type TestDatabase = LibSQLDatabase<typeof schema>

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

const createTestDatabase = async (
  databaseFilePath: string
): Promise<TestDatabase> => {
  const client = createClient({ url: `file:${databaseFilePath}` })

  await client.execute('PRAGMA foreign_keys = ON')

  const database = drizzle(client, { schema })

  await migrate(database, { migrationsFolder })

  return database
}

describe('provider-settings', () => {
  let database: TestDatabase
  let safeStorage: SafeStorageLike
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'code-monkey-test-'))

    database = await createTestDatabase(join(temporaryDirectory, 'test.db'))
    safeStorage = createFakeSafeStorage()
  })

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  })

  test('returns null when nothing is configured', async () => {
    expect(await getProviderSettings({ database, safeStorage })).toEqual(null)
    expect(await getProviderSettingsSummary({ database, safeStorage })).toEqual(
      null
    )
  })

  test('persists Codex CLI mode with a binary path', async () => {
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'codex', mode: 'cli', binaryPath: '/usr/local/bin/codex' }
    )

    expect(await getProviderSettings({ database, safeStorage })).toEqual({
      kind: 'codex',
      mode: 'cli',
      binaryPath: '/usr/local/bin/codex'
    })
    expect(await getProviderSettingsSummary({ database, safeStorage })).toEqual({
      kind: 'codex',
      mode: 'cli',
      binaryPath: '/usr/local/bin/codex'
    })
  })

  test('persists Codex CLI mode without a binary path', async () => {
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'codex', mode: 'cli' }
    )

    expect(await getProviderSettings({ database, safeStorage })).toEqual({
      kind: 'codex',
      mode: 'cli',
      binaryPath: null
    })
  })

  test('persists Codex API mode with an encrypted key', async () => {
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'codex', mode: 'api', apiKey: 'sk-secret' }
    )

    expect(await getProviderSettings({ database, safeStorage })).toEqual({
      kind: 'codex',
      mode: 'api',
      apiKey: 'sk-secret'
    })
  })

  test('summary for Codex API mode reports the key is stored without exposing it', async () => {
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'codex', mode: 'api', apiKey: 'sk-secret' }
    )

    expect(await getProviderSettingsSummary({ database, safeStorage })).toEqual({
      kind: 'codex',
      mode: 'api',
      hasApiKey: true
    })
  })

  test('raw DB value for the Codex API key is encrypted, not plaintext', async () => {
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'codex', mode: 'api', apiKey: 'sk-secret' }
    )

    const rows = await database.select().from(schema.settings).all()
    const apiKeyRow = rows.find(
      (row) => row.key === 'provider.codex.apiKeyEncrypted'
    )

    expect(apiKeyRow).toBeDefined()
    expect(apiKeyRow?.value).not.toContain('sk-secret')
  })

  test('switching modes replaces prior keys', async () => {
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'codex', mode: 'api', apiKey: 'sk-first' }
    )
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'codex', mode: 'cli', binaryPath: '/usr/bin/codex' }
    )

    expect(await getProviderSettings({ database, safeStorage })).toEqual({
      kind: 'codex',
      mode: 'cli',
      binaryPath: '/usr/bin/codex'
    })
    expect(await getProviderSettingsSummary({ database, safeStorage })).toEqual({
      kind: 'codex',
      mode: 'cli',
      binaryPath: '/usr/bin/codex'
    })
  })

  test('switching kind clears the previous provider data', async () => {
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'codex', mode: 'cli', binaryPath: '/usr/bin/codex' }
    )
    await setProviderSettings(
      { database, safeStorage },
      {
        kind: 'claude-code',
        mode: 'cli',
        executablePath: '/usr/bin/claude'
      }
    )

    expect(await getProviderSettings({ database, safeStorage })).toEqual({
      kind: 'claude-code',
      mode: 'cli',
      executablePath: '/usr/bin/claude'
    })

    const rows = await database.select().from(schema.settings).all()

    expect(rows.find((row) => row.key === 'provider.codex.mode')).toBeUndefined()
    expect(
      rows.find((row) => row.key === 'provider.codex.binaryPath')
    ).toBeUndefined()
  })

  test('persists Claude Code CLI mode with an executable path', async () => {
    await setProviderSettings(
      { database, safeStorage },
      {
        kind: 'claude-code',
        mode: 'cli',
        executablePath: '/opt/claude/bin/claude'
      }
    )

    expect(await getProviderSettings({ database, safeStorage })).toEqual({
      kind: 'claude-code',
      mode: 'cli',
      executablePath: '/opt/claude/bin/claude'
    })
    expect(await getProviderSettingsSummary({ database, safeStorage })).toEqual({
      kind: 'claude-code',
      mode: 'cli',
      executablePath: '/opt/claude/bin/claude'
    })
  })

  test('persists Claude Code CLI mode without an executable path', async () => {
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'claude-code', mode: 'cli' }
    )

    expect(await getProviderSettings({ database, safeStorage })).toEqual({
      kind: 'claude-code',
      mode: 'cli',
      executablePath: null
    })
  })

  test('persists Claude Code API mode with an encrypted key', async () => {
    await setProviderSettings(
      { database, safeStorage },
      {
        kind: 'claude-code',
        mode: 'api',
        apiKey: 'sk-ant-secret'
      }
    )

    expect(await getProviderSettings({ database, safeStorage })).toEqual({
      kind: 'claude-code',
      mode: 'api',
      apiKey: 'sk-ant-secret'
    })
    expect(await getProviderSettingsSummary({ database, safeStorage })).toEqual({
      kind: 'claude-code',
      mode: 'api',
      hasApiKey: true
    })

    const rows = await database.select().from(schema.settings).all()
    const apiKeyRow = rows.find(
      (row) => row.key === 'provider.claude-code.apiKeyEncrypted'
    )

    expect(apiKeyRow).toBeDefined()
    expect(apiKeyRow?.value).not.toContain('sk-ant-secret')
  })

  test('clearProviderSettings removes all provider rows', async () => {
    await setProviderSettings(
      { database, safeStorage },
      { kind: 'codex', mode: 'api', apiKey: 'sk-x' }
    )

    await clearProviderSettings({ database, safeStorage })

    expect(await getProviderSettings({ database, safeStorage })).toEqual(null)
  })

  test('refuses to save an API key when encryption is unavailable', async () => {
    const unavailable = createFakeSafeStorage(false)

    await expect(
      setProviderSettings(
        { database, safeStorage: unavailable },
        { kind: 'codex', mode: 'api', apiKey: 'sk-x' }
      )
    ).rejects.toThrow(/encryption is not available/i)

    await expect(
      setProviderSettings(
        { database, safeStorage: unavailable },
        { kind: 'claude-code', mode: 'api', apiKey: 'sk-ant-x' }
      )
    ).rejects.toThrow(/encryption is not available/i)
  })

  test('allows CLI mode even when encryption is unavailable', async () => {
    const unavailable = createFakeSafeStorage(false)

    await expect(
      setProviderSettings(
        { database, safeStorage: unavailable },
        { kind: 'codex', mode: 'cli' }
      )
    ).resolves.not.toThrow()

    await expect(
      setProviderSettings(
        { database, safeStorage: unavailable },
        { kind: 'claude-code', mode: 'cli' }
      )
    ).resolves.not.toThrow()
  })

  test('reads legacy Codex settings without provider.kind as kind=codex', async () => {
    await database
      .insert(schema.settings)
      .values([
        { key: 'provider.codex.mode', value: 'cli', updatedAt: new Date() },
        {
          key: 'provider.codex.binaryPath',
          value: '/usr/bin/codex',
          updatedAt: new Date()
        }
      ])
      .run()

    expect(await getProviderSettings({ database, safeStorage })).toEqual({
      kind: 'codex',
      mode: 'cli',
      binaryPath: '/usr/bin/codex'
    })
  })
})
