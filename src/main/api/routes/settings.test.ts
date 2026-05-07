import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { SafeStorageLike } from '../../codex/provider-settings'
import * as schema from '../../database/schema'
import { createSettingsRoutes } from './settings'

type TestDatabase = LibSQLDatabase<typeof schema>

const migrationsFolder = resolve(
  __dirname,
  '..',
  '..',
  'database',
  'migrations'
)

const createFakeSafeStorage = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`enc:${plain}`, 'utf8'),
  decryptString: (buffer) => {
    const text = buffer.toString('utf8')

    if (!text.startsWith('enc:')) {
      throw new Error('bad ciphertext')
    }

    return text.slice('enc:'.length)
  }
})

const createTestDatabase = async (
  databaseFilePath: string
): Promise<{ database: TestDatabase; client: Client }> => {
  const client = createClient({ url: `file:${databaseFilePath}` })

  await client.execute('PRAGMA foreign_keys = ON')

  const database = drizzle(client, { schema })

  await migrate(database, { migrationsFolder })

  return { database, client }
}

describe('settings routes', () => {
  let database: TestDatabase
  let client: Client
  let safeStorage: SafeStorageLike
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'code-monkey-test-'))

    ;({ database, client } = await createTestDatabase(
      join(temporaryDirectory, 'test.db')
    ))
    safeStorage = createFakeSafeStorage()
  })

  // The libsql native binding holds the sqlite file handle longer than the
  // synchronous close() call admits to on Windows, so rmSync can race with the
  // OS releasing the lock. Best-effort: close the client, retry the unlink,
  // and swallow EPERM — the directory lives in OS tmp and is reaped anyway.
  afterEach(() => {
    client.close()
    try {
      rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY') {
        throw error
      }
    }
  })

  const buildRoutes = () => createSettingsRoutes({ database, safeStorage })

  test('GET /provider returns null when nothing is configured', async () => {
    const response = await buildRoutes().request('/provider')

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ provider: null })
  })

  test('POST /provider saves Codex CLI mode (kind defaults to codex)', async () => {
    const response = await buildRoutes().request('/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'cli', binaryPath: '/usr/bin/codex' })
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      provider: { kind: 'codex', mode: 'cli', binaryPath: '/usr/bin/codex' }
    })

    const follow = await buildRoutes().request('/provider')

    expect(await follow.json()).toEqual({
      provider: { kind: 'codex', mode: 'cli', binaryPath: '/usr/bin/codex' }
    })
  })

  test('POST /provider saves Codex API mode and never echoes the key', async () => {
    const response = await buildRoutes().request('/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'codex',
        mode: 'api',
        apiKey: 'sk-secret'
      })
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      provider: { kind: 'codex', mode: 'api', hasApiKey: true }
    })

    const follow = await buildRoutes().request('/provider')

    expect(await follow.json()).toEqual({
      provider: { kind: 'codex', mode: 'api', hasApiKey: true }
    })
  })

  test('POST /provider saves Claude Code CLI mode with an executable path', async () => {
    const response = await buildRoutes().request('/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'claude-code',
        mode: 'cli',
        executablePath: '/opt/claude/bin/claude'
      })
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      provider: {
        kind: 'claude-code',
        mode: 'cli',
        executablePath: '/opt/claude/bin/claude'
      }
    })
  })

  test('POST /provider saves Claude Code API mode', async () => {
    const response = await buildRoutes().request('/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'claude-code',
        mode: 'api',
        apiKey: 'sk-ant-secret'
      })
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      provider: { kind: 'claude-code', mode: 'api', hasApiKey: true }
    })
  })

  test('POST /provider rejects invalid payloads with 400', async () => {
    const response = await buildRoutes().request('/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'bogus' })
    })

    expect(response.status).toEqual(400)
  })

  test('POST /provider with API mode refuses when encryption is unavailable', async () => {
    safeStorage = createFakeSafeStorage(false)

    const response = await buildRoutes().request('/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'api', apiKey: 'sk-secret' })
    })

    expect(response.status).toEqual(400)

    const body = await response.json()

    expect(body).toEqual({
      error: expect.stringMatching(/encryption is not available/i)
    })
  })

  test('DELETE /provider clears the configuration', async () => {
    await buildRoutes().request('/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'cli', binaryPath: '/usr/bin/codex' })
    })

    const deleteResponse = await buildRoutes().request('/provider', {
      method: 'DELETE'
    })

    expect(deleteResponse.status).toEqual(200)

    const follow = await buildRoutes().request('/provider')

    expect(await follow.json()).toEqual({ provider: null })
  })
})
