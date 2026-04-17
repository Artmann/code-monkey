import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function getAppDataDirectory(): string {
  const directory = join(homedir(), '.code-monkey')

  mkdirSync(directory, { recursive: true })

  return directory
}

export function getDatabasePath(): string {
  return join(getAppDataDirectory(), 'code-monkey.db')
}

export function getWorktreesDirectory(): string {
  const directory = join(getAppDataDirectory(), 'worktrees')

  mkdirSync(directory, { recursive: true })

  return directory
}
