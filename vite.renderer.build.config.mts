import { defineConfig, mergeConfig } from 'vite'
import base from './vite.renderer.config.mts'

// Standalone renderer build — writes the bundle to `dist/renderer/main_window`
// so src/main/main.ts:41 can load `../renderer/main_window/index.html`
// relative to `dist/main/main.js`.
export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: 'dist/renderer/main_window',
      emptyOutDir: true
    }
  })
)
