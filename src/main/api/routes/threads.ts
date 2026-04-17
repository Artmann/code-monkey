import { zValidator } from '@hono/zod-validator'
import { asc, eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'

import type { AgentRunner, PersistedEvent } from '../../codex/agent-runner'
import type { EventBroker } from '../../codex/event-broker'
import * as schema from '../../database/schema'

const messageSchema = z.object({
  text: z.string().min(1).max(20_000)
})

export type ThreadsRoutesDependencies = {
  database: BetterSQLite3Database<typeof schema>
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

  routes.post('/tasks/:taskId/threads', async (context) => {
    const taskId = context.req.param('taskId')

    try {
      const { threadId } = await runner.start(taskId)

      const thread = database
        .select()
        .from(schema.threads)
        .where(eq(schema.threads.id, threadId))
        .get()

      return context.json({ thread }, 201)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      return context.json({ error: message }, 500)
    }
  })

  routes.get('/threads/:threadId', (context) => {
    const threadId = context.req.param('threadId')

    const thread = database
      .select()
      .from(schema.threads)
      .where(eq(schema.threads.id, threadId))
      .get()

    if (!thread) {
      return context.json({ error: 'Thread not found' }, 404)
    }

    const events = database
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

  routes.post(
    '/threads/:threadId/messages',
    zValidator('json', messageSchema),
    async (context) => {
      const threadId = context.req.param('threadId')
      const body = context.req.valid('json')

      const thread = database
        .select()
        .from(schema.threads)
        .where(eq(schema.threads.id, threadId))
        .get()

      if (!thread) {
        return context.json({ error: 'Thread not found' }, 404)
      }

      try {
        await runner.continueThread(threadId, body.text)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

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
        for (const unsub of subscribers) unsub()
      })

      await new Promise<void>((resolutionHandler) => {
        subscribers.push(resolutionHandler)
      })
    })
  })

  return routes
}
