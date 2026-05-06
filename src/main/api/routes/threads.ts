import { zValidator } from '@hono/zod-validator'
import { asc, eq, isNull } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'

import type { AgentRunner, PersistedEvent } from '../../codex/agent-runner'
import type { EventBroker } from '../../codex/event-broker'
import * as schema from '../../database/schema'

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
  initialMessage: z.string().min(1).max(20_000).optional()
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

    return context.json({ threads })
  })

  routes.post(
    '/threads',
    zValidator('json', createThreadSchema),
    async (context) => {
      const body = context.req.valid('json')

      try {
        const thread = await runner.createThread({
          directoryPath: body.directoryPath,
          name: body.name
        })

        if (body.initialMessage) {
          await runner.continueThread(thread.id, body.initialMessage)
        }

        const refreshed = await database
          .select()
          .from(schema.threads)
          .where(eq(schema.threads.id, thread.id))
          .get()

        return context.json({ thread: refreshed ?? thread }, 201)
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
      thread,
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

      return context.json({ thread: row })
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
