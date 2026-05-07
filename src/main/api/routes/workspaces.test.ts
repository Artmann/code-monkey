import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import * as schema from '../../database/schema'
import { createWorkspacesRoutes } from './workspaces'

type TestDatabase = LibSQLDatabase<typeof schema>

const migrationsFolder = resolve(
  __dirname,
  '..',
  '..',
  'database',
  'migrations'
)

const seededWorkspaceId = '00000000-0000-4000-8000-000000000001'

const createTestDatabase = async (
  databaseFilePath: string
): Promise<{ database: TestDatabase; client: Client }> => {
  const client = createClient({ url: `file:${databaseFilePath}` })

  await client.execute('PRAGMA foreign_keys = ON')

  const database = drizzle(client, { schema })

  await migrate(database, { migrationsFolder })

  return { database, client }
}

describe('workspaces routes', () => {
  let database: TestDatabase
  let client: Client
  let temporaryDirectory: string

  beforeEach(async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'code-monkey-test-'))

    ;({ database, client } = await createTestDatabase(
      join(temporaryDirectory, 'test.db')
    ))
  })

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

  const buildRoutes = () => createWorkspacesRoutes({ database })

  const requestJson = async (
    method: string,
    path: string,
    body?: unknown
  ) => {
    const response = await buildRoutes().request(path, {
      method,
      headers: body
        ? { 'content-type': 'application/json' }
        : { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    })

    const text = await response.text()
    const parsed = text.length > 0 ? JSON.parse(text) : null

    return { status: response.status, body: parsed }
  }

  test('GET / returns the seeded Personal workspace and its active id', async () => {
    const result = await requestJson('GET', '/')

    expect(result.status).toEqual(200)
    expect(result.body.activeWorkspaceId).toEqual(seededWorkspaceId)
    expect(result.body.workspaces).toEqual([
      expect.objectContaining({
        id: seededWorkspaceId,
        name: 'Personal',
        sortOrder: 0
      })
    ])
  })

  test('POST / creates a workspace at the next sort order', async () => {
    const created = await requestJson('POST', '/', { name: 'Work' })

    expect(created.status).toEqual(201)
    expect(created.body.workspace).toEqual(
      expect.objectContaining({ name: 'Work', sortOrder: 1 })
    )

    const list = await requestJson('GET', '/')

    expect(list.body.workspaces).toHaveLength(2)
    expect(list.body.workspaces.map((ws: { name: string }) => ws.name)).toEqual([
      'Personal',
      'Work'
    ])
  })

  test('PATCH /:id renames a workspace', async () => {
    const created = await requestJson('POST', '/', { name: 'Work' })
    const id = created.body.workspace.id

    const renamed = await requestJson('PATCH', `/${id}`, { name: 'Day Job' })

    expect(renamed.status).toEqual(200)
    expect(renamed.body.workspace.name).toEqual('Day Job')
  })

  test('PATCH /:id stores lastActiveThreadId', async () => {
    const updated = await requestJson('PATCH', `/${seededWorkspaceId}`, {
      lastActiveThreadId: 'some-thread-id'
    })

    expect(updated.status).toEqual(200)
    expect(updated.body.workspace.lastActiveThreadId).toEqual('some-thread-id')
  })

  test('DELETE /:id refuses to remove the last workspace', async () => {
    const deleted = await requestJson('DELETE', `/${seededWorkspaceId}`)

    expect(deleted.status).toEqual(409)
    expect(deleted.body.error).toMatch(/last remaining/i)
  })

  test('DELETE /:id refuses when threads still reference the workspace', async () => {
    const created = await requestJson('POST', '/', { name: 'Work' })
    const workId = created.body.workspace.id

    await database
      .insert(schema.threads)
      .values({
        workspaceId: workId,
        name: 'tab',
        directoryPath: '/tmp/repo',
        status: 'idle',
        tabOrder: 0,
        createdAt: new Date(),
        lastActivityAt: new Date()
      })
      .run()

    const deleted = await requestJson('DELETE', `/${workId}`)

    expect(deleted.status).toEqual(409)
    expect(deleted.body.error).toMatch(/thread/i)
  })

  test('DELETE /:id removes empty workspace and reassigns active when needed', async () => {
    const created = await requestJson('POST', '/', { name: 'Throwaway' })
    const id = created.body.workspace.id

    await requestJson('POST', '/active', { workspaceId: id })

    const deleted = await requestJson('DELETE', `/${id}`)

    expect(deleted.status).toEqual(200)

    const list = await requestJson('GET', '/')

    expect(list.body.activeWorkspaceId).toEqual(seededWorkspaceId)
    expect(list.body.workspaces).toHaveLength(1)
  })

  test('POST /active updates the active workspace', async () => {
    const created = await requestJson('POST', '/', { name: 'Work' })
    const id = created.body.workspace.id

    const result = await requestJson('POST', '/active', { workspaceId: id })

    expect(result.status).toEqual(200)
    expect(result.body.activeWorkspaceId).toEqual(id)

    const list = await requestJson('GET', '/')

    expect(list.body.activeWorkspaceId).toEqual(id)
  })

  test('POST /active rejects unknown workspace ids', async () => {
    const result = await requestJson('POST', '/active', {
      workspaceId: 'does-not-exist'
    })

    expect(result.status).toEqual(404)
  })
})
