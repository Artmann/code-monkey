import { createClient } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'

import { getDatabasePath } from './paths'
import * as schema from './schema'

type DatabaseClient = LibSQLDatabase<typeof schema>

let cachedDatabase: DatabaseClient | null = null

export async function getDatabase(): Promise<DatabaseClient> {
  if (cachedDatabase) {
    return cachedDatabase
  }

  const client = createClient({ url: `file:${getDatabasePath()}` })

  await client.execute('PRAGMA journal_mode = WAL')
  await client.execute('PRAGMA foreign_keys = ON')

  cachedDatabase = drizzle(client, { schema })

  return cachedDatabase
}
