import Database from 'better-sqlite3'
import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

import invariant from 'tiny-invariant'

import type {
  AgentProvider,
  AgentThread,
  AgentThreadOptions,
  NormalizedEvent
} from '../agents/provider'
import * as schema from '../database/schema'
import {
  createAgentRunner,
  type PersistedEvent
} from './agent-runner'
import { createEventBroker, type EventBroker } from './event-broker'
import type { MergeTaskInput, MergeTaskResult } from './merge'
import type { ProviderSettings } from './provider-settings'
import type { CreatedWorktree } from './worktree'

type TestDatabase = ReturnType<typeof drizzle<typeof schema>>

type FakeEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage?: unknown }
  | { type: 'turn.failed'; error: { message: string } }
  | {
      type:
        | 'item.started'
        | 'item.updated'
        | 'item.completed'
        | 'item.approval_requested'
        | 'item.approval_resolved'
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

type FakeThreadOptions = AgentThreadOptions

type FakeThread = {
  readonly handle: AgentThread
  options: FakeThreadOptions
  inputs: string[]
  emit: (event: FakeEvent) => void
  close: () => void
  setId: (id: string) => void
}

const createFakeThread = (
  options: FakeThreadOptions,
  resumedFromId: string | null = null
): FakeThread => {
  const channel = createEventChannel()
  let id: string | null = resumedFromId
  const inputs: string[] = []

  const handle: AgentThread = {
    get id() {
      return id
    },
    runStreamed: async (input) => {
      inputs.push(typeof input === 'string' ? input : JSON.stringify(input))

      return {
        events: channel.iterable as unknown as AsyncIterable<NormalizedEvent>
      }
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
  provider: AgentProvider
}

const createFakeCodex = (): FakeCodexRegistry => {
  const threads: FakeThread[] = []

  const provider: AgentProvider = {
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

  return { threads, provider }
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
  mergeCalls: MergeTaskInput[]
  mergeResult: { current: MergeTaskResult | Error }
  projectHead: { current: { branchName: string | null } }
  projectHeadCalls: string[]
}

const createHarness = (): Harness => {
  const database = createTestDatabase()
  const fake = createFakeCodex()
  const broker = createEventBroker<PersistedEvent>()
  const providerSettings: { current: ProviderSettings | null } = {
    current: { kind: 'codex', mode: 'cli', binaryPath: null }
  }
  const creations: Harness['worktreeCreations'] = []
  const mergeCalls: MergeTaskInput[] = []
  const mergeResult: { current: MergeTaskResult | Error } = {
    current: { mergeCommitSha: 'deadbeef', autoCommitted: false }
  }
  const projectHead: { current: { branchName: string | null } } = {
    current: { branchName: 'main' }
  }
  const projectHeadCalls: string[] = []

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
    createProvider: async () => fake.provider,
    providerSettings: () => providerSettings.current,
    worktree: {
      create: async (args) => {
        creations.push(args)

        return defaultCreate(args)
      },
      remove: async () => undefined
    },
    merge: async (args) => {
      mergeCalls.push(args)

      if (mergeResult.current instanceof Error) {
        throw mergeResult.current
      }

      return mergeResult.current
    },
    resolveProjectHead: async ({ directoryPath }) => {
      projectHeadCalls.push(directoryPath)

      return projectHead.current
    }
  })

  return {
    database,
    threads: fake.threads,
    broker,
    runner,
    providerSettings,
    mergeCalls,
    mergeResult,
    worktreeCreations: creations,
    projectHead,
    projectHeadCalls
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
        /provider.*not configured/i
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

      await waitFor(
        () => getThreadEvents(harness.database, result.threadId).length >= 2
      )

      const events = getThreadEvents(harness.database, result.threadId)

      expect(events.at(0)?.type).toEqual('prep')
      expect(events.at(0)?.sequence).toEqual(0)
      expect(events.at(1)?.type).toEqual('user_message')

      const updatedTask = getTaskRow(harness.database, task.id)

      expect(updatedTask?.status).toEqual('in_progress')
      expect(updatedTask?.agentState).toEqual('working')
    })

    test('emits a user_message event with the task prompt before streaming', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(
        () => getThreadEvents(harness.database, threadId).length >= 2
      )

      const events = getThreadEvents(harness.database, threadId)
      const userEvent = events.find(
        (event) => event.type === 'user_message'
      )

      invariant(userEvent, 'user_message event missing')

      const payload = JSON.parse(userEvent.payload) as { text?: string }

      expect(payload.text).toEqual('Fix the bug\n\nSomething is broken')
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

    test('grants the agent workspace-write sandbox access by default', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      await harness.runner.start(task.id)
      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')

      expect(fakeThread.options.sandboxMode).toEqual('workspace-write')
    })

    test('lets the agent use tools without prompting for approval', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      await harness.runner.start(task.id)
      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')

      expect(fakeThread.options.approvalPolicy).toEqual('never')
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

    test('captures external thread id from the thread.started event', async () => {
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
          getThreadRow(harness.database, threadId)?.externalThreadId ===
          'codex-xyz'
      )

      const row = getThreadRow(harness.database, threadId)

      expect(row?.codexThreadId).toEqual('codex-xyz')
      expect(row?.provider).toEqual('codex')
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
        () => getThreadEvents(harness.database, threadId).length >= 4
      )

      const events = getThreadEvents(harness.database, threadId)

      expect(events.map((event) => event.type)).toEqual([
        'prep',
        'user_message',
        'thread.started',
        'item.completed'
      ])
      expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3])
      expect(received.map((event) => event.type)).toContain('item.completed')
    })

    test('on turn.completed flips thread to idle and task agentState to waiting_for_input', async () => {
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

      expect(updatedTask?.agentState).toEqual('waiting_for_input')
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

  describe('restartThread', () => {
    test('creates a new thread reusing the existing worktree and flips task to working', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId: firstId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)

      const [firstThread] = harness.threads

      invariant(firstThread, 'first thread missing')
      firstThread.emit({ type: 'thread.started', thread_id: 'codex-1' })
      firstThread.emit({ type: 'turn.completed' })

      await waitFor(
        () => getThreadRow(harness.database, firstId)?.status === 'idle'
      )

      const firstRow = getThreadRow(harness.database, firstId)

      invariant(firstRow, 'first row missing')

      const result = await harness.runner.restartThread(task.id)

      expect(result.threadId).not.toEqual(firstId)

      const newRow = getThreadRow(harness.database, result.threadId)

      expect(newRow?.worktreePath).toEqual(firstRow.worktreePath)
      expect(newRow?.branchName).toEqual(firstRow.branchName)
      expect(newRow?.baseBranch).toEqual(firstRow.baseBranch)
      expect(newRow?.status).toEqual('running')

      // No new worktree.create call beyond the initial start.
      expect(harness.worktreeCreations).toHaveLength(1)

      const updatedTask = getTaskRow(harness.database, task.id)

      expect(updatedTask?.agentState).toEqual('working')

      const events = getThreadEvents(harness.database, result.threadId)
      const prep = events.find((event) => event.type === 'prep')

      invariant(prep, 'prep event missing')

      const prepPayload = JSON.parse(prep.payload) as { restart?: boolean }

      expect(prepPayload.restart).toEqual(true)

      await waitFor(() => harness.threads.length === 2)

      const [, secondThread] = harness.threads

      invariant(secondThread, 'second thread missing')
      // The agent was started fresh (no resume) with the task prompt.
      expect(secondThread.inputs.at(0)).toEqual(
        'Fix the bug\n\nSomething is broken'
      )
      expect(secondThread.handle.id).toBeNull()
    })

    test('force-abandons a stuck prior thread and starts a fresh one', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId: firstId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)

      const result = await harness.runner.restartThread(task.id)

      expect(result.threadId).not.toEqual(firstId)

      const firstRow = getThreadRow(harness.database, firstId)

      expect(firstRow?.status).toEqual('error')
      expect(firstRow?.errorMessage).toMatch(/interrupted/i)

      const newRow = getThreadRow(harness.database, result.threadId)

      expect(newRow?.status).toEqual('running')
    })

    test('throws when the task has no prior thread', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      await expect(harness.runner.restartThread(task.id)).rejects.toThrow(
        /no existing thread/i
      )
    })

    test('throws when no provider is configured', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)
      const [firstThread] = harness.threads
      invariant(firstThread, 'first thread missing')
      firstThread.emit({ type: 'turn.completed' })

      await waitFor(
        () => getThreadRow(harness.database, threadId)?.status === 'idle'
      )

      harness.providerSettings.current = null

      await expect(harness.runner.restartThread(task.id)).rejects.toThrow(
        /provider.*not configured/i
      )
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

    test('starts a fresh provider thread when the active provider differs from the stored one', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      // Initial run under Codex.
      harness.providerSettings.current = {
        kind: 'codex',
        mode: 'cli',
        binaryPath: null
      }

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)
      const [firstThread] = harness.threads
      invariant(firstThread, 'first thread missing')
      firstThread.emit({ type: 'thread.started', thread_id: 'codex-xyz' })
      firstThread.emit({ type: 'turn.completed' })

      await waitFor(
        () => getThreadRow(harness.database, threadId)?.status === 'idle'
      )

      // User switches to Claude Code before the follow-up.
      harness.providerSettings.current = {
        kind: 'claude-code',
        mode: 'cli',
        executablePath: null
      }

      await harness.runner.continueThread(threadId, 'and now under claude')

      await waitFor(() => harness.threads.length === 2)

      const secondThread = harness.threads.at(1)

      invariant(secondThread, 'second thread missing')
      // Fresh thread (not resumed) because the external id belongs to Codex.
      expect(secondThread.handle.id).toBeNull()
    })

    test('emits a user_message event with the follow-up text', async () => {
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

      await waitFor(() =>
        getThreadEvents(harness.database, threadId).some((event) => {
          if (event.type !== 'user_message') return false

          const payload = JSON.parse(event.payload) as { text?: string }

          return payload.text === 'also add tests'
        })
      )
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

  describe('respondToApproval', () => {
    test('resolves a pending approval when the agent asks, flips state, and writes resolved event', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')
      invariant(
        fakeThread.options.onApprovalRequest,
        'onApprovalRequest callback not wired'
      )

      // The Claude Code provider would normally emit these events and invoke
      // the callback; we simulate that end-to-end here.
      fakeThread.emit({
        type: 'item.approval_requested',
        item: {
          id: 'req-1',
          tool: 'Bash',
          input: { command: 'git commit' },
          summary: 'git commit',
          requestedAt: new Date().toISOString()
        }
      })

      const decisionPromise =
        fakeThread.options.onApprovalRequest({
          id: 'req-1',
          tool: 'Bash',
          input: { command: 'git commit' },
          kind: 'command',
          summary: 'git commit'
        })

      await waitFor(
        () => getTaskRow(harness.database, task.id)?.agentState === 'waiting_for_input'
      )

      await harness.runner.respondToApproval(threadId, 'req-1', {
        decision: 'approve'
      })

      const decision = await decisionPromise

      expect(decision).toEqual({ decision: 'approve' })
    })

    test('throws and leaves the pending promise unresolved when the request id does not match', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')
      invariant(fakeThread.options.onApprovalRequest, 'missing callback')

      let resolved = false

      void fakeThread.options
        .onApprovalRequest({
          id: 'req-1',
          tool: 'Bash',
          input: {},
          kind: 'command',
          summary: 'x'
        })
        .then(() => {
          resolved = true
        })

      await expect(
        harness.runner.respondToApproval(threadId, 'wrong-id', {
          decision: 'approve'
        })
      ).rejects.toThrow(/No pending approval matches/)

      // Give the promise a turn to resolve if it were going to.
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(resolved).toEqual(false)
    })
  })

  describe('recoverOrphanedThreads - unresolved approvals', () => {
    test('writes synthetic rejection and flips task to idle', async () => {
      const harness = createHarness()
      const { project, task } = seedProjectAndTask(harness.database)

      const [threadRow] = harness.database
        .insert(schema.threads)
        .values({
          taskId: task.id,
          worktreePath: `${project.directoryPath}.worktrees/t_abc`,
          branchName: `code-monkey/${task.id}`,
          baseBranch: 'main',
          status: 'idle'
        })
        .returning()
        .all()

      invariant(threadRow, 'seeded thread missing')

      harness.database
        .update(schema.tasks)
        .set({ agentState: 'waiting_for_input' })
        .where(eq(schema.tasks.id, task.id))
        .run()

      harness.database
        .insert(schema.threadEvents)
        .values({
          threadId: threadRow.id,
          sequence: 0,
          type: 'item.approval_requested',
          payload: JSON.stringify({
            item: {
              id: 'req-stuck',
              tool: 'Bash',
              input: { command: 'git status' },
              summary: 'git status'
            }
          })
        })
        .run()

      harness.runner.recoverOrphanedThreads()

      const events = getThreadEvents(harness.database, threadRow.id)
      const resolved = events.find(
        (event) => event.type === 'item.approval_resolved'
      )

      invariant(resolved, 'synthetic rejection event missing')

      const payload = JSON.parse(resolved.payload) as {
        item: { decision: string; reason: string; id: string }
      }

      expect(payload.item.decision).toEqual('reject')
      expect(payload.item.reason).toEqual('app restarted')
      expect(payload.item.id).toEqual('req-stuck')

      const updatedTask = getTaskRow(harness.database, task.id)

      expect(updatedTask?.agentState).toEqual('idle')
    })

    test('leaves already-resolved approvals alone', async () => {
      const harness = createHarness()
      const { project, task } = seedProjectAndTask(harness.database)

      const [threadRow] = harness.database
        .insert(schema.threads)
        .values({
          taskId: task.id,
          worktreePath: `${project.directoryPath}.worktrees/t_done`,
          branchName: `code-monkey/${task.id}`,
          baseBranch: 'main',
          status: 'idle'
        })
        .returning()
        .all()

      invariant(threadRow, 'seeded thread missing')

      harness.database
        .insert(schema.threadEvents)
        .values([
          {
            threadId: threadRow.id,
            sequence: 0,
            type: 'item.approval_requested',
            payload: JSON.stringify({ item: { id: 'req-ok' } })
          },
          {
            threadId: threadRow.id,
            sequence: 1,
            type: 'item.approval_resolved',
            payload: JSON.stringify({
              item: { id: 'req-ok', decision: 'approve' }
            })
          }
        ])
        .run()

      harness.runner.recoverOrphanedThreads()

      const events = getThreadEvents(harness.database, threadRow.id)
      const rejections = events.filter(
        (event) =>
          event.type === 'item.approval_resolved' &&
          (JSON.parse(event.payload) as { item: { decision: string } }).item
            .decision === 'reject'
      )

      expect(rejections).toHaveLength(0)
    })
  })

  describe('mergeTask', () => {
    test('merges the latest thread and moves the task to done', async () => {
      const harness = createHarness()
      const { project, task } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.start(task.id)

      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads

      invariant(fakeThread, 'fake thread missing')
      fakeThread.emit({ type: 'thread.started', thread_id: 'c1' })
      fakeThread.emit({ type: 'turn.completed' })

      await waitFor(
        () => getThreadRow(harness.database, threadId)?.status === 'idle'
      )

      const result = await harness.runner.mergeTask(task.id)

      expect(result.mergeCommitSha).toEqual('deadbeef')
      expect(harness.mergeCalls).toHaveLength(1)
      expect(harness.mergeCalls[0]?.project.directoryPath).toEqual(
        project.directoryPath
      )
      expect(harness.mergeCalls[0]?.thread.branchName).toEqual(
        `code-monkey/${task.id}`
      )
      expect(harness.mergeCalls[0]?.taskTitle).toEqual(task.title)

      const updatedTask = getTaskRow(harness.database, task.id)

      expect(updatedTask?.status).toEqual('done')
      expect(updatedTask?.agentState).toEqual('idle')

      const events = getThreadEvents(harness.database, threadId)

      expect(events.at(-1)?.type).toEqual('merge.completed')
    })

    test('throws when the task has no thread to merge', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      await expect(harness.runner.mergeTask(task.id)).rejects.toThrow(
        /no thread/i
      )
    })

    test('throws when the task does not exist', async () => {
      const harness = createHarness()

      await expect(
        harness.runner.mergeTask('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow(/task.*not found/i)
    })

    test('refuses to merge while a thread is still running', async () => {
      const harness = createHarness()
      const { task } = seedProjectAndTask(harness.database)

      await harness.runner.start(task.id)

      await expect(harness.runner.mergeTask(task.id)).rejects.toThrow(
        /still running|in progress/i
      )

      expect(harness.mergeCalls).toHaveLength(0)
    })

    test('surfaces merge errors and leaves the task state unchanged', async () => {
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

      harness.mergeResult.current = new Error('merge conflict in src/x.ts')

      await expect(harness.runner.mergeTask(task.id)).rejects.toThrow(
        /merge conflict/i
      )

      const updatedTask = getTaskRow(harness.database, task.id)

      expect(updatedTask?.status).toEqual('in_progress')
    })
  })

  describe('startProjectThread', () => {
    test('throws when no provider is configured', async () => {
      const harness = createHarness()

      harness.providerSettings.current = null

      const { project } = seedProjectAndTask(harness.database)

      await expect(
        harness.runner.startProjectThread(project.id, 'hi')
      ).rejects.toThrow(/not configured/i)
    })

    test('throws when the project does not exist', async () => {
      const harness = createHarness()

      await expect(
        harness.runner.startProjectThread(
          '00000000-0000-0000-0000-000000000000',
          'hi'
        )
      ).rejects.toThrow(/project.*not found/i)
    })

    test('inserts a project-scoped thread, writes prep event, runs in project dir', async () => {
      const harness = createHarness()
      const { project, task } = seedProjectAndTask(harness.database)

      const result = await harness.runner.startProjectThread(
        project.id,
        'list files'
      )

      const thread = getThreadRow(harness.database, result.threadId)

      expect(thread?.taskId).toBeNull()
      expect(thread?.projectId).toEqual(project.id)
      expect(thread?.status).toEqual('running')
      expect(thread?.worktreePath).toEqual(project.directoryPath)
      expect(thread?.branchName).toEqual('main')
      expect(thread?.baseBranch).toBeNull()

      await waitFor(
        () => getThreadEvents(harness.database, result.threadId).length >= 2
      )

      const events = getThreadEvents(harness.database, result.threadId)

      expect(events.at(0)?.type).toEqual('prep')
      expect(events.at(1)?.type).toEqual('user_message')

      expect(harness.projectHeadCalls).toEqual([project.directoryPath])
      expect(harness.worktreeCreations).toHaveLength(0)

      // Task state must not change.
      const unchangedTask = getTaskRow(harness.database, task.id)
      expect(unchangedTask?.agentState).toEqual('idle')
      expect(unchangedTask?.status).toEqual('todo')

      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads
      invariant(fakeThread, 'fake thread missing')
      expect(fakeThread.options.workingDirectory).toEqual(project.directoryPath)
      expect(fakeThread.inputs.at(0)).toEqual('list files')
    })

    test('turn.completed flips project thread to idle without touching tasks', async () => {
      const harness = createHarness()
      const { project, task } = seedProjectAndTask(harness.database)

      harness.database
        .update(schema.tasks)
        .set({ agentState: 'working' })
        .where(eq(schema.tasks.id, task.id))
        .run()

      const { threadId } = await harness.runner.startProjectThread(
        project.id,
        'start'
      )

      await waitFor(() => harness.threads.length === 1)

      const [fakeThread] = harness.threads
      invariant(fakeThread, 'fake thread missing')
      fakeThread.emit({ type: 'turn.completed' })

      await waitFor(
        () => getThreadRow(harness.database, threadId)?.status === 'idle'
      )

      // Unrelated task must NOT be flipped by project-scoped stream events.
      const unchangedTask = getTaskRow(harness.database, task.id)
      expect(unchangedTask?.agentState).toEqual('working')
    })

    test('continueThread works on a project-scoped thread', async () => {
      const harness = createHarness()
      const { project } = seedProjectAndTask(harness.database)

      const { threadId } = await harness.runner.startProjectThread(
        project.id,
        'start'
      )

      await waitFor(() => harness.threads.length === 1)

      const [firstThread] = harness.threads
      invariant(firstThread, 'first thread missing')
      firstThread.emit({ type: 'thread.started', thread_id: 'codex-p1' })
      firstThread.emit({ type: 'turn.completed' })

      await waitFor(
        () => getThreadRow(harness.database, threadId)?.status === 'idle'
      )

      await harness.runner.continueThread(threadId, 'also show src/')
      await waitFor(() => harness.threads.length === 2)

      const secondThread = harness.threads.at(1)
      invariant(secondThread, 'second thread missing')
      expect(secondThread.inputs.at(0)).toEqual('also show src/')
      expect(secondThread.options.workingDirectory).toEqual(
        project.directoryPath
      )
    })
  })

  describe('recoverOrphanedThreads on project threads', () => {
    test('does not touch tasks when orphaned thread is project-scoped', async () => {
      const harness = createHarness()
      const { project, task } = seedProjectAndTask(harness.database)

      harness.database
        .update(schema.tasks)
        .set({ agentState: 'working' })
        .where(eq(schema.tasks.id, task.id))
        .run()

      const [orphan] = harness.database
        .insert(schema.threads)
        .values({
          taskId: null,
          projectId: project.id,
          worktreePath: project.directoryPath,
          branchName: 'main',
          baseBranch: null,
          status: 'running'
        })
        .returning()
        .all()

      invariant(orphan, 'orphan thread missing')

      harness.runner.recoverOrphanedThreads()

      expect(getThreadRow(harness.database, orphan.id)?.status).toEqual(
        'error'
      )

      const unchangedTask = getTaskRow(harness.database, task.id)
      expect(unchangedTask?.agentState).toEqual('working')
    })
  })
})
