import { inArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import * as schema from '../database/schema'

export type SafeStorageLike = {
  isEncryptionAvailable: () => boolean
  encryptString: (plain: string) => Buffer
  decryptString: (encrypted: Buffer) => string
}

export type ProviderSettingsDependencies = {
  database: BetterSQLite3Database<typeof schema>
  safeStorage: SafeStorageLike
}

export type CliProviderSettings = {
  mode: 'cli'
  binaryPath: string | null
}

export type ApiProviderSettings = {
  mode: 'api'
  apiKey: string
}

export type ProviderSettings = CliProviderSettings | ApiProviderSettings

export type ProviderSettingsInput =
  | { mode: 'cli'; binaryPath?: string | null }
  | { mode: 'api'; apiKey: string }

export type ProviderSettingsSummary =
  | { mode: 'cli'; binaryPath: string | null }
  | { mode: 'api'; hasApiKey: true }

const MODE_KEY = 'provider.codex.mode'
const BINARY_PATH_KEY = 'provider.codex.binaryPath'
const API_KEY_ENCRYPTED_KEY = 'provider.codex.apiKeyEncrypted'

const ALL_PROVIDER_KEYS = [
  MODE_KEY,
  BINARY_PATH_KEY,
  API_KEY_ENCRYPTED_KEY
] as const

const readSettingsMap = (
  database: ProviderSettingsDependencies['database']
): Map<string, string> => {
  const rows = database
    .select()
    .from(schema.settings)
    .where(inArray(schema.settings.key, [...ALL_PROVIDER_KEYS]))
    .all()

  return new Map(rows.map((row) => [row.key, row.value]))
}

const upsertSetting = (
  database: ProviderSettingsDependencies['database'],
  key: string,
  value: string
) => {
  database
    .insert(schema.settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: new Date() }
    })
    .run()
}

const deleteSettings = (
  database: ProviderSettingsDependencies['database'],
  keys: readonly string[]
) => {
  database
    .delete(schema.settings)
    .where(inArray(schema.settings.key, [...keys]))
    .run()
}

export const getProviderSettings = ({
  database,
  safeStorage
}: ProviderSettingsDependencies): ProviderSettings | null => {
  const map = readSettingsMap(database)
  const mode = map.get(MODE_KEY)

  if (mode === 'cli') {
    return { mode: 'cli', binaryPath: map.get(BINARY_PATH_KEY) ?? null }
  }

  if (mode === 'api') {
    const encoded = map.get(API_KEY_ENCRYPTED_KEY)

    if (!encoded) return null

    const decrypted = safeStorage.decryptString(
      Buffer.from(encoded, 'base64')
    )

    return { mode: 'api', apiKey: decrypted }
  }

  return null
}

export const getProviderSettingsSummary = ({
  database
}: ProviderSettingsDependencies): ProviderSettingsSummary | null => {
  const map = readSettingsMap(database)
  const mode = map.get(MODE_KEY)

  if (mode === 'cli') {
    return { mode: 'cli', binaryPath: map.get(BINARY_PATH_KEY) ?? null }
  }

  if (mode === 'api' && map.has(API_KEY_ENCRYPTED_KEY)) {
    return { mode: 'api', hasApiKey: true }
  }

  return null
}

export const setProviderSettings = (
  { database, safeStorage }: ProviderSettingsDependencies,
  input: ProviderSettingsInput
): void => {
  database.transaction((tx) => {
    deleteSettings(tx, ALL_PROVIDER_KEYS)

    upsertSetting(tx, MODE_KEY, input.mode)

    if (input.mode === 'cli') {
      if (input.binaryPath != null && input.binaryPath !== '') {
        upsertSetting(tx, BINARY_PATH_KEY, input.binaryPath)
      }

      return
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Cannot save API key: OS encryption is not available on this machine. Use CLI mode instead.'
      )
    }

    const encrypted = safeStorage.encryptString(input.apiKey)

    upsertSetting(tx, API_KEY_ENCRYPTED_KEY, encrypted.toString('base64'))
  })
}

export const clearProviderSettings = ({
  database
}: ProviderSettingsDependencies): void => {
  deleteSettings(database, ALL_PROVIDER_KEYS)
}

export const providerSettingsKeys = {
  mode: MODE_KEY,
  binaryPath: BINARY_PATH_KEY,
  apiKeyEncrypted: API_KEY_ENCRYPTED_KEY,
  all: ALL_PROVIDER_KEYS
}
