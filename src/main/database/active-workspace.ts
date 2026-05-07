import { eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import invariant from 'tiny-invariant'

import * as schema from './schema'

export const activeWorkspaceSettingKey = 'activeWorkspaceId'

type Database = LibSQLDatabase<typeof schema>

export const getActiveWorkspaceId = async (
  database: Database
): Promise<string> => {
  const row = await database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, activeWorkspaceSettingKey))
    .get()

  if (row?.value) {
    return row.value
  }

  const fallback = await database
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .orderBy(schema.workspaces.sortOrder)
    .get()

  invariant(
    fallback,
    'No workspaces exist; migration 0008 should have seeded one'
  )

  await setActiveWorkspaceId(database, fallback.id)

  return fallback.id
}

export const setActiveWorkspaceId = async (
  database: Database,
  workspaceId: string
): Promise<void> => {
  await database
    .insert(schema.settings)
    .values({
      key: activeWorkspaceSettingKey,
      value: workspaceId,
      updatedAt: new Date()
    })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: workspaceId, updatedAt: new Date() }
    })
    .run()
}
