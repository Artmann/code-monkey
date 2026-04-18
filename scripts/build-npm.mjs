#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const run = (command) => {
  const result = spawnSync(command, {
    cwd: root,
    stdio: 'inherit',
    shell: true
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const distDir = join(root, 'dist')
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true })
}

run('pnpm exec vite build -c vite.main.build.config.ts')
run('pnpm exec vite build -c vite.preload.build.config.ts')
run('pnpm exec vite build -c vite.renderer.build.config.mts')

const migrationsSource = join(root, 'src', 'main', 'database', 'migrations')
const migrationsDest = join(root, 'dist', 'migrations')
cpSync(migrationsSource, migrationsDest, { recursive: true })

console.log('[build:npm] dist/ is ready.')
