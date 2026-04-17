import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, asc, eq, isNull, max } from 'drizzle-orm'
import invariant from 'tiny-invariant'
import { z } from 'zod'
import { getDatabase } from '../../database/client'
import { agentStateValues, tasks, taskStatusValues } from '../../database/schema'

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

export const tasksRoutes = new Hono()

tasksRoutes.get('/', zValidator('query', listQuerySchema), (context) => {
  const { projectId } = context.req.valid('query')
  const database = getDatabase()

  const rows = database
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
    .all()

  return context.json({ tasks: rows })
})

tasksRoutes.post('/', zValidator('json', createTaskSchema), (context) => {
  const body = context.req.valid('json')
  const database = getDatabase()
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

tasksRoutes.patch('/:id', zValidator('json', updateTaskSchema), (context) => {
  const id = context.req.param('id')
  const body = context.req.valid('json')
  const database = getDatabase()

  const [row] = database
    .update(tasks)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
    .returning()
    .all()

  if (!row) {
    return context.json({ error: 'Not found' }, 404)
  }

  return context.json({ task: row })
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

tasksRoutes.post(
  '/reorder',
  zValidator('json', reorderSchema),
  (context) => {
    const { projectId, updates } = context.req.valid('json')
    const database = getDatabase()

    database.transaction((transaction) => {
      for (const update of updates) {
        transaction
          .update(tasks)
          .set({
            status: update.status,
            sortOrder: update.sortOrder,
            updatedAt: new Date()
          })
          .where(and(eq(tasks.id, update.id), eq(tasks.projectId, projectId)))
          .run()
      }
    })

    const rows = database
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))
      .all()

    return context.json({ tasks: rows })
  }
)

tasksRoutes.delete('/:id', (context) => {
  const id = context.req.param('id')
  const database = getDatabase()

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
