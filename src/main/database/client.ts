import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { getDatabasePath } from './paths'
import * as schema from './schema'

type DatabaseClient = ReturnType<typeof drizzle<typeof schema>>

let cachedDatabase: DatabaseClient | null = null
let cachedSqlite: Database.Database | null = null

export function getDatabase(): DatabaseClient {
  if (cachedDatabase) {
    return cachedDatabase
  }

  const sqlite = new Database(getDatabasePath())
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  cachedSqlite = sqlite
  cachedDatabase = drizzle(sqlite, { schema })

  return cachedDatabase
}

export function getSqliteHandle(): Database.Database {
  if (!cachedSqlite) {
    getDatabase()
  }

  return cachedSqlite as Database.Database
}
