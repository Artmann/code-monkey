import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, isNull, max } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import invariant from 'tiny-invariant'
import { z } from 'zod'

import type { AgentRunner } from '../../codex/agent-runner'
import * as schema from '../../database/schema'
import { agentStateValues, taskStatusValues, tasks } from '../../database/schema'

const statusSchema = z.enum(taskStatusValues)
const agentStateSchema = z.enum(agentStateValues)

const listQuerySchema = z.object({
  projectId: z.string().min(1)
})

const createTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional().nullable(),
  status: statusSchema.optional(),
  agentState: agentStateSchema.optional()
})

const updateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10_000).nullable().optional(),
  status: statusSchema.optional(),
  agentState: agentStateSchema.optional()
})

const reorderSchema = z.object({
  projectId: z.string().min(1),
  updates: z
    .array(
      z.object({
        id: z.string().min(1),
        status: statusSchema,
        sortOrder: z.number().int().nonnegative()
      })
    )
    .max(10_000)
})

export type TasksRoutesDependencies = {
  database: BetterSQLite3Database<typeof schema>
  runner: AgentRunner
}

export const createTasksRoutes = (
  dependencies: TasksRoutesDependencies
) => {
  const { database, runner } = dependencies

  const routes = new Hono()

  routes.get('/', zValidator('query', listQuerySchema), (context) => {
    const { projectId } = context.req.valid('query')

    const rows = database
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
      .all()

    return context.json({ tasks: rows })
  })

  routes.post('/', zValidator('json', createTaskSchema), (context) => {
    const body = context.req.valid('json')
    const status = body.status ?? 'todo'

    const [maxRow] = database
      .select({ value: max(tasks.sortOrder) })
      .from(tasks)
      .where(and(eq(tasks.projectId, body.projectId), eq(tasks.status, status)))
      .all()

    const nextOrder = (maxRow?.value ?? -1) + 1

    const [row] = database
      .insert(tasks)
      .values({
        projectId: body.projectId,
        title: body.title,
        description: body.description ?? null,
        status,
        agentState: body.agentState ?? 'idle',
        sortOrder: nextOrder
      })
      .returning()
      .all()

    invariant(row, 'Insert failed to return a row')

    return context.json({ task: row }, 201)
  })

  routes.patch(
    '/:id',
    zValidator('json', updateTaskSchema),
    async (context) => {
      const id = context.req.param('id')
      const body = context.req.valid('json')

      const [row] = database
        .update(tasks)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
        .returning()
        .all()

      if (!row) {
        return context.json({ error: 'Not found' }, 404)
      }

      if (body.status === 'in_progress') {
        await maybeAutoStart(database, runner, id)
      }

      return context.json({ task: row })
    }
  )

  routes.post(
    '/reorder',
    zValidator('json', reorderSchema),
    async (context) => {
      const { projectId, updates } = context.req.valid('json')

      const previousById = new Map(
        database
          .select({ id: tasks.id, status: tasks.status })
          .from(tasks)
          .where(
            and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt))
          )
          .all()
          .map((entry) => [entry.id, entry.status])
      )

      database.transaction((transaction) => {
        for (const update of updates) {
          transaction
            .update(tasks)
            .set({
              status: update.status,
              sortOrder: update.sortOrder,
              updatedAt: new Date()
            })
            .where(
              and(eq(tasks.id, update.id), eq(tasks.projectId, projectId))
            )
            .run()
        }
      })

      const promoted = updates.filter(
        (update) =>
          update.status === 'in_progress' &&
          previousById.get(update.id) !== 'in_progress'
      )

      for (const update of promoted) {
        await maybeAutoStart(database, runner, update.id)
      }

      const rows = database
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
        .all()

      return context.json({ tasks: rows })
    }
  )

  routes.delete('/:id', (context) => {
    const id = context.req.param('id')

    const [row] = database
      .update(tasks)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
      .returning()
      .all()

    if (!row) {
      return context.json({ error: 'Not found' }, 404)
    }

    return context.json({ task: row })
  })

  return routes
}

async function maybeAutoStart(
  database: BetterSQLite3Database<typeof schema>,
  runner: AgentRunner,
  taskId: string
) {
  const [existing] = database
    .select({ id: schema.threads.id })
    .from(schema.threads)
    .where(eq(schema.threads.taskId, taskId))
    .limit(1)
    .all()

  if (existing) {
    return
  }

  try {
    await runner.start(taskId)
  } catch (error) {
    console.error('[code-monkey] auto-start failed', error)
  }
}
