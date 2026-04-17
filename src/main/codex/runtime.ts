import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { getWorktreesDirectory } from '../database/paths'
import * as schema from '../database/schema'
import {
  createAgentRunner,
  type AgentRunner,
  type PersistedEvent
} from './agent-runner'
import { createCodex } from './codex-client'
import {
  createEventBroker,
  type EventBroker
} from './event-broker'
import {
  getProviderSettings,
  type SafeStorageLike
} from './provider-settings'
import {
  createNodeFsDependencies,
  createNodeGitExecutor,
  createWorktree,
  removeWorktree
} from './worktree'

export type CodexRuntimeDependencies = {
  database: BetterSQLite3Database<typeof schema>
  safeStorage: SafeStorageLike
}

export type CodexRuntime = {
  broker: EventBroker<PersistedEvent>
  runner: AgentRunner
}

export const createCodexRuntime = (
  dependencies: CodexRuntimeDependencies
): CodexRuntime => {
  const { database, safeStorage } = dependencies

  const broker = createEventBroker<PersistedEvent>()
  const git = createNodeGitExecutor()
  const fs = createNodeFsDependencies()
  const worktreesRoot = getWorktreesDirectory()
  const worktreeDeps = { git, worktreesRoot, ...fs }

  const runner = createAgentRunner({
    database,
    broker,
    providerSettings: () => getProviderSettings({ database, safeStorage }),
    createCodex,
    worktree: {
      create: async (args) => createWorktree(worktreeDeps, args),
      remove: async (args) => removeWorktree(worktreeDeps, args)
    }
  })

  return { broker, runner }
}
