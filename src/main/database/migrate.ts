import { join } from 'node:path'
import { app } from 'electron'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getDatabase } from './client'

function resolveMigrationsFolder(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'migrations')
  }

  return join(app.getAppPath(), 'src/main/database/migrations')
}

export function runMigrations(): void {
  const database = getDatabase()
  const migrationsFolder = resolveMigrationsFolder()

  migrate(database, { migrationsFolder })
}
