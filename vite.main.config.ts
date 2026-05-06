import { defineConfig } from 'vite'

export default defineConfig({
  ssr: {
    noExternal: ['@openai/codex', '@openai/codex-sdk']
  },
  build: {
    rollupOptions: {
      external: ['@libsql/client', 'libsql']
    }
  }
})
