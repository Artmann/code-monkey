import { and, desc, eq, inArray, max } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { join } from 'node:path'
import invariant from 'tiny-invariant'

import type {
  AgentProvider,
  AgentThread,
  NormalizedEvent
} from '../agents/provider'
import * as schema from '../database/schema'
import type { EventBroker } from './event-broker'
import type { MergeTaskInput, MergeTaskResult } from './merge'
import type { ProviderSettings } from './provider-settings'
import type { CreatedWorktree } from './worktree'

export type AgentRunnerThread = AgentThread
export type { AgentThreadOptions } from '../agents/provider'
export type AgentRunnerCodex = AgentProvider

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

export type ResolveProjectHeadInput = { directoryPath: string }
export type ResolveProjectHeadResult = { branchName: string | null }

export type AgentRunnerDependencies = {
  database: AgentRunnerDatabase
  broker: EventBroker<PersistedEvent>
  createProvider: (settings: ProviderSettings) => Promise<AgentProvider>
  providerSettings: () => ProviderSettings | null
  worktree: {
    create: (args: AgentRunnerWorktreeInput) => Promise<CreatedWorktree>
    remove: (args: AgentRunnerWorktreeRemoveInput) => Promise<void>
  }
  merge: (args: MergeTaskInput) => Promise<MergeTaskResult>
  resolveProjectHead?: (
    args: ResolveProjectHeadInput
  ) => Promise<ResolveProjectHeadResult>
  now?: () => Date
}

export type StartResult = { threadId: string }

export type AgentRunner = {
  start: (taskId: string) => Promise<StartResult>
  restartThread: (taskId: string) => Promise<StartResult>
  startProjectThread: (
    projectId: string,
    initialMessage: string
  ) => Promise<StartResult>
  continueThread: (threadId: string, text: string) => Promise<void>
  recoverOrphanedThreads: () => void
  mergeTask: (taskId: string) => Promise<MergeTaskResult>
}

const interruptionMessage = 'Interrupted by app exit'

type SdkEvent = NormalizedEvent

