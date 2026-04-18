import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { createProvider } from '../agents/registry'
import { getWorktreesDirectory } from '../database/paths'
import * as schema from '../database/schema'
import {
  createAgentRunner,
  type AgentRunner,
  type PersistedEvent
} from './agent-runner'
import { generateMergeCommitMessage } from './commit-message'
import {
  createEventBroker,
  type EventBroker
} from './event-broker'
import { mergeTaskBranch } from './merge'
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

  const generateMessage = async (input: {
    taskTitle: string
    diff: string
    worktreePath: string
  }) => {
    const settings = getProviderSettings({ database, safeStorage })

    if (settings == null) return null

    const provider = await createProvider(settings)

    return generateMergeCommitMessage(
      {
        runAgent: ({ prompt, workingDirectory }) =>
          provider.runOneOff({ prompt, workingDirectory })
      },
      input
    )
  }

  const runner = createAgentRunner({
    database,
    broker,
    providerSettings: () => getProviderSettings({ database, safeStorage }),
    createProvider,
    worktree: {
      create: async (args) => createWorktree(worktreeDeps, args),
      remove: async (args) => removeWorktree(worktreeDeps, args)
    },
    merge: async (args) => mergeTaskBranch({ git, generateMessage }, args),
    resolveProjectHead: async ({ directoryPath }) => {
      const result = await git(['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: directoryPath
      })

      return {
        branchName: result.exitCode === 0 ? result.stdout.trim() : null
      }
    }
  })

  return { broker, runner }
}
