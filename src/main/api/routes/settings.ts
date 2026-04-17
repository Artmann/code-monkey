import { zValidator } from '@hono/zod-validator'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { z } from 'zod'

import {
  clearProviderSettings,
  getProviderSettingsSummary,
  setProviderSettings,
  type SafeStorageLike
} from '../../codex/provider-settings'
import * as schema from '../../database/schema'

const cliSchema = z.object({
  mode: z.literal('cli'),
  binaryPath: z.string().min(1).nullable().optional()
})

const apiSchema = z.object({
  mode: z.literal('api'),
  apiKey: z.string().min(1).max(500)
})

const providerBodySchema = z.discriminatedUnion('mode', [cliSchema, apiSchema])

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
        setProviderSettings(dependencies, body)
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
