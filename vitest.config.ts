import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'

export default defineConfig({
  // The top-level `vite` install resolves to a different copy than vitest's
  // bundled vite, so plugin types collide structurally. Cast to the Plugin
  // type vitest expects — the runtime shape is identical.
  plugins: [react() as unknown as Plugin],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/renderer/test-setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'scripts/**/*.{test,spec}.{ts,tsx}'
    ],
    css: false
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer')
    }
  }
})
