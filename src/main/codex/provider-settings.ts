import type { ResultSet } from '@libsql/client'
import { inArray } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

import * as schema from '../database/schema'

export type SafeStorageLike = {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

export type ProviderSettingsDatabase = LibSQLDatabase<typeof schema>

type ProviderSettingsExecutor = BaseSQLiteDatabase<
  'async',
  ResultSet,
  typeof schema
>

export type ProviderSettingsDependencies = {
  database: ProviderSettingsDatabase
  safeStorage: SafeStorageLike
}

export type ProviderKind = 'codex' | 'claude-code'

export type CodexCliProviderSettings = {
  kind: 'codex'
  mode: 'cli'
  binaryPath: string | null
}

export type CodexApiProviderSettings = {
  kind: 'codex'
  mode: 'api'
  apiKey: string
}

export type ClaudeCodeCliProviderSettings = {
  kind: 'claude-code'
  mode: 'cli'
  executablePath: string | null
}

export type ClaudeCodeApiProviderSettings = {
  kind: 'claude-code'
  mode: 'api'
  apiKey: string
}

/** @deprecated retained for compatibility; equivalent to `CodexCliProviderSettings`. */
export type CliProviderSettings = CodexCliProviderSettings
/** @deprecated retained for compatibility; equivalent to `CodexApiProviderSettings`. */
export type ApiProviderSettings = CodexApiProviderSettings

export type ProviderSettings =
  | CodexCliProviderSettings
  | CodexApiProviderSettings
  | ClaudeCodeCliProviderSettings
  | ClaudeCodeApiProviderSettings

export type ProviderSettingsInput =
  | { kind: 'codex'; mode: 'cli'; binaryPath?: string | null }
  | { kind: 'codex'; mode: 'api'; apiKey: string }
  | { kind: 'claude-code'; mode: 'cli'; executablePath?: string | null }
  | { kind: 'claude-code'; mode: 'api'; apiKey: string }

export type ProviderSettingsSummary =
  | { kind: 'codex'; mode: 'cli'; binaryPath: string | null }
  | { kind: 'codex'; mode: 'api'; hasApiKey: true }
  | { kind: 'claude-code'; mode: 'cli'; executablePath: string | null }
  | { kind: 'claude-code'; mode: 'api'; hasApiKey: true }

const KIND_KEY = 'provider.kind'
const MODE_KEY = 'provider.codex.mode'
const BINARY_PATH_KEY = 'provider.codex.binaryPath'
const API_KEY_ENCRYPTED_KEY = 'provider.codex.apiKeyEncrypted'
const CLAUDE_CODE_MODE_KEY = 'provider.claude-code.mode'
const CLAUDE_CODE_EXECUTABLE_PATH_KEY = 'provider.claude-code.executablePath'
const CLAUDE_CODE_API_KEY_ENCRYPTED_KEY =
  'provider.claude-code.apiKeyEncrypted'

const ALL_PROVIDER_KEYS = [
  KIND_KEY,
  MODE_KEY,
  BINARY_PATH_KEY,
  API_KEY_ENCRYPTED_KEY,
  CLAUDE_CODE_MODE_KEY,
  CLAUDE_CODE_EXECUTABLE_PATH_KEY,
  CLAUDE_CODE_API_KEY_ENCRYPTED_KEY
] as const

const readSettingsMap = async (
  database: ProviderSettingsExecutor
): Promise<Map<string, string>> => {
  const rows = await database
    .select()
    .from(schema.settings)
    .where(inArray(schema.settings.key, [...ALL_PROVIDER_KEYS]))
    .all()

  return new Map(rows.map((row) => [row.key, row.value]))
}

const upsertSetting = async (
  database: ProviderSettingsExecutor,
  key: string,
  value: string
): Promise<void> => {
  await database
    .insert(schema.settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: new Date() }
    })
    .run()
}

const deleteSettings = async (
  database: ProviderSettingsExecutor,
  keys: readonly string[]
): Promise<void> => {
  await database
    .delete(schema.settings)
    .where(inArray(schema.settings.key, [...keys]))
    .run()
}

const resolveKind = (map: Map<string, string>): ProviderKind | null => {
  const stored = map.get(KIND_KEY)

  if (stored === 'codex' || stored === 'claude-code') {
    return stored
  }

  // Backward compat: legacy installs have provider.codex.* but no provider.kind.
  if (map.has(MODE_KEY)) return 'codex'

  return null
}

