import { zValidator } from '@hono/zod-validator'
import { asc, eq, inArray, isNull } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'

import type { AgentRunner, PersistedEvent } from '../../codex/agent-runner'
import type { EventBroker } from '../../codex/event-broker'
import { getActiveWorkspaceId } from '../../database/active-workspace'
import * as schema from '../../database/schema'

// Event types that signal "the agent is waiting on the user". We pair each
// _requested with the matching _resolved to know whether the wait is still
// active. Keeping the lists tiny lets us scan thread events in a single
// pass per thread when building the /threads response.
const AWAITING_INPUT_REQUEST_TYPES = new Set([
  'item.approval_requested',
  'item.user_input_requested'
])

const AWAITING_INPUT_RESOLVED_TYPES = new Set([
  'item.approval_resolved',
  'item.user_input_resolved'
])

// 'code' = full-access (default agent behaviour); 'plan' = SDK plan mode
// where the agent thinks aloud without executing tools. Kept narrow on the
// API surface so the wider RuntimeMode union stays an internal concern.
const messageSchema = z.object({
  text: z.string().min(1).max(20_000),
  mode: z.enum(['code', 'plan']).optional()
})

const createThreadSchema = z.object({
  directoryPath: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  initialMessage: z.string().min(1).max(20_000).optional(),
  workspaceId: z.string().min(1).optional()
})

const updateThreadSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  tabOrder: z.number().int().nonnegative().optional()
})

const approvalSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve') }),
  z.object({
    decision: z.literal('reject'),
    reason: z.string().max(2_000).optional()
  })
])

const userInputSchema = z.object({
  answers: z.record(z.string(), z.string())
})

export type ThreadsRoutesDependencies = {
  database: LibSQLDatabase<typeof schema>
  broker: EventBroker<PersistedEvent>
  runner: AgentRunner
}

const parsePayload = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

// True when there is at least one approval/user-input request whose matching
// resolution event has not yet been recorded. We scan once, gather resolved
// item ids, then look for the latest unresolved request of either kind.
const computeAwaitingInput = (
  events: Array<{ type: string; payload: string }>
): boolean => {
  const resolvedItemIds = new Set<string>()

  for (const event of events) {
    if (!AWAITING_INPUT_RESOLVED_TYPES.has(event.type)) {
      continue
    }

    const itemId = readItemId(event.payload)

    if (itemId) {
      resolvedItemIds.add(itemId)
    }
  }

  for (const event of events) {
    if (!AWAITING_INPUT_REQUEST_TYPES.has(event.type)) {
      continue
    }

    const itemId = readItemId(event.payload)

    if (itemId && !resolvedItemIds.has(itemId)) {
      return true
    }
  }

  return false
}

const readItemId = (rawPayload: string): string | null => {
  const parsed = parsePayload(rawPayload)

  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const item = (parsed as { item?: { id?: unknown } }).item

  if (!item || typeof item !== 'object') {
    return null
  }

  const id = (item as { id?: unknown }).id

  return typeof id === 'string' ? id : null
}

