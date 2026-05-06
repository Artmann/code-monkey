import { defineConfig } from 'vite'

// Standalone build config used by `scripts/build-npm.mjs` to produce the
// Electron main bundle for the npm tarball. Electron-forge's plugin-vite
// uses `vite.main.config.ts` for its own pipeline; this one bypasses forge
// so that `npx @artmann/codemonkey` can run the same source without it.
//
// `build.ssr` tells vite to target Node (so imports like 'stream' or 'http'
// aren't browser-stubbed). Output is CJS so Electron's `require()` can
// load it.
export default defineConfig({
  ssr: {
    noExternal: ['@openai/codex', '@openai/codex-sdk']
  },
  build: {
    outDir: 'dist/main',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    target: 'node20',
    ssr: 'src/main/main.ts',
    rollupOptions: {
      external: [
        'electron',
        'electron-squirrel-startup',
        '@libsql/client',
        'libsql',
        /^node:/
      ],
      output: {
        format: 'cjs',
        entryFileNames: 'main.js'
      }
    }
  },
  define: {
    // Forge's plugin-vite injects these at build time (see
    // src/main/main.ts:10-11). Replicate them for the standalone build.
    MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window')
  }
})
