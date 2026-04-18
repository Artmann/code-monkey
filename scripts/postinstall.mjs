import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

import { runPostinstall } from './postinstall-lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(import.meta.url)

// Dev checkout ships with src/ — skip; the dev workflow manages
// better-sqlite3's ABI explicitly (Node for vitest, Electron via
// electron-forge during `pnpm start`).
let electronVersion
try {
  electronVersion = require('electron/package.json').version
} catch {
  electronVersion = null
}

const { rebuild } = require('@electron/rebuild')

const exitCode = await runPostinstall({
  root,
  hasBetterSqlite: existsSync(join(root, 'node_modules', 'better-sqlite3')),
  hasElectron: electronVersion != null,
  hasSourceTree: existsSync(join(root, 'src')),
  electronVersion: electronVersion ?? '',
  rebuildNativeModule: rebuild,
  log: (level, message, error) => {
    const logger =
      level === 'warn'
        ? console.warn
        : level === 'error'
          ? console.error
          : console.log

    if (error) {
      logger(message, error)

      return
    }

    logger(message)
  }
})

process.exit(exitCode)
