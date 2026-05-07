import { zValidator } from '@hono/zod-validator'
import { asc, eq, max } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  getActiveWorkspaceId,
  setActiveWorkspaceId
} from '../../database/active-workspace'
import * as schema from '../../database/schema'

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80)
})

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  lastActiveThreadId: z.string().min(1).nullable().optional()
})

const setActiveSchema = z.object({
  workspaceId: z.string().min(1)
})

export type WorkspacesRoutesDependencies = {
  database: LibSQLDatabase<typeof schema>
}

export const createWorkspacesRoutes = (
  dependencies: WorkspacesRoutesDependencies
) => {
  const { database } = dependencies

  const routes = new Hono()

  routes.get('/', async (context) => {
    const workspaces = await database
      .select()
      .from(schema.workspaces)
      .orderBy(asc(schema.workspaces.sortOrder), asc(schema.workspaces.createdAt))
      .all()

    const activeWorkspaceId = await getActiveWorkspaceId(database)

    return context.json({ workspaces, activeWorkspaceId })
  })

  routes.post(
    '/',
    zValidator('json', createWorkspaceSchema),
    async (context) => {
      const body = context.req.valid('json')

      const lastSortOrderRow = await database
        .select({ value: max(schema.workspaces.sortOrder) })
        .from(schema.workspaces)
        .all()
      const nextSortOrder = (lastSortOrderRow[0]?.value ?? -1) + 1

      const rows = await database
        .insert(schema.workspaces)
        .values({
          name: body.name,
          sortOrder: nextSortOrder
        })
        .returning()
        .all()

      const row = rows[0]

      if (!row) {
        return context.json({ error: 'Failed to create workspace' }, 500)
      }

      return context.json({ workspace: row }, 201)
    }
  )

  routes.patch(
    '/:workspaceId',
    zValidator('json', updateWorkspaceSchema),
    async (context) => {
      const workspaceId = context.req.param('workspaceId')
      const body = context.req.valid('json')

      const updates: Partial<schema.NewWorkspace> = {}

      if (body.name !== undefined) {
        updates.name = body.name
      }

      if (body.sortOrder !== undefined) {
        updates.sortOrder = body.sortOrder
      }

      if (body.lastActiveThreadId !== undefined) {
        updates.lastActiveThreadId = body.lastActiveThreadId
      }

      if (Object.keys(updates).length === 0) {
        return context.json({ error: 'No updates provided' }, 400)
      }

      const rows = await database
        .update(schema.workspaces)
        .set(updates)
        .where(eq(schema.workspaces.id, workspaceId))
        .returning()
        .all()

      const row = rows[0]

      if (!row) {
        return context.json({ error: 'Workspace not found' }, 404)
      }

      return context.json({ workspace: row })
    }
  )

  routes.delete('/:workspaceId', async (context) => {
    const workspaceId = context.req.param('workspaceId')

    const allWorkspaces = await database
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .all()

    if (allWorkspaces.length <= 1) {
      return context.json(
        { error: 'Cannot delete the last remaining workspace.' },
        409
      )
    }

    // Refuse to delete a workspace that still owns any threads, open or
    // closed. Threads carry an immutable workspaceId and the FK is RESTRICT,
    // so attempting the delete with rows present would otherwise fail at the
    // DB layer. v1 has no transcript-purge flow — when one lands, swap this
    // for a cascade with a stronger confirmation dialog.
    const ownedThreads = await database
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(eq(schema.threads.workspaceId, workspaceId))
      .all()

    if (ownedThreads.length > 0) {
      return context.json(
        {
          error: `Workspace still has ${ownedThreads.length} thread(s). Close them first.`
        },
        409
      )
    }

    const deleted = await database
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .returning()
      .all()

    if (deleted.length === 0) {
      return context.json({ error: 'Workspace not found' }, 404)
    }

    const activeId = await getActiveWorkspaceId(database)

    if (activeId === workspaceId) {
      const fallback = await database
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .orderBy(asc(schema.workspaces.sortOrder))
        .get()

      if (fallback) {
        await setActiveWorkspaceId(database, fallback.id)
      }
    }

    return context.json({ ok: true })
  })

  routes.post(
    '/active',
    zValidator('json', setActiveSchema),
    async (context) => {
      const body = context.req.valid('json')

      const workspace = await database
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, body.workspaceId))
        .get()

      if (!workspace) {
        return context.json({ error: 'Workspace not found' }, 404)
      }

      await setActiveWorkspaceId(database, body.workspaceId)

      return context.json({ activeWorkspaceId: body.workspaceId })
    }
  )

  return routes
}
