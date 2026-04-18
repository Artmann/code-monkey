import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

type PackageJson = {
  dependencies?: Record<string, string>
}

describe('renderer dependency contract', () => {
  test('declares @emotion/is-prop-valid for framer-motion runtime resolution', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8')
    ) as PackageJson

    expect(packageJson.dependencies?.['@emotion/is-prop-valid']).toBeDefined()
  })
})
