import Database from 'better-sqlite3'
import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

import invariant from 'tiny-invariant'

import * as schema from '../database/schema'
import {
  createAgentRunner,
  type AgentRunnerCodex,
  type AgentRunnerThread,
  type PersistedEvent
} from './agent-runner'
import { createEventBroker, type EventBroker } from './event-broker'
import type { ProviderSettings } from './provider-settings'
import type { CreatedWorktree } from './worktree'

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

type FakeEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage?: unknown }
  | { type: 'turn.failed'; error: { message: string } }
  | {
      type: 'item.started' | 'item.updated' | 'item.completed'
      item: unknown
    }
  | { type: 'error'; message: string }

const migrationsFolder = resolve(__dirname, '..', 'database', 'migrations')

const createEventChannel = () => {
  const buffer: FakeEvent[] = []
  const waiters: Array<(value: IteratorResult<FakeEvent>) => void> = []
  let closed = false

  const notifyClose = () => {
    while (waiters.length > 0) {
      const resolutionHandler = waiters.shift()

      if (resolutionHandler) {
        resolutionHandler({ value: undefined, done: true })
      }
    }
  }

  return {
    push: (event: FakeEvent) => {
      const resolutionHandler = waiters.shift()

      if (resolutionHandler) {
        resolutionHandler({ value: event, done: false })

        return
      }

      buffer.push(event)
    },
    close: () => {
      closed = true
      notifyClose()
    },
    iterable: {
      [Symbol.asyncIterator]: (): AsyncIterator<FakeEvent> => ({
        next: () => {
          const next = buffer.shift()

          if (next !== undefined) {
            return Promise.resolve({ value: next, done: false })
          }

          if (closed) {
            return Promise.resolve({ value: undefined, done: true })
          }

          return new Promise((resolutionHandler) => {
            waiters.push(resolutionHandler)
          })
        }
      })
    } as AsyncIterable<FakeEvent>
  }
}

type FakeThread = {
  readonly handle: AgentRunnerThread
  options: { workingDirectory?: string; skipGitRepoCheck?: boolean }
  inputs: string[]
  emit: (event: FakeEvent) => void
  close: () => void
  setId: (id: string) => void
}

const createFakeThread = (
  options: { workingDirectory?: string; skipGitRepoCheck?: boolean },
  resumedFromId: string | null = null
): FakeThread => {
  const channel = createEventChannel()
  let id: string | null = resumedFromId
  const inputs: string[] = []

  const handle: AgentRunnerThread = {
    get id() {
      return id
    },
    runStreamed: async (input) => {
      inputs.push(typeof input === 'string' ? input : JSON.stringify(input))

      return { events: channel.iterable as AsyncIterable<unknown> }
    }
  }

  return {
    handle,
    options,
    inputs,
    emit: (event) => {
      if (event.type === 'thread.started') {
        id = event.thread_id
      }

      channel.push(event)
    },
    close: channel.close,
    setId: (value: string) => {
      id = value
    }
  }
}

type FakeCodexRegistry = {
  threads: FakeThread[]
  codex: AgentRunnerCodex
}

const createFakeCodex = (): FakeCodexRegistry => {
  const threads: FakeThread[] = []

  const codex: AgentRunnerCodex = {
    startThread: (options) => {
      const thread = createFakeThread(options ?? {})

      threads.push(thread)

      return thread.handle
    },
    resumeThread: (threadId, options) => {
      const thread = createFakeThread(options ?? {}, threadId)

      threads.push(thread)

      return thread.handle
    }
  }

  return { threads, codex }
}

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
    .values({
      name: 'Example',
      directoryPath: '/home/u/Code/example'
    })
    .returning()
    .all()

  invariant(project, 'seeded project missing')

  const [task] = database
    .insert(schema.tasks)
    .values({
      projectId: project.id,
      title: 'Fix the bug',
      description: 'Something is broken'
    })
    .returning()
    .all()

  invariant(task, 'seeded task missing')

  return { project, task }
}

const waitFor = async (
  predicate: () => boolean,
  { timeout = 1_000, interval = 5 } = {}
) => {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolutionHandler) =>
      setTimeout(resolutionHandler, interval)
    )
  }

  throw new Error(`waitFor: predicate never became true within ${timeout}ms`)
}

