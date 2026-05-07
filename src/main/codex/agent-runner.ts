import type { ResultSet } from '@libsql/client'
import { eq, inArray, max } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { basename } from 'node:path'
import invariant from 'tiny-invariant'

import type {
  AgentProvider,
  AgentThread,
  ApprovalDecision,
  ApprovalRequest,
  NormalizedEvent,
  OnApprovalRequest,
  OnUserInputRequest,
  RuntimeMode,
  UserInputAnswers,
  UserInputRequest
} from '../agents/provider'
import * as schema from '../database/schema'
import type { EventBroker } from './event-broker'
import type { ProviderSettings } from './provider-settings'

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

export type AgentRunnerDatabase = LibSQLDatabase<typeof schema>

type AgentRunnerExecutor = BaseSQLiteDatabase<'async', ResultSet, typeof schema>

export type AgentRunnerDependencies = {
  database: AgentRunnerDatabase
  broker: EventBroker<PersistedEvent>
  createProvider: (settings: ProviderSettings) => Promise<AgentProvider>
  providerSettings: () => Promise<ProviderSettings | null>
  now?: () => Date
}

export type CreateThreadInput = {
  directoryPath: string
  name?: string
  workspaceId: string
}

export type AgentRunner = {
  createThread: (input: CreateThreadInput) => Promise<schema.Thread>
  continueThread: (
    threadId: string,
    text: string,
    runtimeMode?: RuntimeMode
  ) => Promise<void>
  cancelThread: (threadId: string) => Promise<void>
  closeThread: (threadId: string) => Promise<void>
  recoverOrphanedThreads: () => Promise<void>
  respondToApproval: (
    threadId: string,
    requestId: string,
    decision: ApprovalDecision
  ) => Promise<void>
  respondToUserInput: (
    threadId: string,
    requestId: string,
    answers: UserInputAnswers
  ) => Promise<void>
}

const defaultRuntimeMode: RuntimeMode = 'full-access'

const interruptionMessage = 'Interrupted by app exit'

type SdkEvent = NormalizedEvent

const nextSequenceFor = async (
  database: AgentRunnerExecutor,
  threadId: string
): Promise<number> => {
  const rows = await database
    .select({ value: max(schema.threadEvents.sequence) })
    .from(schema.threadEvents)
    .where(eq(schema.threadEvents.threadId, threadId))
    .all()

  return (rows[0]?.value ?? -1) + 1
}

const nextTabOrder = async (database: AgentRunnerExecutor): Promise<number> => {
  const rows = await database
    .select({ value: max(schema.threads.tabOrder) })
    .from(schema.threads)
    .all()

  return (rows[0]?.value ?? -1) + 1
}