export const createThreadsRoutes = (
  dependencies: ThreadsRoutesDependencies
) => {
  const { database, broker, runner } = dependencies

  const routes = new Hono()

  routes.get('/threads', async (context) => {
    const threads = await database
      .select()
      .from(schema.threads)
      .where(isNull(schema.threads.closedAt))
      .orderBy(asc(schema.threads.tabOrder))
      .all()

    if (threads.length === 0) {
      return context.json({ threads: [] })
    }

    // Pull only the event columns we need to derive awaitingInput in one
    // round-trip, then bucket by threadId. Cheaper than firing one query
    // per thread when there are many open tabs.
    const threadIds = threads.map((thread) => thread.id)

    const relevantEvents = await database
      .select({
        threadId: schema.threadEvents.threadId,
        type: schema.threadEvents.type,
        payload: schema.threadEvents.payload
      })
      .from(schema.threadEvents)
      .where(inArray(schema.threadEvents.threadId, threadIds))
      .all()

    const eventsByThread = new Map<
      string,
      Array<{ type: string; payload: string }>
    >()

    for (const event of relevantEvents) {
      if (
        !AWAITING_INPUT_REQUEST_TYPES.has(event.type) &&
        !AWAITING_INPUT_RESOLVED_TYPES.has(event.type)
      ) {
        continue
      }

      const bucket = eventsByThread.get(event.threadId) ?? []

      bucket.push({ type: event.type, payload: event.payload })
      eventsByThread.set(event.threadId, bucket)
    }

    const enriched = threads.map((thread) => ({
      ...thread,
      awaitingInput: computeAwaitingInput(eventsByThread.get(thread.id) ?? [])
    }))

    return context.json({ threads: enriched })
  })

  routes.post(
    '/threads',
    zValidator('json', createThreadSchema),
    async (context) => {
      const body = context.req.valid('json')

      try {
        const workspaceId =
          body.workspaceId ?? (await getActiveWorkspaceId(database))

        const thread = await runner.createThread({
          directoryPath: body.directoryPath,
          name: body.name,
          workspaceId
        })

        if (body.initialMessage) {
          await runner.continueThread(thread.id, body.initialMessage)
        }

        const refreshed = await database
          .select()
          .from(schema.threads)
          .where(eq(schema.threads.id, thread.id))
          .get()

        const base = refreshed ?? thread

        // A freshly created thread has no events yet, so it can't possibly
        // be awaiting input. Stamp the flag explicitly so the response shape
        // matches the list endpoint and the frontend Thread type.
        return context.json({ thread: { ...base, awaitingInput: false } }, 201)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        return context.json({ error: message }, 500)
      }
    }
  )

  routes.get('/threads/:threadId', async (context) => {
    const threadId = context.req.param('threadId')

    const thread = await database
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.id, threadId))
      .get()

    if (!thread) {
      return context.json({ error: 'Thread not found' }, 404)
    }

    const events = await database
      .select()
      .from(schema.threadEvents)
      .where(eq(schema.threadEvents.threadId, threadId))
      .orderBy(asc(schema.threadEvents.sequence))
      .all()

    return context.json({
      thread: {
        ...thread,
        awaitingInput: computeAwaitingInput(
          events
            .filter(
              (event) =>
                AWAITING_INPUT_REQUEST_TYPES.has(event.type) ||
                AWAITING_INPUT_RESOLVED_TYPES.has(event.type)
            )
            .map((event) => ({ type: event.type, payload: event.payload }))
        )
      },
      events: events.map((event) => ({
        ...event,
        payload: parsePayload(event.payload)
      }))
    })
  })

  routes.patch(
    '/threads/:threadId',
    zValidator('json', updateThreadSchema),
    async (context) => {
      const threadId = context.req.param('threadId')
      const body = context.req.valid('json')

      const updates: Partial<schema.NewThread> = {}

      if (body.name !== undefined) {
        updates.name = body.name
      }

      if (body.tabOrder !== undefined) {
        updates.tabOrder = body.tabOrder
      }

      if (Object.keys(updates).length === 0) {
        return context.json({ error: 'No updates provided' }, 400)
      }

      const rows = await database
        .update(schema.threads)
        .set(updates)
        .where(eq(schema.threads.id, threadId))
        .returning()
        .all()

      const row = rows[0]

      if (!row) {
        return context.json({ error: 'Thread not found' }, 404)
      }

      // Preserve the awaitingInput flag on rename/reorder by recomputing
      // from the thread's events. Cheaper than a second full DB query and
      // keeps the response shape uniform across endpoints.
      const events = await database
        .select({
          type: schema.threadEvents.type,
          payload: schema.threadEvents.payload
        })
        .from(schema.threadEvents)
        .where(eq(schema.threadEvents.threadId, threadId))
        .all()

      const awaitingInput = computeAwaitingInput(
        events.filter(
          (event) =>
            AWAITING_INPUT_REQUEST_TYPES.has(event.type) ||
            AWAITING_INPUT_RESOLVED_TYPES.has(event.type)
        )
      )

      return context.json({ thread: { ...row, awaitingInput } })
    }
  )

  routes.delete('/threads/:threadId', async (context) => {
    const threadId = context.req.param('threadId')

    await runner.closeThread(threadId)

    return context.json({ ok: true })
  })

  routes.post('/threads/:threadId/cancel', async (context) => {
    const threadId = context.req.param('threadId')

    try {
      await runner.cancelThread(threadId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return context.json({ error: message }, 500)
    }

    return context.json({ ok: true }, 202)
  })

  routes.post(
    '/threads/:threadId/messages',
    zValidator('json', messageSchema),
    async (context) => {
      const threadId = context.req.param('threadId')
      const body = context.req.valid('json')

      const thread = await database
        .select()
        .from(schema.threads)
        .where(eq(schema.threads.id, threadId))
        .get()

      if (!thread) {
        return context.json({ error: 'Thread not found' }, 404)
      }

      const runtimeMode = body.mode === 'plan' ? 'plan' : 'full-access'

      try {
        await runner.continueThread(threadId, body.text, runtimeMode)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        return context.json({ error: message }, 500)
      }

      return context.json({ ok: true }, 202)
    }
  )

  routes.post(
    '/threads/:threadId/approvals/:requestId',
    zValidator('json', approvalSchema),
    async (context) => {
      const threadId = context.req.param('threadId')
      const requestId = context.req.param('requestId')
      const decision = context.req.valid('json')

      try {
        await runner.respondToApproval(threadId, requestId, decision)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        if (message.startsWith('No pending approval matches')) {
          return context.json({ error: message }, 409)
        }

        return context.json({ error: message }, 500)
      }

      return context.json({ ok: true }, 202)
    }
  )

  routes.post(
    '/threads/:threadId/user-inputs/:requestId',
    zValidator('json', userInputSchema),
    async (context) => {
      const threadId = context.req.param('threadId')
      const requestId = context.req.param('requestId')
      const body = context.req.valid('json')

      try {
        await runner.respondToUserInput(threadId, requestId, body.answers)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        if (message.startsWith('No pending user-input matches')) {
          return context.json({ error: message }, 409)
        }

        return context.json({ error: message }, 500)
      }

      return context.json({ ok: true }, 202)
    }
  )

  routes.get('/threads/:threadId/stream', (context) => {
    const threadId = context.req.param('threadId')

    return streamSSE(context, async (stream) => {
      const subscribers: Array<() => void> = []

      const unsubscribe = broker.subscribe(threadId, (event) => {
        void stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
          id: String(event.sequence)
        })
      })

      subscribers.push(unsubscribe)

      stream.onAbort(() => {
        for (const unsub of subscribers) {
          unsub()
        }
      })

      await new Promise<void>((resolutionHandler) => {
        subscribers.push(resolutionHandler)
      })
    })
  })

  return routes
}
