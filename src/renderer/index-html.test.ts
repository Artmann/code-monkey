import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('renderer html entry', () => {
  test('uses a relative module entry for file:// builds', () => {
    const html = readFileSync(
      resolve(__dirname, '..', '..', 'index.html'),
      'utf8'
    )

    expect(html).toContain('src="./src/renderer/index.tsx"')
  })
})
