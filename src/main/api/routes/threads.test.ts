import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import invariant from 'tiny-invariant'

import type { AgentRunner, PersistedEvent } from '../../codex/agent-runner'
import {
  createEventBroker,
  type EventBroker
} from '../../codex/event-broker'
import * as schema from '../../database/schema'
import { createThreadsRoutes } from './threads'

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

const migrationsFolder = resolve(
  __dirname,
  '..',
  '..',
  'database',
  'migrations'
)

const createTestDatabase = (): TestDatabase => {
  const sqlite = new Database(':memory:')

  sqlite.pragma('foreign_keys = ON')

  const database = drizzle(sqlite, { schema })

  migrate(database, { migrationsFolder })

  return database
}

const seedProjectAndTask = (database: TestDatabase) => {
  const [project] = database
    .insert(schema.projects)
    .values({ name: 'Example', directoryPath: '/home/u/Code/example' })
    .returning()
    .all()

  invariant(project, 'project missing')

  const [task] = database
    .insert(schema.tasks)
    .values({
      projectId: project.id,
      title: 'Fix the bug'
    })
    .returning()
    .all()

  invariant(task, 'task missing')

  return { project, task }
}

const seedThread = (database: TestDatabase, taskId: string) => {
  const [thread] = database
    .insert(schema.threads)
    .values({
      taskId,
      worktreePath: '/tmp/wt',
      branchName: 'code-monkey/abc',
      baseBranch: 'main',
      status: 'running'
    })
    .returning()
    .all()

  invariant(thread, 'thread missing')

  return thread
}

const seedEvent = (
  database: TestDatabase,
  threadId: string,
  sequence: number,
  type: string,
  payload: unknown
) => {
  database
    .insert(schema.threadEvents)
    .values({
      threadId,
      sequence,
      type,
      payload: JSON.stringify(payload)
    })
    .run()
}

type FakeRunnerState = {
  startCalls: string[]
  continueCalls: Array<{ threadId: string; text: string }>
  threadId: string | null
}

const createFakeRunner = (
  database: TestDatabase,
  state: FakeRunnerState
): AgentRunner => ({
  start: async (taskId) => {
    state.startCalls.push(taskId)

    const thread = seedThread(database, taskId)

    state.threadId = thread.id

    return { threadId: thread.id }
  },
  continueThread: async (threadId, text) => {
    state.continueCalls.push({ threadId, text })
  },
  recoverOrphanedThreads: () => undefined
})

describe('threads routes', () => {
  let database: TestDatabase
  let broker: EventBroker<PersistedEvent>
  let runnerState: FakeRunnerState
  let runner: AgentRunner

  beforeEach(() => {
    database = createTestDatabase()
    broker = createEventBroker<PersistedEvent>()
    runnerState = { startCalls: [], continueCalls: [], threadId: null }
    runner = createFakeRunner(database, runnerState)
  })

  const buildRoutes = () =>
    createThreadsRoutes({ database, broker, runner })

  test('POST /tasks/:taskId/threads starts a thread via the runner', async () => {
    const { task } = seedProjectAndTask(database)
    const response = await buildRoutes().request(
      `/tasks/${task.id}/threads`,
      { method: 'POST' }
    )

    expect(response.status).toEqual(201)

    const body = (await response.json()) as { thread: { id: string } }

    expect(body.thread.id).toEqual(runnerState.threadId)
    expect(runnerState.startCalls).toEqual([task.id])
  })

  test('POST /tasks/:taskId/threads returns 500 when the runner throws', async () => {
    runner = {
      ...runner,
      start: async () => {
        throw new Error('no provider')
      }
    }

    const { task } = seedProjectAndTask(database)
    const response = await buildRoutes().request(
      `/tasks/${task.id}/threads`,
      { method: 'POST' }
    )

    expect(response.status).toEqual(500)

    const body = await response.json()

    expect(body).toEqual({ error: 'no provider' })
  })

  test('GET /threads/:id returns the thread row and its events', async () => {
    const { task } = seedProjectAndTask(database)
    const thread = seedThread(database, task.id)

    seedEvent(database, thread.id, 0, 'prep', { message: 'starting' })
    seedEvent(database, thread.id, 1, 'item.completed', {
      item: { type: 'agent_message', id: 'm1', text: 'hello' }
    })

    const response = await buildRoutes().request(`/threads/${thread.id}`)

    expect(response.status).toEqual(200)

    const body = (await response.json()) as {
      thread: { id: string; status: string }
      events: Array<{ sequence: number; type: string; payload: unknown }>
    }

    expect(body.thread.id).toEqual(thread.id)
    expect(body.thread.status).toEqual('running')
    expect(body.events.map((event) => event.type)).toEqual([
      'prep',
      'item.completed'
    ])
    expect(body.events.map((event) => event.sequence)).toEqual([0, 1])
    expect(body.events.at(0)?.payload).toEqual({ message: 'starting' })
  })

  test('GET /threads/:id returns 404 for an unknown thread', async () => {
    const response = await buildRoutes().request(
      '/threads/00000000-0000-0000-0000-000000000000'
    )

    expect(response.status).toEqual(404)
  })

  test('POST /threads/:id/messages calls continueThread', async () => {
    const { task } = seedProjectAndTask(database)
    const thread = seedThread(database, task.id)

    const response = await buildRoutes().request(
      `/threads/${thread.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'keep going' })
      }
    )

    expect(response.status).toEqual(202)
    expect(runnerState.continueCalls).toEqual([
      { threadId: thread.id, text: 'keep going' }
    ])
  })

  test('POST /threads/:id/messages returns 404 for an unknown thread', async () => {
    const response = await buildRoutes().request(
      '/threads/00000000-0000-0000-0000-000000000000/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hi' })
      }
    )

    expect(response.status).toEqual(404)
  })

  test('GET /threads/:id/stream opens an SSE connection and pushes events', async () => {
    const { task } = seedProjectAndTask(database)
    const thread = seedThread(database, task.id)

    const response = await buildRoutes().request(
      `/threads/${thread.id}/stream`
    )

    expect(response.status).toEqual(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const readable = response.body

    invariant(readable, 'no response body')

    const reader = readable.getReader()
    const decoder = new TextDecoder()

    const readNextChunk = async (timeoutMs = 1_000) => {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('timed out waiting for SSE chunk')),
            timeoutMs
          )
        )
      ])

      if (chunk.done || !chunk.value) return null

      return decoder.decode(chunk.value)
    }

    broker.publish(thread.id, {
      id: 'e1',
      threadId: thread.id,
      sequence: 7,
      type: 'item.completed',
      payload: { hello: 'world' },
      createdAt: new Date(0)
    })

    const text = await readNextChunk()

    expect(text).toContain('event: item.completed')
    expect(text).toContain('"sequence":7')

    await reader.cancel()
  })
})
