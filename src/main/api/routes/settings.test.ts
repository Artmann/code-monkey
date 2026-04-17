import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'

import type { SafeStorageLike } from '../../codex/provider-settings'
import * as schema from '../../database/schema'
import { createSettingsRoutes } from './settings'

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

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

    if (!text.startsWith('enc:')) throw new Error('bad ciphertext')

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

describe('settings routes', () => {
  let database: TestDatabase
  let safeStorage: SafeStorageLike

  beforeEach(() => {
    database = createTestDatabase()
    safeStorage = createFakeSafeStorage()
  })

  const buildRoutes = () => createSettingsRoutes({ database, safeStorage })

  test('GET /provider returns null when nothing is configured', async () => {
    const response = await buildRoutes().request('/provider')

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ provider: null })
  })

  test('POST /provider saves CLI mode', async () => {
    const response = await buildRoutes().request('/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'cli', binaryPath: '/usr/bin/codex' })
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      provider: { mode: 'cli', binaryPath: '/usr/bin/codex' }
    })

    const follow = await buildRoutes().request('/provider')

    expect(await follow.json()).toEqual({
      provider: { mode: 'cli', binaryPath: '/usr/bin/codex' }
    })
  })

  test('POST /provider saves API mode and never echoes the key', async () => {
    const response = await buildRoutes().request('/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'api', apiKey: 'sk-secret' })
    })

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({
      provider: { mode: 'api', hasApiKey: true }
    })

    const follow = await buildRoutes().request('/provider')

    expect(await follow.json()).toEqual({
      provider: { mode: 'api', hasApiKey: true }
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
