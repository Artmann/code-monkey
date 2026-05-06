import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { getDatabase } from './client'

function resolveMigrationsFolder(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'migrations')
  }

  const distCandidate = join(app.getAppPath(), 'dist', 'migrations')

  if (existsSync(distCandidate)) {
    return distCandidate
  }

  return join(app.getAppPath(), 'src', 'main', 'database', 'migrations')
}

export async function runMigrations(): Promise<void> {
  const database = await getDatabase()
  const migrationsFolder = resolveMigrationsFolder()

  await migrate(database, { migrationsFolder })
}
