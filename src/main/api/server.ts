import { serve } from '@hono/node-server'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'

import type {
  AgentRunner,
  PersistedEvent
} from '../codex/agent-runner'
import type { EventBroker } from '../codex/event-broker'
import type { SafeStorageLike } from '../codex/provider-settings'
import * as schema from '../database/schema'
import { projectsRoutes } from './routes/projects'
import { createSettingsRoutes } from './routes/settings'
import { tasksRoutes } from './routes/tasks'
import { createThreadsRoutes } from './routes/threads'

export type ApiServerDependencies = {
  database: BetterSQLite3Database<typeof schema>
  safeStorage: SafeStorageLike
  broker: EventBroker<PersistedEvent>
  runner: AgentRunner
}

export async function startApiServer(
  dependencies: ApiServerDependencies
): Promise<number> {
  const app = new Hono()

  app.use('*', logger())
  app.use('*', secureHeaders())
  app.use('*', prettyJSON())
  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
      maxAge: 600
    })
  )

  app.get('/health', (context) => context.json({ ok: true }))
  app.route('/projects', projectsRoutes)
  app.route('/tasks', tasksRoutes)
  app.route('/settings', createSettingsRoutes(dependencies))
  app.route('/', createThreadsRoutes(dependencies))

  app.onError((error, context) => {
    console.error('[code-monkey] API error', error)

    return context.json({ error: error.message }, 500)
  })

  return new Promise((resolve) => {
    serve(
      { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
      (info) => {
        resolve(info.port)
      }
    )
  })
}