export const getProviderSettings = async ({
  database,
  safeStorage
}: ProviderSettingsDependencies): Promise<ProviderSettings | null> => {
  const map = await readSettingsMap(database)
  const kind = resolveKind(map)

  if (kind === 'codex') {
    const mode = map.get(MODE_KEY)

    if (mode === 'cli') {
      return {
        kind: 'codex',
        mode: 'cli',
        binaryPath: map.get(BINARY_PATH_KEY) ?? null
      }
    }

    if (mode === 'api') {
      const encoded = map.get(API_KEY_ENCRYPTED_KEY)

      if (!encoded) return null

      const decrypted = safeStorage.decryptString(
        Buffer.from(encoded, 'base64')
      )

      return { kind: 'codex', mode: 'api', apiKey: decrypted }
    }

    return null
  }

  if (kind === 'claude-code') {
    const mode = map.get(CLAUDE_CODE_MODE_KEY)

    if (mode === 'cli') {
      return {
        kind: 'claude-code',
        mode: 'cli',
        executablePath: map.get(CLAUDE_CODE_EXECUTABLE_PATH_KEY) ?? null
      }
    }

    if (mode === 'api') {
      const encoded = map.get(CLAUDE_CODE_API_KEY_ENCRYPTED_KEY)

      if (!encoded) return null

      const decrypted = safeStorage.decryptString(
        Buffer.from(encoded, 'base64')
      )

      return { kind: 'claude-code', mode: 'api', apiKey: decrypted }
    }

    return null
  }

  return null
}

export const getProviderSettingsSummary = async ({
  database
}: ProviderSettingsDependencies): Promise<ProviderSettingsSummary | null> => {
  const map = await readSettingsMap(database)
  const kind = resolveKind(map)

  if (kind === 'codex') {
    const mode = map.get(MODE_KEY)

    if (mode === 'cli') {
      return {
        kind: 'codex',
        mode: 'cli',
        binaryPath: map.get(BINARY_PATH_KEY) ?? null
      }
    }

    if (mode === 'api' && map.has(API_KEY_ENCRYPTED_KEY)) {
      return { kind: 'codex', mode: 'api', hasApiKey: true }
    }

    return null
  }

  if (kind === 'claude-code') {
    const mode = map.get(CLAUDE_CODE_MODE_KEY)

    if (mode === 'cli') {
      return {
        kind: 'claude-code',
        mode: 'cli',
        executablePath: map.get(CLAUDE_CODE_EXECUTABLE_PATH_KEY) ?? null
      }
    }

    if (mode === 'api' && map.has(CLAUDE_CODE_API_KEY_ENCRYPTED_KEY)) {
      return { kind: 'claude-code', mode: 'api', hasApiKey: true }
    }

    return null
  }

  return null
}

export const setProviderSettings = async (
  { database, safeStorage }: ProviderSettingsDependencies,
  input: ProviderSettingsInput
): Promise<void> => {
  await database.transaction(async (tx) => {
    await deleteSettings(tx, ALL_PROVIDER_KEYS)

    await upsertSetting(tx, KIND_KEY, input.kind)

    if (input.kind === 'codex') {
      await upsertSetting(tx, MODE_KEY, input.mode)

      if (input.mode === 'cli') {
        if (input.binaryPath != null && input.binaryPath !== '') {
          await upsertSetting(tx, BINARY_PATH_KEY, input.binaryPath)
        }

        return
      }

      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'Cannot save API key: OS encryption is not available on this machine. Use CLI mode instead.'
        )
      }

      const encrypted = safeStorage.encryptString(input.apiKey)

      await upsertSetting(
        tx,
        API_KEY_ENCRYPTED_KEY,
        encrypted.toString('base64')
      )

      return
    }

    await upsertSetting(tx, CLAUDE_CODE_MODE_KEY, input.mode)

    if (input.mode === 'cli') {
      if (input.executablePath != null && input.executablePath !== '') {
        await upsertSetting(
          tx,
          CLAUDE_CODE_EXECUTABLE_PATH_KEY,
          input.executablePath
        )
      }

      return
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Cannot save API key: OS encryption is not available on this machine. Use CLI mode instead.'
      )
    }

    const encrypted = safeStorage.encryptString(input.apiKey)

    await upsertSetting(
      tx,
      CLAUDE_CODE_API_KEY_ENCRYPTED_KEY,
      encrypted.toString('base64')
    )
  })
}

export const clearProviderSettings = async ({
  database
}: ProviderSettingsDependencies): Promise<void> => {
  await deleteSettings(database, ALL_PROVIDER_KEYS)
}

export const providerSettingsKeys = {
  kind: KIND_KEY,
  codexMode: MODE_KEY,
  codexBinaryPath: BINARY_PATH_KEY,
  codexApiKeyEncrypted: API_KEY_ENCRYPTED_KEY,
  claudeCodeMode: CLAUDE_CODE_MODE_KEY,
  claudeCodeExecutablePath: CLAUDE_CODE_EXECUTABLE_PATH_KEY,
  claudeCodeApiKeyEncrypted: CLAUDE_CODE_API_KEY_ENCRYPTED_KEY,
  /** @deprecated use `codexMode` */
  mode: MODE_KEY,
  /** @deprecated use `codexBinaryPath` */
  binaryPath: BINARY_PATH_KEY,
  /** @deprecated use `codexApiKeyEncrypted` */
  apiKeyEncrypted: API_KEY_ENCRYPTED_KEY,
  all: ALL_PROVIDER_KEYS
}
