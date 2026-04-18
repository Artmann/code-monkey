import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import invariant from 'tiny-invariant'

import type { AgentRunner } from '../../codex/agent-runner'
import * as schema from '../../database/schema'
import { createTasksRoutes } from './tasks'

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

const seedProject = (database: TestDatabase) => {
  const [project] = database
    .insert(schema.projects)
    .values({ name: 'Example', directoryPath: '/home/u/Code/example' })
    .returning()
    .all()

  invariant(project, 'project missing')

  return project
}

const seedTask = (
  database: TestDatabase,
  projectId: string,
  overrides: Partial<typeof schema.tasks.$inferInsert> = {}
) => {
  const [task] = database
    .insert(schema.tasks)
    .values({
      projectId,
      title: overrides.title ?? 'Fix the bug',
      status: overrides.status ?? 'todo',
      sortOrder: overrides.sortOrder ?? 0,
      ...overrides
    })
    .returning()
    .all()

  invariant(task, 'task missing')

  return task
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

type FakeRunnerState = {
  startCalls: string[]
  startError: Error | null
}

const createFakeRunner = (
  database: TestDatabase,
  state: FakeRunnerState
): AgentRunner => ({
  start: async (taskId) => {
    state.startCalls.push(taskId)

    if (state.startError) throw state.startError

    const thread = seedThread(database, taskId)

    return { threadId: thread.id }
  },
  restartThread: async () => {
    throw new Error('not used in tasks tests')
  },
  startProjectThread: async () => {
    throw new Error('not used in tasks tests')
  },
  continueThread: async () => {
    // not used
  },
  recoverOrphanedThreads: () => undefined,
  mergeTask: async () => {
    throw new Error('not used in tasks tests')
  }
})

describe('tasks routes', () => {
  let database: TestDatabase
  let runnerState: FakeRunnerState
  let runner: AgentRunner

  beforeEach(() => {
    database = createTestDatabase()
    runnerState = { startCalls: [], startError: null }
    runner = createFakeRunner(database, runnerState)
  })

  const buildRoutes = () => createTasksRoutes({ database, runner })

  test('GET / returns tasks for a project ordered by sortOrder', async () => {
    const project = seedProject(database)

    const first = seedTask(database, project.id, {
      title: 'First',
      sortOrder: 0
    })
    const second = seedTask(database, project.id, {
      title: 'Second',
      sortOrder: 1
    })

    const response = await buildRoutes().request(
      `/?projectId=${encodeURIComponent(project.id)}`
    )

    expect(response.status).toEqual(200)

    const body = (await response.json()) as {
      tasks: Array<{ id: string; title: string }>
    }

    expect(body.tasks.map((task) => task.id)).toEqual([first.id, second.id])
  })

  test('POST / creates a task with the next sortOrder in its column', async () => {
    const project = seedProject(database)

    seedTask(database, project.id, { status: 'todo', sortOrder: 5 })

    const response = await buildRoutes().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        title: 'New task'
      })
    })

    expect(response.status).toEqual(201)

    const body = (await response.json()) as {
      task: { id: string; title: string; sortOrder: number; status: string }
    }

    expect(body.task.title).toEqual('New task')
    expect(body.task.status).toEqual('todo')
    expect(body.task.sortOrder).toEqual(6)
  })

  test('DELETE /:id soft-deletes the task', async () => {
    const project = seedProject(database)
    const task = seedTask(database, project.id)

    const response = await buildRoutes().request(`/${task.id}`, {
      method: 'DELETE'
    })

    expect(response.status).toEqual(200)

    const [row] = database
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, task.id))
      .all()

    expect(row?.deletedAt).not.toBeNull()
  })

  test('DELETE /:id returns 404 for an unknown id', async () => {
    const response = await buildRoutes().request('/does-not-exist', {
      method: 'DELETE'
    })

    expect(response.status).toEqual(404)
  })

  test('PATCH /:id to in_progress with no threads auto-starts the agent', async () => {
    const project = seedProject(database)
    const task = seedTask(database, project.id)

    const response = await buildRoutes().request(`/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' })
    })

    expect(response.status).toEqual(200)
    expect(runnerState.startCalls).toEqual([task.id])
  })

  test('PATCH /:id to in_progress skips auto-start when a thread exists', async () => {
    const project = seedProject(database)
    const task = seedTask(database, project.id)

    seedThread(database, task.id)

    const response = await buildRoutes().request(`/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' })
    })

    expect(response.status).toEqual(200)
    expect(runnerState.startCalls).toEqual([])
  })

  test('PATCH /:id to todo never auto-starts', async () => {
    const project = seedProject(database)
    const task = seedTask(database, project.id, { status: 'in_progress' })

    const response = await buildRoutes().request(`/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'todo' })
    })

    expect(response.status).toEqual(200)
    expect(runnerState.startCalls).toEqual([])
  })

  test('PATCH /:id returns 200 and preserves the status update even if auto-start throws', async () => {
    const project = seedProject(database)
    const task = seedTask(database, project.id)

    runnerState.startError = new Error('no provider configured')

    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const response = await buildRoutes().request(`/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' })
      })

      expect(response.status).toEqual(200)

      const body = (await response.json()) as { task: { status: string } }

      expect(body.task.status).toEqual('in_progress')
      expect(runnerState.startCalls).toEqual([task.id])
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('PATCH /:id returns 404 for an unknown id', async () => {
    const response = await buildRoutes().request('/does-not-exist', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'new title' })
    })

    expect(response.status).toEqual(404)
  })

  test('POST /reorder auto-starts only for rows newly promoted to in_progress', async () => {
    const project = seedProject(database)

    const promoted = seedTask(database, project.id, {
      title: 'Promoted',
      status: 'todo',
      sortOrder: 0
    })
    const alreadyRunning = seedTask(database, project.id, {
      title: 'Already running',
      status: 'in_progress',
      sortOrder: 0
    })
    const withThread = seedTask(database, project.id, {
      title: 'Has thread',
      status: 'todo',
      sortOrder: 1
    })
    const stayingTodo = seedTask(database, project.id, {
      title: 'Stays in todo',
      status: 'todo',
      sortOrder: 2
    })

    seedThread(database, withThread.id)

    const response = await buildRoutes().request('/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        updates: [
          { id: promoted.id, status: 'in_progress', sortOrder: 1 },
          { id: alreadyRunning.id, status: 'in_progress', sortOrder: 0 },
          { id: withThread.id, status: 'in_progress', sortOrder: 2 },
          { id: stayingTodo.id, status: 'todo', sortOrder: 0 }
        ]
      })
    })

    expect(response.status).toEqual(200)
    expect(runnerState.startCalls).toEqual([promoted.id])
  })

  test('POST /reorder still returns 200 when one auto-start fails', async () => {
    const project = seedProject(database)
    const task = seedTask(database, project.id, { status: 'todo' })

    runnerState.startError = new Error('no provider configured')

    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      const response = await buildRoutes().request('/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          updates: [{ id: task.id, status: 'in_progress', sortOrder: 0 }]
        })
      })

      expect(response.status).toEqual(200)
      expect(runnerState.startCalls).toEqual([task.id])
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
