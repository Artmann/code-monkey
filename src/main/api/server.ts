import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { secureHeaders } from 'hono/secure-headers'
import { projectsRoutes } from './routes/projects'
import { tasksRoutes } from './routes/tasks'

export async function startApiServer(): Promise<number> {
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
