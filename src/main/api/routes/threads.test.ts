import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
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

const seedProjectThread = (database: TestDatabase, projectId: string) => {
  const [thread] = database
    .insert(schema.threads)
    .values({
      taskId: null,
      projectId,
      worktreePath: '/home/u/Code/example',
      branchName: 'main',
      baseBranch: null,
      status: 'running'
    })
    .returning()
    .all()

  invariant(thread, 'project thread missing')

  return thread
}

type FakeRunnerState = {
  startCalls: string[]
  startProjectCalls: Array<{ projectId: string; text: string }>
  continueCalls: Array<{ threadId: string; text: string }>
  mergeCalls: string[]
  threadId: string | null
  projectThreadId: string | null
  mergeError: Error | null
  startProjectError: Error | null
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
  startProjectThread: async (projectId, text) => {
    state.startProjectCalls.push({ projectId, text })

    if (state.startProjectError) throw state.startProjectError

    const thread = seedProjectThread(database, projectId)

    state.projectThreadId = thread.id

    return { threadId: thread.id }
  },
  continueThread: async (threadId, text) => {
    state.continueCalls.push({ threadId, text })
  },
  recoverOrphanedThreads: () => undefined,
  mergeTask: async (taskId) => {
    state.mergeCalls.push(taskId)

    if (state.mergeError) throw state.mergeError

    database
      .update(schema.tasks)
      .set({ status: 'done', agentState: 'idle' })
      .where(eq(schema.tasks.id, taskId))
      .run()

    return { mergeCommitSha: 'deadbeef', autoCommitted: false }
  }
})

describe('threads routes', () => {
  let database: TestDatabase
  let broker: EventBroker<PersistedEvent>
  let runnerState: FakeRunnerState
  let runner: AgentRunner

  beforeEach(() => {
    database = createTestDatabase()
    broker = createEventBroker<PersistedEvent>()
    runnerState = {
      startCalls: [],
      startProjectCalls: [],
      continueCalls: [],
      mergeCalls: [],
      threadId: null,
      projectThreadId: null,
      mergeError: null,
      startProjectError: null
    }
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

  test('GET /tasks/:taskId/threads returns threads for the task, newest first', async () => {
    const { task } = seedProjectAndTask(database)

    const older = seedThread(database, task.id)
    const newer = seedThread(database, task.id)

    // Ensure strict createdAt ordering regardless of insert speed.
    database
      .update(schema.threads)
      .set({ createdAt: new Date(1_000) })
      .where(eq(schema.threads.id, older.id))
      .run()
    database
      .update(schema.threads)
      .set({ createdAt: new Date(2_000) })
      .where(eq(schema.threads.id, newer.id))
      .run()

    const response = await buildRoutes().request(`/tasks/${task.id}/threads`)

    expect(response.status).toEqual(200)

    const body = (await response.json()) as {
      threads: Array<{ id: string }>
    }

    expect(body.threads.map((thread) => thread.id)).toEqual([
      newer.id,
      older.id
    ])
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

  test('POST /tasks/:taskId/merge calls mergeTask and returns the result', async () => {
    const { task } = seedProjectAndTask(database)

    seedThread(database, task.id)

    const response = await buildRoutes().request(`/tasks/${task.id}/merge`, {
      method: 'POST'
    })

    expect(response.status).toEqual(200)

    const body = (await response.json()) as {
      merge: { mergeCommitSha: string | null; autoCommitted: boolean }
    }

    expect(body.merge.mergeCommitSha).toEqual('deadbeef')
    expect(runnerState.mergeCalls).toEqual([task.id])
  })

  test('POST /tasks/:taskId/merge surfaces runner errors as 400', async () => {
    const { task } = seedProjectAndTask(database)

    runnerState.mergeError = new Error('merge conflict in src/x.ts')

    const response = await buildRoutes().request(`/tasks/${task.id}/merge`, {
      method: 'POST'
    })

    expect(response.status).toEqual(400)

    const body = (await response.json()) as { error: string }

    expect(body.error).toMatch(/merge conflict/i)
  })

  test('POST /projects/:projectId/threads calls startProjectThread', async () => {
    const { project } = seedProjectAndTask(database)

    const response = await buildRoutes().request(
      `/projects/${project.id}/threads`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'list files' })
      }
    )

    expect(response.status).toEqual(201)

    const body = (await response.json()) as {
      thread: { id: string; projectId: string; taskId: string | null }
    }

    expect(body.thread.id).toEqual(runnerState.projectThreadId)
    expect(body.thread.projectId).toEqual(project.id)
    expect(body.thread.taskId).toBeNull()
    expect(runnerState.startProjectCalls).toEqual([
      { projectId: project.id, text: 'list files' }
    ])
  })

  test('POST /projects/:projectId/threads returns 500 when runner throws', async () => {
    const { project } = seedProjectAndTask(database)

    runnerState.startProjectError = new Error('no provider')

    const response = await buildRoutes().request(
      `/projects/${project.id}/threads`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hi' })
      }
    )

    expect(response.status).toEqual(500)

    const body = (await response.json()) as { error: string }

    expect(body.error).toEqual('no provider')
  })

  test('GET /projects/:projectId/threads returns only project-scoped threads', async () => {
    const { project, task } = seedProjectAndTask(database)

    const taskThread = seedThread(database, task.id)
    const projectThread = seedProjectThread(database, project.id)

    const response = await buildRoutes().request(
      `/projects/${project.id}/threads`
    )

    expect(response.status).toEqual(200)

    const body = (await response.json()) as {
      threads: Array<{ id: string }>
    }

    const ids = body.threads.map((thread) => thread.id)

    expect(ids).toContain(projectThread.id)
    expect(ids).not.toContain(taskThread.id)
  })
})