type Harness = {
  database: TestDatabase
  threads: FakeThread[]
  broker: EventBroker<PersistedEvent>
  runner: ReturnType<typeof createAgentRunner>
  providerSettings: { current: ProviderSettings | null }
  worktreeCreations: Array<{
    project: { id: string; directoryPath: string }
    task: { id: string }
  }>
}

const createHarness = (): Harness => {
  const database = createTestDatabase()
  const fake = createFakeCodex()
  const broker = createEventBroker<PersistedEvent>()
  const providerSettings: { current: ProviderSettings | null } = {
    current: { mode: 'cli', binaryPath: null }
  }
  const creations: Harness['worktreeCreations'] = []

  const defaultCreate = async (args: {
    project: { id: string; directoryPath: string }
    task: { id: string }
  }): Promise<CreatedWorktree> => ({
    path: `${args.project.directoryPath}.worktrees/t_${args.task.id.slice(0, 8)}`,
    branch: `code-monkey/${args.task.id}`,
    baseBranch: 'main'
  })

  const runner = createAgentRunner({
    database,
    broker,
    createCodex: () => fake.codex,
    providerSettings: () => providerSettings.current,
    worktree: {
      create: async (args) => {
        creations.push(args)

        return defaultCreate(args)
      },
      remove: async () => undefined
    }
  })

  return {
    database,
    threads: fake.threads,
    broker,
    runner,
    providerSettings,
    worktreeCreations: creations
  }
}

const getThreadEvents = (database: TestDatabase, threadId: string) =>
  database
    .select()
    .from(schema.threadEvents)
    .where(eq(schema.threadEvents.threadId, threadId))
    .orderBy(asc(schema.threadEvents.sequence))
    .all()

const getThreadRow = (database: TestDatabase, threadId: string) =>
  database
    .select()
    .from(schema.threads)
    .where(eq(schema.threads.id, threadId))
    .get()

const getTaskRow = (database: TestDatabase, taskId: string) =>
  database
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get()

