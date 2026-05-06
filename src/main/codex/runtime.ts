import type { LibSQLDatabase } from 'drizzle-orm/libsql'

import { createProvider } from '../agents/registry'
import * as schema from '../database/schema'
import {
  createAgentRunner,
  type AgentRunner,
  type PersistedEvent
} from './agent-runner'
import { createEventBroker, type EventBroker } from './event-broker'
import { getProviderSettings, type SafeStorageLike } from './provider-settings'

export type CodexRuntimeDependencies = {
  database: LibSQLDatabase<typeof schema>
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

  const runner = createAgentRunner({
    database,
    broker,
    providerSettings: () => getProviderSettings({ database, safeStorage }),
    createProvider
  })

  return { broker, runner }
}
