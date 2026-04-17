import { and, eq, inArray, max } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import invariant from 'tiny-invariant'

import * as schema from '../database/schema'
import type { EventBroker } from './event-broker'
import type { ProviderSettings } from './provider-settings'
import type { CreatedWorktree } from './worktree'

export type AgentRunnerThread = {
  readonly id: string | null
  runStreamed: (input: string) => Promise<{
    events: AsyncIterable<unknown>
  }>
}

export type AgentThreadOptions = {
  workingDirectory?: string
  skipGitRepoCheck?: boolean
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted'
}

export type AgentRunnerCodex = {
  startThread: (options?: AgentThreadOptions) => AgentRunnerThread
  resumeThread: (
    threadId: string,
    options?: AgentThreadOptions
  ) => AgentRunnerThread
}

export type PersistedEvent = {
  createdAt: Date
  id: string
  payload: unknown
  sequence: number
  threadId: string
  type: string
}

export type AgentRunnerDatabase = BetterSQLite3Database<typeof schema>

export type AgentRunnerWorktreeInput = {
  project: { id: string; directoryPath: string }
  task: { id: string }
}

export type AgentRunnerWorktreeRemoveInput = {
  project: { directoryPath: string }
  thread: { worktreePath: string; branchName: string }
}

export type AgentRunnerDependencies = {
  database: AgentRunnerDatabase
  broker: EventBroker<PersistedEvent>
  createCodex: (settings: ProviderSettings) => AgentRunnerCodex
  providerSettings: () => ProviderSettings | null
  worktree: {
    create: (args: AgentRunnerWorktreeInput) => Promise<CreatedWorktree>
    remove: (args: AgentRunnerWorktreeRemoveInput) => Promise<void>
  }
  now?: () => Date
}

export type StartResult = { threadId: string }

export type AgentRunner = {
  start: (taskId: string) => Promise<StartResult>
  continueThread: (threadId: string, text: string) => Promise<void>
  recoverOrphanedThreads: () => void
}

const interruptionMessage = 'Interrupted by app exit'

type SdkEvent = {
  type: string
  thread_id?: string
  item?: unknown
  message?: string
  error?: { message: string }
  usage?: unknown
}

const buildInitialPrompt = (task: {
  title: string
  description: string | null
}): string => {
  if (task.description == null || task.description.trim() === '') {
    return task.title.trim()
  }

  return `${task.title}\n\n${task.description}`.trim()
}

const loadTaskWithProject = (database: AgentRunnerDatabase, taskId: string) => {
  const task = database
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .get()

  if (!task) {
    return null
  }

  const project = database
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, task.projectId))
    .get()

  if (!project) {
    return null
  }

  return { task, project }
}

const nextSequenceFor = (
  database: AgentRunnerDatabase,
  threadId: string
): number => {
  const [row] = database
    .select({ value: max(schema.threadEvents.sequence) })
    .from(schema.threadEvents)
    .where(eq(schema.threadEvents.threadId, threadId))
    .all()

  return (row?.value ?? -1) + 1
}

