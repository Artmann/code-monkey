#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// Dev checkout ships with src/ — skip; the dev workflow manages
// better-sqlite3's ABI explicitly (Node for vitest, Electron via
// electron-forge during `pnpm start`).
if (existsSync(join(root, 'src'))) {
  process.exit(0)
}

// Tarball layout: we're inside a consumer's node_modules/@artmann/codemonkey.
// better-sqlite3 was installed with the Node ABI by default; we need it
// against the Electron ABI. Fetch the Electron-specific prebuild via
// prebuild-install (which better-sqlite3 already bundles). This only needs
// a network connection — no C++ toolchain, no Python, no node-gyp.
const require = createRequire(import.meta.url)

let electronVersion
try {
  electronVersion = require('electron/package.json').version
} catch {
  console.error(
    '[@artmann/codemonkey] electron is not installed; skipping native prebuild.'
  )
  process.exit(0)
}

const better = join(root, 'node_modules', 'better-sqlite3')
if (!existsSync(better)) {
  console.error(
    '[@artmann/codemonkey] better-sqlite3 is not installed; skipping native prebuild.'
  )
  process.exit(0)
}

console.log(
  `[@artmann/codemonkey] fetching better-sqlite3 prebuild for Electron ${electronVersion}…`
)

const result = spawnSync(
  `npx --yes prebuild-install --runtime=electron --target=${electronVersion}`,
  {
    cwd: better,
    stdio: 'inherit',
    shell: true
  }
)

if (result.status !== 0) {
  console.warn(
    '[@artmann/codemonkey] prebuild-install did not succeed. The app may fail to load better-sqlite3 at runtime.'
  )
}

process.exit(0)