export const createAgentRunner = (
  dependencies: AgentRunnerDependencies
): AgentRunner => {
  const { database, broker, createProvider, providerSettings, now } =
    dependencies

  const clock = now ?? (() => new Date())

  type PendingApproval = {
    requestId: string
    resolve: (decision: ApprovalDecision) => void
  }

  type PendingUserInput = {
    requestId: string
    resolve: (answers: UserInputAnswers) => void
    reject: (error: Error) => void
  }

  const pendingApprovals = new Map<string, PendingApproval>()
  const pendingUserInputs = new Map<string, PendingUserInput>()
  const runningControllers = new Map<string, AbortController>()
  const userCancelledThreads = new Set<string>()

  const buildOnApprovalRequest = (threadId: string): OnApprovalRequest => {
    return (request: ApprovalRequest) =>
      new Promise<ApprovalDecision>((resolve) => {
        const existing = pendingApprovals.get(threadId)

        if (existing) {
          existing.resolve({
            decision: 'reject',
            reason: 'concurrent approval not supported'
          })
          pendingApprovals.delete(threadId)
        }

        pendingApprovals.set(threadId, {
          requestId: request.id,
          resolve: (decision) => {
            pendingApprovals.delete(threadId)
            resolve(decision)
          }
        })
      })
  }

  const buildOnUserInputRequest = (threadId: string): OnUserInputRequest => {
    return (request: UserInputRequest) =>
      new Promise<UserInputAnswers>((resolve, reject) => {
        const existing = pendingUserInputs.get(threadId)

        if (existing) {
          existing.reject(new Error('superseded by another user-input request'))
          pendingUserInputs.delete(threadId)
        }

        pendingUserInputs.set(threadId, {
          requestId: request.id,
          resolve: (answers) => {
            pendingUserInputs.delete(threadId)
            resolve(answers)
          },
          reject: (error) => {
            pendingUserInputs.delete(threadId)
            reject(error)
          }
        })
      })
  }

  const respondToApproval = async (
    threadId: string,
    requestId: string,
    decision: ApprovalDecision
  ): Promise<void> => {
    const pending = pendingApprovals.get(threadId)

    if (!pending || pending.requestId !== requestId) {
      throw new Error(
        `No pending approval matches threadId=${threadId} requestId=${requestId}.`
      )
    }

    pending.resolve(decision)
  }

  const respondToUserInput = async (
    threadId: string,
    requestId: string,
    answers: UserInputAnswers
  ): Promise<void> => {
    const pending = pendingUserInputs.get(threadId)

    if (!pending || pending.requestId !== requestId) {
      throw new Error(
        `No pending user-input matches threadId=${threadId} requestId=${requestId}.`
      )
    }

    pending.resolve(answers)
  }

  const appendEvent = async (
    threadId: string,
    type: string,
    payload: unknown
  ): Promise<PersistedEvent> => {
    const createdAt = clock()
    const payloadJson = JSON.stringify(payload)

    const rows = await database.transaction(async (tx) => {
      const sequence = await nextSequenceFor(tx, threadId)

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

    const row = rows[0]

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

  const handleStreamEvent = async (threadId: string, event: SdkEvent) => {
    await appendEvent(threadId, event.type, event)

    if (event.type === 'thread.started' && event.thread_id) {
      await database
        .update(schema.threads)
        .set({
          externalThreadId: event.thread_id,
          lastActivityAt: clock()
        })
        .where(eq(schema.threads.id, threadId))
        .run()

      return
    }

    if (event.type === 'turn.completed') {
      await database
        .update(schema.threads)
        .set({ status: 'idle', lastActivityAt: clock() })
        .where(eq(schema.threads.id, threadId))
        .run()

      return
    }

    if (event.type === 'error' || event.type === 'turn.failed') {
      const message =
        event.message ?? event.error?.message ?? 'Unknown agent error'

      await database
        .update(schema.threads)
        .set({
          status: 'error',
          errorMessage: message,
          lastActivityAt: clock()
        })
        .where(eq(schema.threads.id, threadId))
        .run()

      return
    }

    await database
      .update(schema.threads)
      .set({ lastActivityAt: clock() })
      .where(eq(schema.threads.id, threadId))
      .run()
  }

  const runStream = async (
    threadId: string,
    events: AsyncIterable<unknown>
  ) => {
    try {
      try {
        for await (const event of events) {
          if (userCancelledThreads.has(threadId)) {
            break
          }

          await handleStreamEvent(threadId, event as SdkEvent)
        }
      } catch (error) {
        if (userCancelledThreads.has(threadId)) {
          // The user cancelled — the SDK threw an abort error. cancelThread
          // already wrote the cancellation event, so swallow this.
          return
        }

        const message = error instanceof Error ? error.message : String(error)

        await handleStreamEvent(threadId, { type: 'error', message })
      }
    } finally {
      // Safety-net: if the SDK stream ended without emitting a terminal
      // event (turn.completed / turn.failed / error), the thread row is
      // still 'running' or 'starting'. Flip it to idle and emit a synthetic
      // turn.completed so the UI stops showing "Working…".
      const current = await database
        .select({ status: schema.threads.status })
        .from(schema.threads)
        .where(eq(schema.threads.id, threadId))
        .get()

      if (
        current &&
        (current.status === 'running' || current.status === 'starting')
      ) {
        await handleStreamEvent(threadId, {
          type: 'turn.completed',
          usage: null
        })
      }
    }
  }

  const createThread = async (
    input: CreateThreadInput
  ): Promise<schema.Thread> => {
    const name = input.name ?? basename(input.directoryPath)
    const tabOrder = await nextTabOrder(database)
    const createdAt = clock()

    const rows = await database
      .insert(schema.threads)
      .values({
        name,
        workspaceId: input.workspaceId,
        directoryPath: input.directoryPath,
        status: 'idle',
        tabOrder,
        createdAt,
        lastActivityAt: createdAt
      })
      .returning()
      .all()

    const row = rows[0]

    invariant(row, 'threads insert returned no row')

    return row
  }

  const continueThread = async (
    threadId: string,
    text: string,
    runtimeMode: RuntimeMode = defaultRuntimeMode
  ) => {
    const threadRow = await database
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.id, threadId))
      .get()

    if (!threadRow) {
      throw new Error(`Thread not found: ${threadId}`)
    }

    const settings = await providerSettings()

    if (!settings) {
      throw new Error(
        'Agent provider is not configured. Configure one in Settings before continuing.'
      )
    }

    userCancelledThreads.delete(threadId)

    await database
      .update(schema.threads)
      .set({
        provider: settings.kind,
        status: 'running',
        errorMessage: null,
        lastActivityAt: clock()
      })
      .where(eq(schema.threads.id, threadId))
      .run()

    await appendEvent(threadId, 'user_message', { text })

    const provider = await createProvider(settings)

    const threadProviderKind = threadRow.provider ?? settings.kind
    const externalId =
      threadProviderKind === settings.kind ? threadRow.externalThreadId : null

    const onApprovalRequest = buildOnApprovalRequest(threadId)
    const onUserInputRequest = buildOnUserInputRequest(threadId)

    const options = {
      workingDirectory: threadRow.directoryPath,
      skipGitRepoCheck: true,
      sandboxMode: 'workspace-write' as const,
      approvalPolicy: 'never' as const,
      runtimeMode,
      onApprovalRequest,
      onUserInputRequest
    }

    const thread = externalId
      ? provider.resumeThread(externalId, options)
      : provider.startThread(options)

    const existingController = runningControllers.get(threadId)

    if (existingController) {
      existingController.abort()
    }

    const controller = new AbortController()

    runningControllers.set(threadId, controller)

    void (async () => {
      try {
        const { events } = await thread.runStreamed(text, {
          abortSignal: controller.signal
        })

        await runStream(threadId, events)
      } catch (error) {
        if (userCancelledThreads.has(threadId)) {
          return
        }

        const message = error instanceof Error ? error.message : String(error)

        await handleStreamEvent(threadId, { type: 'error', message })
      } finally {
        if (runningControllers.get(threadId) === controller) {
          runningControllers.delete(threadId)
        }
      }
    })()
  }

  const cancelThread = async (threadId: string): Promise<void> => {
    userCancelledThreads.add(threadId)

    const controller = runningControllers.get(threadId)

    runningControllers.delete(threadId)

    if (controller) {
      controller.abort()
    }

    // Resolve any in-flight approval / user-input prompts so the SDK
    // unblocks and the iterator can finish promptly.
    const pendingApproval = pendingApprovals.get(threadId)

    if (pendingApproval) {
      pendingApproval.resolve({
        decision: 'reject',
        reason: 'Cancelled by user.'
      })
    }

    const pendingUserInput = pendingUserInputs.get(threadId)

    if (pendingUserInput) {
      pendingUserInput.reject(new Error('Cancelled by user.'))
    }

    const current = await database
      .select({ status: schema.threads.status })
      .from(schema.threads)
      .where(eq(schema.threads.id, threadId))
      .get()

    if (!current) {
      return
    }

    if (current.status === 'running' || current.status === 'starting') {
      await appendEvent(threadId, 'turn.cancelled', {
        type: 'turn.cancelled',
        reason: 'Cancelled by user.',
        cancelledAt: clock().toISOString()
      })
    }

    await database
      .update(schema.threads)
      .set({
        status: 'idle',
        errorMessage: null,
        lastActivityAt: clock()
      })
      .where(eq(schema.threads.id, threadId))
      .run()
  }

  const closeThread = async (threadId: string) => {
    await database
      .update(schema.threads)
      .set({ closedAt: clock() })
      .where(eq(schema.threads.id, threadId))
      .run()
  }

  const collectResolvedIds = async (
    eventType: string
  ): Promise<Set<string>> => {
    const rows = await database
      .select()
      .from(schema.threadEvents)
      .where(eq(schema.threadEvents.type, eventType))
      .all()

    const ids = new Set<string>()

    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as {
          item?: { id?: string }
        }

        if (payload.item?.id) {
          ids.add(payload.item.id)
        }
      } catch {
        // malformed row — skip
      }
    }

    return ids
  }

  const recoverUnresolvedApprovals = async () => {
    const approvalRequests = await database
      .select()
      .from(schema.threadEvents)
      .where(eq(schema.threadEvents.type, 'item.approval_requested'))
      .all()

    const resolvedApprovalIds = await collectResolvedIds(
      'item.approval_resolved'
    )

    for (const event of approvalRequests) {
      try {
        const payload = JSON.parse(event.payload) as {
          item?: { id?: string }
        }
        const requestId = payload.item?.id

        if (!requestId || resolvedApprovalIds.has(requestId)) {
          continue
        }

        await appendEvent(event.threadId, 'item.approval_resolved', {
          type: 'item.approval_resolved',
          item: {
            id: requestId,
            decision: 'reject',
            reason: 'app restarted',
            resolvedAt: clock().toISOString()
          }
        })
      } catch {
        // malformed row — skip
      }
    }

    const userInputRequests = await database
      .select()
      .from(schema.threadEvents)
      .where(eq(schema.threadEvents.type, 'item.user_input_requested'))
      .all()

    const resolvedUserInputIds = await collectResolvedIds(
      'item.user_input_resolved'
    )

    for (const event of userInputRequests) {
      try {
        const payload = JSON.parse(event.payload) as {
          item?: { id?: string }
        }
        const requestId = payload.item?.id

        if (!requestId || resolvedUserInputIds.has(requestId)) {
          continue
        }

        await appendEvent(event.threadId, 'item.user_input_resolved', {
          type: 'item.user_input_resolved',
          item: {
            id: requestId,
            answers: {},
            error: 'app restarted',
            resolvedAt: clock().toISOString()
          }
        })
      } catch {
        // malformed row — skip
      }
    }
  }

  const recoverOrphanedThreads = async () => {
    await recoverUnresolvedApprovals()

    const orphans = await database
      .select()
      .from(schema.threads)
      .where(inArray(schema.threads.status, ['running', 'starting']))
      .all()

    for (const thread of orphans) {
      await appendEvent(thread.id, 'error', { message: interruptionMessage })

      await database
        .update(schema.threads)
        .set({
          status: 'error',
          errorMessage: interruptionMessage,
          lastActivityAt: clock()
        })
        .where(eq(schema.threads.id, thread.id))
        .run()
    }
  }

  return {
    createThread,
    continueThread,
    cancelThread,
    closeThread,
    recoverOrphanedThreads,
    respondToApproval,
    respondToUserInput
  }
}
