import { defineConfig } from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer')
    }
  }
})