export const createAgentRunner = (
  dependencies: AgentRunnerDependencies
): AgentRunner => {
  const { database, broker, createCodex, providerSettings, worktree, now } =
    dependencies

  const clock = now ?? (() => new Date())

  const appendEvent = (
    threadId: string,
    type: string,
    payload: unknown
  ): PersistedEvent => {
    const createdAt = clock()
    const payloadJson = JSON.stringify(payload)

    const [row] = database.transaction((tx) => {
      const sequence = nextSequenceFor(tx, threadId)

      return tx
        .insert(schema.threadEvents)
        .values({
          threadId,
          sequence,
          type,
          payload: payloadJson,
          createdAt
        })
        .returning()
        .all()
    })

    invariant(row, 'thread_events insert returned no row')

    const persisted: PersistedEvent = {
      id: row.id,
      threadId: row.threadId,
      sequence: row.sequence,
      type: row.type,
      payload,
      createdAt: row.createdAt
    }

    broker.publish(threadId, persisted)

    return persisted
  }

  const handleStreamEvent = (
    threadId: string,
    taskId: string,
    event: SdkEvent
  ) => {
    appendEvent(threadId, event.type, event)

    if (event.type === 'thread.started' && event.thread_id) {
      database
        .update(schema.threads)
        .set({
          codexThreadId: event.thread_id,
          lastActivityAt: clock()
        })
        .where(eq(schema.threads.id, threadId))
        .run()

      return
    }

    if (event.type === 'turn.completed') {
      database
        .update(schema.threads)
        .set({ status: 'idle', lastActivityAt: clock() })
        .where(eq(schema.threads.id, threadId))
        .run()

      database
        .update(schema.tasks)
        .set({ agentState: 'done', updatedAt: clock() })
        .where(eq(schema.tasks.id, taskId))
        .run()

      return
    }

    if (event.type === 'error' || event.type === 'turn.failed') {
      const message =
        event.message ?? event.error?.message ?? 'Unknown agent error'

      database
        .update(schema.threads)
        .set({
          status: 'error',
          errorMessage: message,
          lastActivityAt: clock()
        })
        .where(eq(schema.threads.id, threadId))
        .run()

      database
        .update(schema.tasks)
        .set({ agentState: 'idle', updatedAt: clock() })
        .where(eq(schema.tasks.id, taskId))
        .run()

      return
    }

    database
      .update(schema.threads)
      .set({ lastActivityAt: clock() })
      .where(eq(schema.threads.id, threadId))
      .run()
  }

  const runStream = async (
    threadId: string,
    taskId: string,
    events: AsyncIterable<unknown>
  ) => {
    try {
      for await (const event of events) {
        handleStreamEvent(threadId, taskId, event as SdkEvent)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      handleStreamEvent(threadId, taskId, { type: 'error', message })
    }
  }

  const start = async (taskId: string): Promise<StartResult> => {
    const settings = providerSettings()

    if (!settings) {
      throw new Error(
        'Codex provider is not configured. Configure one in Settings before starting work.'
      )
    }

    const loaded = loadTaskWithProject(database, taskId)

    if (!loaded) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const { task, project } = loaded

    const created = await worktree.create({
      project: { id: project.id, directoryPath: project.directoryPath },
      task: { id: task.id }
    })

    const threadId = database.transaction((tx) => {
      const [threadRow] = tx
        .insert(schema.threads)
        .values({
          taskId: task.id,
          worktreePath: created.path,
          branchName: created.branch,
          baseBranch: created.baseBranch,
          status: 'running'
        })
        .returning()
        .all()

      invariant(threadRow, 'threads insert returned no row')

      tx.insert(schema.threadEvents)
        .values({
          threadId: threadRow.id,
          sequence: 0,
          type: 'prep',
          payload: JSON.stringify({
            worktreePath: created.path,
            branchName: created.branch,
            baseBranch: created.baseBranch
          })
        })
        .run()

      tx.update(schema.tasks)
        .set({
          status: 'in_progress',
          agentState: 'working',
          updatedAt: clock()
        })
        .where(eq(schema.tasks.id, task.id))
        .run()

      return threadRow.id
    })

    const prompt = buildInitialPrompt(task)
    const codex = createCodex(settings)
    const thread = codex.startThread({
      workingDirectory: created.path,
      skipGitRepoCheck: false,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never'
    })

    void (async () => {
      try {
        const { events } = await thread.runStreamed(prompt)

        await runStream(threadId, task.id, events)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        handleStreamEvent(threadId, task.id, { type: 'error', message })
      }
    })()

    return { threadId }
  }

  const continueThread = async (threadId: string, text: string) => {
    const threadRow = database
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.id, threadId))
      .get()

    if (!threadRow) {
      throw new Error(`Thread not found: ${threadId}`)
    }

    const settings = providerSettings()

    if (!settings) {
      throw new Error(
        'Codex provider is not configured. Configure one in Settings before continuing.'
      )
    }

    const taskRow = database
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, threadRow.taskId))
      .get()

    if (!taskRow) {
      throw new Error(`Task not found for thread: ${threadId}`)
    }

    database
      .update(schema.threads)
      .set({ status: 'running', lastActivityAt: clock() })
      .where(eq(schema.threads.id, threadId))
      .run()

    database
      .update(schema.tasks)
      .set({ agentState: 'working', updatedAt: clock() })
      .where(eq(schema.tasks.id, taskRow.id))
      .run()

    const codex = createCodex(settings)
    const thread = threadRow.codexThreadId
      ? codex.resumeThread(threadRow.codexThreadId, {
          workingDirectory: threadRow.worktreePath,
          skipGitRepoCheck: false,
          sandboxMode: 'workspace-write',
          approvalPolicy: 'never'
        })
      : codex.startThread({
          workingDirectory: threadRow.worktreePath,
          skipGitRepoCheck: false,
          sandboxMode: 'workspace-write',
          approvalPolicy: 'never'
        })

    void (async () => {
      try {
        const { events } = await thread.runStreamed(text)

        await runStream(threadId, taskRow.id, events)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        handleStreamEvent(threadId, taskRow.id, { type: 'error', message })
      }
    })()
  }

  const recoverOrphanedThreads = () => {
    const orphans = database
      .select()
      .from(schema.threads)
      .where(inArray(schema.threads.status, ['running', 'starting']))
      .all()

    for (const thread of orphans) {
      appendEvent(thread.id, 'error', { message: interruptionMessage })

      database
        .update(schema.threads)
        .set({
          status: 'error',
          errorMessage: interruptionMessage,
          lastActivityAt: clock()
        })
        .where(eq(schema.threads.id, thread.id))
        .run()

      database
        .update(schema.tasks)
        .set({ agentState: 'idle', updatedAt: clock() })
        .where(
          and(
            eq(schema.tasks.id, thread.taskId),
            eq(schema.tasks.agentState, 'working')
          )
        )
        .run()
    }
  }

  return { start, continueThread, recoverOrphanedThreads }
}
