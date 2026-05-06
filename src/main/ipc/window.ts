import { BrowserWindow, ipcMain } from 'electron'

export type WindowState = {
  isMaximized: boolean
  isFullScreen: boolean
}

export function registerWindowHandlers(
  getMainWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('window:minimize', () => {
    getMainWindow()?.minimize()
  })

  ipcMain.handle('window:maximizeToggle', () => {
    const window = getMainWindow()

    if (!window) {
      return
    }

    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
  })

  ipcMain.handle('window:close', () => {
    getMainWindow()?.close()
  })

  ipcMain.handle('window:isMaximized', () => {
    return getMainWindow()?.isMaximized() ?? false
  })

  ipcMain.handle('window:toggleDevTools', () => {
    getMainWindow()?.webContents.toggleDevTools()
  })

  ipcMain.handle('window:reload', () => {
    getMainWindow()?.webContents.reload()
  })
}

// Bridge BrowserWindow state events to the renderer so the maximize/restore
// icon stays in sync regardless of how the window state changes (drag-to-snap,
// double-click on the drag region, OS shortcut, etc.).
export function wireWindowStateEvents(window: BrowserWindow): void {
  const send = (): void => {
    if (window.isDestroyed()) {
      return
    }

    const state: WindowState = {
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen()
    }

    window.webContents.send('window:state-changed', state)
  }

  window.on('maximize', send)
  window.on('unmaximize', send)
  window.on('enter-full-screen', send)
  window.on('leave-full-screen', send)
}
