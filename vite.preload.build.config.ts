import { defineConfig } from 'vite'

// Standalone preload build — output lands next to `main.js` so the
// `path.join(__dirname, 'preload.js')` reference in src/main/main.ts:27
// resolves without change.
export default defineConfig({
  build: {
    outDir: 'dist/main',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    target: 'node20',
    ssr: 'src/preload/preload.ts',
    rollupOptions: {
      external: ['electron', /^node:/],
      output: {
        format: 'cjs',
        entryFileNames: 'preload.js'
      }
    }
  }
})
