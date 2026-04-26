import { BrowserWindow, app, safeStorage, screen } from 'electron'
import started from 'electron-squirrel-startup'
import path from 'node:path'
import { startApiServer } from './api/server'
import { createCodexRuntime } from './codex/runtime'
import { getDatabase } from './database/client'
import { runMigrations } from './database/migrate'
import { registerDialogHandlers } from './ipc/dialog'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

// Opt-in debug session: set CODE_MONKEY_DEBUG=1 (use `pnpm start:debug`) to
// expose Chrome DevTools Protocol on :9222 for tools like agent-browser, and
// open DevTools alongside the renderer. Switches must be appended before
// app.whenReady() — top-level is the safe place.
const isDebugSession = process.env.CODE_MONKEY_DEBUG === '1'

if (isDebugSession) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
  app.commandLine.appendSwitch('remote-allow-origins', '*')
}

if (started) {
  app.quit()
}

let apiPort: number | null = null

async function createMainWindow(): Promise<void> {
  const { workAreaSize } = screen.getPrimaryDisplay()

  const mainWindow = new BrowserWindow({
    width: workAreaSize.width,
    height: workAreaSize.height,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--code-monkey-api-port=${apiPort ?? 0}`]
    }
  })

  mainWindow.maximize()
  mainWindow.show()

  if (isDebugSession) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    )
  }
}

async function bootstrap(): Promise<void> {
  runMigrations()

  const database = getDatabase()
  const runtime = createCodexRuntime({ database, safeStorage })

  runtime.runner.recoverOrphanedThreads()

  apiPort = await startApiServer({
    database,
    safeStorage,
    broker: runtime.broker,
    taskStateBroker: runtime.taskStateBroker,
    runner: runtime.runner
  })
  console.log(`[code-monkey] API listening on http://127.0.0.1:${apiPort}`)

  registerDialogHandlers()

  await app.whenReady()
  await createMainWindow()
}

bootstrap().catch((error) => {
  console.error('[code-monkey] fatal startup error', error)
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow()
  }
})
