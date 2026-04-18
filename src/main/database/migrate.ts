import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getDatabase } from './client'

function resolveMigrationsFolder(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'migrations')
  }

  // Tarball layout used by `npx @artmann/codemonkey`: migrations live next
  // to the compiled main bundle under dist/.
  const distCandidate = join(app.getAppPath(), 'dist', 'migrations')

  if (existsSync(distCandidate)) {
    return distCandidate
  }

  return join(app.getAppPath(), 'src', 'main', 'database', 'migrations')
}

export function runMigrations(): void {
  const database = getDatabase()
  const migrationsFolder = resolveMigrationsFolder()

  migrate(database, { migrationsFolder })
}
