import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { and, desc, eq, isNull } from 'drizzle-orm'
import invariant from 'tiny-invariant'
import { z } from 'zod'

import { getDatabase } from '../../database/client'
import { projects } from '../../database/schema'

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  directoryPath: z.string().min(1)
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  directoryPath: z.string().min(1).optional()
})

export const projectsRoutes = new Hono()

projectsRoutes.get('/', (context) => {
  const database = getDatabase()

  const rows = database
    .select()
    .from(projects)
    .where(isNull(projects.deletedAt))
    .orderBy(desc(projects.createdAt))
    .all()

  return context.json({ projects: rows })
})

projectsRoutes.post('/', zValidator('json', createProjectSchema), (context) => {
  const body = context.req.valid('json')
  const database = getDatabase()

  const [row] = database.insert(projects).values(body).returning().all()

  invariant(row, 'Insert failed to return a row')

  return context.json({ project: row }, 201)
})

projectsRoutes.patch(
  '/:id',
  zValidator('json', updateProjectSchema),
  (context) => {
    const id = context.req.param('id')
    const body = context.req.valid('json')
    const database = getDatabase()

    const [row] = database
      .update(projects)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .returning()
      .all()

    if (!row) {
      return context.json({ error: 'Not found' }, 404)
    }

    return context.json({ project: row })
  }
)

projectsRoutes.delete('/:id', (context) => {
  const id = context.req.param('id')
  const database = getDatabase()

  const [row] = database
    .update(projects)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
    .returning()
    .all()

  if (!row) {
    return context.json({ error: 'Not found' }, 404)
  }

  return context.json({ project: row })
})
