#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// Dev checkout ships with src/ — do nothing so the dev workflow can manage
// better-sqlite3's ABI explicitly (Node for vitest, Electron via
// electron-forge during `pnpm start`).
if (existsSync(join(root, 'src'))) {
  process.exit(0)
}

// Tarball layout: dist/ is present, src/ is not. Rebuild better-sqlite3
// against the installed Electron so `require('better-sqlite3')` loads in
// the main process.
const result = spawnSync(
  'npx --yes @electron/rebuild -f -w better-sqlite3 --only-modules',
  {
    cwd: root,
    stdio: 'inherit',
    shell: true
  }
)

process.exit(result.status ?? 0)
