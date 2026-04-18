import { zValidator } from '@hono/zod-validator'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  clearProviderSettings,
  getProviderSettingsSummary,
  setProviderSettings,
  type ProviderSettingsInput,
  type SafeStorageLike
} from '../../codex/provider-settings'
import * as schema from '../../database/schema'

const codexCliSchema = z.object({
  kind: z.literal('codex').optional(),
  mode: z.literal('cli'),
  binaryPath: z.string().min(1).nullable().optional()
})

const codexApiSchema = z.object({
  kind: z.literal('codex').optional(),
  mode: z.literal('api'),
  apiKey: z.string().min(1).max(500)
})

const claudeCodeCliSchema = z.object({
  kind: z.literal('claude-code'),
  mode: z.literal('cli'),
  executablePath: z.string().min(1).nullable().optional()
})

const claudeCodeApiSchema = z.object({
  kind: z.literal('claude-code'),
  mode: z.literal('api'),
  apiKey: z.string().min(1).max(500)
})

const providerBodySchema = z.union([
  codexCliSchema,
  codexApiSchema,
  claudeCodeCliSchema,
  claudeCodeApiSchema
])

type ProviderBody = z.infer<typeof providerBodySchema>

const toProviderSettingsInput = (body: ProviderBody): ProviderSettingsInput => {
  if (body.kind === 'claude-code') {
    if (body.mode === 'cli') {
      return {
        kind: 'claude-code',
        mode: 'cli',
        executablePath: body.executablePath ?? null
      }
    }

    return { kind: 'claude-code', mode: 'api', apiKey: body.apiKey }
  }

  if (body.mode === 'cli') {
    return {
      kind: 'codex',
      mode: 'cli',
      binaryPath: body.binaryPath ?? null
    }
  }

  return { kind: 'codex', mode: 'api', apiKey: body.apiKey }
}

export type SettingsRoutesDependencies = {
  database: BetterSQLite3Database<typeof schema>
  safeStorage: SafeStorageLike
}

export const createSettingsRoutes = (
  dependencies: SettingsRoutesDependencies
) => {
  const routes = new Hono()

  routes.get('/provider', (context) =>
    context.json({ provider: getProviderSettingsSummary(dependencies) })
  )

  routes.post(
    '/provider',
    zValidator('json', providerBodySchema),
    (context) => {
      const body = context.req.valid('json')

      try {
        setProviderSettings(dependencies, toProviderSettingsInput(body))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        return context.json({ error: message }, 400)
      }

      return context.json({
        provider: getProviderSettingsSummary(dependencies)
      })
    }
  )

  routes.delete('/provider', (context) => {
    clearProviderSettings(dependencies)

    return context.json({ ok: true })
  })

  return routes
}