describe('createAgentRunner', () => {
  describe('start', () => {
    test('throws when no provider is configured', async () => {
      const harness = createHarness()

      harness.providerSettings.current = null

      const { task } = seedProjectAndTask(harness.database)

      await expect(harness.runner.start(task.id)).rejects.toThrow(
        /codex.*not configured|provider.*not configured/i
      )
    })

    test('throws when the task does not exist', async () => {
      const harness = createHarness()

      await expect(
        harness.runner.start('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/task.*not found/i)
    })

    test('creates worktree, thread row, prep event, and flips task state', async () => {
      const harness = createHarness()
      const { project, task } = seedProjectAndTask(harness.database)

      const result = await harness.runner.start(task.id)

      expect(harness.worktreeCreations).toHaveLength(1)
      expect(harness.worktreeCreations.at(0)?.task.id).toEqual(task.id)
      expect(harness.worktreeCreations.at(0)?.project.id).toEqual(project.id)

      const thread = getThreadRow(harness.database, result.threadId)

      expect(thread?.taskId).toEqual(task.id)
      expect(thread?.status).toEqual('running')
      expect(thread?.worktreePath).toContain(`t_${task.id.slice(0, 8)}`)
      expect(thread?.branchName).toEqual(`code-monkey/${task.id}`)
      expect(thread?.baseBranch).toEqual('main')

      const events = getThreadEvents(harness.database, result.threadId)

      expect(events).toHaveLength(1)
      expect(events.at(0)?.type).toEqual('prep')
      expect(events.at(0)?.sequence).toEqual(0)

      const updatedTask = getTaskRow(harness.database, task.id)

      expect(updatedTask?.status).toEqual('in_progress')
      expect(updatedTask?.agentState).toEqual('working')
    })

    test('passes the worktree path as workingDirectory to the SDK', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      await harness.runner.start(task.id)
      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')

      expect(fakeThread.options.workingDirectory).toContain(
        `t_${task.id.slice(0, 8)}`
      )
      expect(fakeThread.options.skipGitRepoCheck).toEqual(false)
    })

    test('sends task title + description as the first run input', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      await harness.runner.start(task.id)
      await waitFor(() => harness.threads.at(0)?.inputs.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')
      expect(fakeThread.inputs.at(0)).toEqual(
        'Fix the bug\n\nSomething is broken'
      )
    })

    test('captures codex thread id from the thread.started event', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')
      fakeThread.emit({
        type: 'thread.started',
        thread_id: 'codex-xyz'
      })

      await waitFor(
        () =>
          getThreadRow(harness.database, threadId)?.codexThreadId ===
          'codex-xyz'
      )
    })

    test('persists streamed events and publishes them through the broker', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)
      const received: PersistedEvent[] = []

      const { threadId } = await harness.runner.start(task.id)

      harness.broker.subscribe(threadId, (event) => received.push(event))

      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')
      fakeThread.emit({
        type: 'thread.started',
        thread_id: 'codex-xyz'
      })
      fakeThread.emit({
        type: 'item.completed',
        item: { type: 'agent_message', id: 'i1', text: 'hi there' }
      })

      await waitFor(
        () => getThreadEvents(harness.database, threadId).length >= 3
      )

      const events = getThreadEvents(harness.database, threadId)

      expect(events.map((event) => event.type)).toEqual([
        'prep',
        'thread.started',
        'item.completed'
      ])
      expect(events.map((event) => event.sequence)).toEqual([0, 1, 2])
      expect(received.map((event) => event.type)).toContain('item.completed')
    })

    test('on turn.completed flips thread to idle and task agentState to done', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')
      fakeThread.emit({ type: 'thread.started', thread_id: 'c1' })
      fakeThread.emit({ type: 'turn.completed' })

      await waitFor(
        () => getThreadRow(harness.database, threadId)?.status === 'idle'
      )

      const updatedTask = getTaskRow(harness.database, task.id)

      expect(updatedTask?.agentState).toEqual('done')
      expect(updatedTask?.status).toEqual('in_progress')
    })

    test('on error event flips thread to error and task agentState back to idle', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')
      fakeThread.emit({ type: 'error', message: 'kaboom' })

      await waitFor(
        () => getThreadRow(harness.database, threadId)?.status === 'error'
      )

      const thread = getThreadRow(harness.database, threadId)

      expect(thread?.errorMessage).toEqual('kaboom')

      const updatedTask = getTaskRow(harness.database, task.id)

      expect(updatedTask?.agentState).toEqual('idle')
    })
  })

  describe('continueThread', () => {
    test('resumes the codex thread and streams new events', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)

      const [firstThread] = harness.threads

      invariant(firstThread, 'first thread missing')
      firstThread.emit({ type: 'thread.started', thread_id: 'codex-1' })
      firstThread.emit({ type: 'turn.completed' })

      await waitFor(
        () => getThreadRow(harness.database, threadId)?.status === 'idle'
      )

      await harness.runner.continueThread(threadId, 'also add tests')
      await waitFor(() => harness.threads.length === 2)

      const secondThread = harness.threads.at(1)

      invariant(secondThread, 'second thread missing')
      expect(secondThread.inputs.at(0)).toEqual('also add tests')
      expect(secondThread.handle.id).toEqual('codex-1')
    })

    test('throws when the thread does not exist', async () => {
      const harness = createHarness()

      await expect(
        harness.runner.continueThread(
          '00000000-0000-0000-0000-000000000000',
          'hi'
        )
      ).rejects.toThrow(/thread.*not found/i)
    })
  })

  describe('recoverOrphanedThreads', () => {
    test('flips running/starting threads to error and appends a synthetic event', async () => {
      const harness = createHarness()
      const { project, task } = seedProjectAndTask(harness.database)

      const [runningRow] = harness.database
        .insert(schema.threads)
        .values({
          taskId: task.id,
          worktreePath: `${project.directoryPath}.worktrees/t_abc`,
          branchName: `code-monkey/${task.id}`,
          baseBranch: 'main',
          status: 'running'
        })
        .returning()
        .all()

      invariant(runningRow, 'seeded running row missing')

      const [startingRow] = harness.database
        .insert(schema.threads)
        .values({
          taskId: task.id,
          worktreePath: `${project.directoryPath}.worktrees/t_def`,
          branchName: `code-monkey/${task.id}-b`,
          baseBranch: 'main',
          status: 'starting'
        })
        .returning()
        .all()

      invariant(startingRow, 'seeded starting row missing')

      harness.runner.recoverOrphanedThreads()

      expect(getThreadRow(harness.database, runningRow.id)?.status).toEqual(
        'error'
      )
      expect(getThreadRow(harness.database, startingRow.id)?.status).toEqual(
        'error'
      )

      const runningEvents = getThreadEvents(harness.database, runningRow.id)
      const startingEvents = getThreadEvents(harness.database, startingRow.id)

      expect(runningEvents.at(-1)?.type).toEqual('error')
      expect(startingEvents.at(-1)?.type).toEqual('error')
    })
  })
})