// Worktrees keep their git metadata under <main-repo>/.git/worktrees/<name>,
// outside the agent's workspace. Without granting write access to the parent
// repo's .git directory, sandboxed `git add` / `git commit` calls fail.
const worktreeWritableRoots = (projectDirectoryPath: string): string[] => [
  join(projectDirectoryPath, '.git')
]

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
  const {
    database,
    broker,
    createProvider,
    providerSettings,
    worktree,
    merge,
    resolveProjectHead,
    now
  } = dependencies

  const clock = now ?? (() => new Date())

  const setTaskAgentState = (
    taskId: string | null,
    agentState: 'idle' | 'waiting_for_input' | 'working' | 'done'
  ) => {
    if (!taskId) return

    database
      .update(schema.tasks)
      .set({ agentState, updatedAt: clock() })
      .where(eq(schema.tasks.id, taskId))
      .run()
  }

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
    taskId: string | null,
    event: SdkEvent
  ) => {
    appendEvent(threadId, event.type, event)

    if (event.type === 'thread.started' && event.thread_id) {
      database
        .update(schema.threads)
        .set({
          codexThreadId: event.thread_id,
          externalThreadId: event.thread_id,
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

      // The agent has finished a turn; it's now awaiting the next user input.
      // Use 'waiting_for_input' so the UI shows "Needs you" instead of "Done".
      setTaskAgentState(taskId, 'waiting_for_input')

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

      setTaskAgentState(taskId, 'idle')

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
    taskId: string | null,
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
        'Agent provider is not configured. Configure one in Settings before starting work.'
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
          provider: settings.kind,
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
    appendEvent(threadId, 'user_message', { text: prompt })

    const provider = await createProvider(settings)
    const thread = provider.startThread({
      workingDirectory: created.path,
      skipGitRepoCheck: false,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      additionalDirectories: worktreeWritableRoots(project.directoryPath)
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

  const restartThread = async (taskId: string): Promise<StartResult> => {
    const settings = providerSettings()

    if (!settings) {
      throw new Error(
        'Agent provider is not configured. Configure one in Settings before starting a new chat.'
      )
    }

    const loaded = loadTaskWithProject(database, taskId)

    if (!loaded) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const { task, project } = loaded

    const [previousThread] = database
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.taskId, task.id))
      .orderBy(desc(schema.threads.createdAt))
      .limit(1)
      .all()

    if (!previousThread) {
      throw new Error(
        `Task has no existing thread to restart: ${taskId}. Use Start Work first.`
      )
    }

    // If the previous thread is stuck in a running/starting state (e.g. the
    // app crashed or the agent hung), mark it abandoned so the user can
    // recover by starting a fresh chat. Mirrors `recoverOrphanedThreads`.
    if (
      previousThread.status === 'running' ||
      previousThread.status === 'starting'
    ) {
      appendEvent(previousThread.id, 'error', { message: interruptionMessage })

      database
        .update(schema.threads)
        .set({
          status: 'error',
          errorMessage: interruptionMessage,
          lastActivityAt: clock()
        })
        .where(eq(schema.threads.id, previousThread.id))
        .run()

      database
        .update(schema.tasks)
        .set({ agentState: 'idle', updatedAt: clock() })
        .where(
          and(
            eq(schema.tasks.id, task.id),
            eq(schema.tasks.agentState, 'working')
          )
        )
        .run()
    }

    if (!previousThread.worktreePath) {
      throw new Error(
        `Previous thread has no working directory recorded: ${previousThread.id}.`
      )
    }

    const workingDirectory = previousThread.worktreePath
    const branchName = previousThread.branchName
    const baseBranch = previousThread.baseBranch

    const threadId = database.transaction((tx) => {
      const [threadRow] = tx
        .insert(schema.threads)
        .values({
          taskId: task.id,
          provider: settings.kind,
          worktreePath: workingDirectory,
          branchName,
          baseBranch,
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
            worktreePath: workingDirectory,
            branchName,
            baseBranch,
            restart: true
          })
        })
        .run()

      tx.update(schema.tasks)
        .set({ agentState: 'working', updatedAt: clock() })
        .where(eq(schema.tasks.id, task.id))
        .run()

      return threadRow.id
    })

    const prompt = buildInitialPrompt(task)
    appendEvent(threadId, 'user_message', { text: prompt })

    const provider = await createProvider(settings)
    const thread = provider.startThread({
      workingDirectory,
      skipGitRepoCheck: false,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never',
      additionalDirectories: worktreeWritableRoots(project.directoryPath)
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
        'Agent provider is not configured. Configure one in Settings before continuing.'
      )
    }

    const taskId = threadRow.taskId

    // Task-scoped threads run in a git worktree, so the agent needs write
    // access to the parent repo's .git/ to commit. Project-scoped threads
    // run in the project root where .git is already inside the workspace.
    let additionalDirectories: string[] = []

    if (taskId) {
      const loaded = loadTaskWithProject(database, taskId)

      if (!loaded) {
        throw new Error(`Task not found for thread: ${threadId}`)
      }

      additionalDirectories = worktreeWritableRoots(loaded.project.directoryPath)
    }

    if (!threadRow.worktreePath) {
      throw new Error(
        `Thread has no working directory recorded: ${threadId}.`
      )
    }

    database
      .update(schema.threads)
      .set({ status: 'running', lastActivityAt: clock() })
      .where(eq(schema.threads.id, threadId))
      .run()

    setTaskAgentState(taskId, 'working')

    appendEvent(threadId, 'user_message', { text })

    const provider = await createProvider(settings)
    // Only resume when the stored external id belongs to the active provider.
    // A null `provider` column predates the migration and is assumed to be
    // Codex; if the user has switched providers since the last turn, we must
    // start a fresh provider thread instead of resuming with a foreign id.
    const threadProviderKind = threadRow.provider ?? 'codex'
    const externalId =
      threadProviderKind === settings.kind
        ? (threadRow.externalThreadId ?? threadRow.codexThreadId ?? null)
        : null
    const thread = externalId
      ? provider.resumeThread(externalId, {
          workingDirectory: threadRow.worktreePath,
          skipGitRepoCheck: false,
          sandboxMode: 'workspace-write',
          approvalPolicy: 'never',
          additionalDirectories
        })
      : provider.startThread({
          workingDirectory: threadRow.worktreePath,
          skipGitRepoCheck: false,
          sandboxMode: 'workspace-write',
          approvalPolicy: 'never',
          additionalDirectories
        })

    void (async () => {
      try {
        const { events } = await thread.runStreamed(text)

        await runStream(threadId, taskId, events)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        handleStreamEvent(threadId, taskId, { type: 'error', message })
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

      if (thread.taskId) {
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
  }

  const mergeTask = async (taskId: string): Promise<MergeTaskResult> => {
    const loaded = loadTaskWithProject(database, taskId)

    if (!loaded) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const { task, project } = loaded

    const [latestThread] = database
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.taskId, task.id))
      .orderBy(desc(schema.threads.createdAt))
      .limit(1)
      .all()

    if (!latestThread) {
      throw new Error(
        `Task has no thread to merge: ${taskId}. Start work on the task before merging.`
      )
    }

    if (
      latestThread.status === 'running' ||
      latestThread.status === 'starting'
    ) {
      throw new Error(
        `Thread is still running. Wait for the agent to finish before merging.`
      )
    }

    if (
      !latestThread.worktreePath ||
      !latestThread.branchName ||
      !latestThread.baseBranch
    ) {
      throw new Error(
        `Thread is missing branch/worktree metadata required to merge: ${latestThread.id}.`
      )
    }

    const result = await merge({
      project: { directoryPath: project.directoryPath },
      thread: {
        worktreePath: latestThread.worktreePath,
        branchName: latestThread.branchName,
        baseBranch: latestThread.baseBranch
      },
      taskTitle: task.title
    })

    appendEvent(latestThread.id, 'merge.completed', {
      mergeCommitSha: result.mergeCommitSha,
      autoCommitted: result.autoCommitted,
      baseBranch: latestThread.baseBranch,
      branchName: latestThread.branchName
    })

    database
      .update(schema.tasks)
      .set({ status: 'done', agentState: 'idle', updatedAt: clock() })
      .where(eq(schema.tasks.id, task.id))
      .run()

    return result
  }

  const startProjectThread = async (
    projectId: string,
    initialMessage: string
  ): Promise<StartResult> => {
    const settings = providerSettings()

    if (!settings) {
      throw new Error(
        'Agent provider is not configured. Configure one in Settings before starting work.'
      )
    }

    const project = database
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get()

    if (!project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    const head = resolveProjectHead
      ? await resolveProjectHead({ directoryPath: project.directoryPath })
      : { branchName: null }

    const threadId = database.transaction((tx) => {
      const [threadRow] = tx
        .insert(schema.threads)
        .values({
          taskId: null,
          projectId: project.id,
          provider: settings.kind,
          worktreePath: project.directoryPath,
          branchName: head.branchName,
          baseBranch: null,
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
            workingDirectory: project.directoryPath,
            branchName: head.branchName,
            scope: 'project'
          })
        })
        .run()

      return threadRow.id
    })

    appendEvent(threadId, 'user_message', { text: initialMessage })

    const provider = await createProvider(settings)
    const thread = provider.startThread({
      workingDirectory: project.directoryPath,
      skipGitRepoCheck: false,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'never'
    })

    void (async () => {
      try {
        const { events } = await thread.runStreamed(initialMessage)

        await runStream(threadId, null, events)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        handleStreamEvent(threadId, null, { type: 'error', message })
      }
    })()

    return { threadId }
  }

  return {
    start,
    restartThread,
    startProjectThread,
    continueThread,
    recoverOrphanedThreads,
    mergeTask
  }
}
