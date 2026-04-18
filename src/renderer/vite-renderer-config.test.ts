import { describe, expect, test } from 'vitest'

import { getRendererAssetBase } from './vite-renderer-base'

describe('vite renderer build config', () => {
  test('uses a relative asset base for file:// loading', () => {
    expect(getRendererAssetBase()).toEqual('./')
  })
})
