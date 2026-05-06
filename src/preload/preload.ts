import { contextBridge, ipcRenderer } from 'electron'
import type { SelectFolderResult } from '../main/ipc/dialog'
import type { WindowState } from '../main/ipc/window'

function readApiPort(): number {
  const argument = process.argv.find((value) =>
    value.startsWith('--code-monkey-api-port=')
  )

  if (!argument) {
    return 0
  }

  const raw = argument.slice('--code-monkey-api-port='.length)
  const parsed = Number.parseInt(raw, 10)

  if (Number.isNaN(parsed)) {
    return 0
  }

  return parsed
}

const apiPort = readApiPort()

export type { WindowState }

export interface CodeMonkeyWindowBridge {
  minimize: () => Promise<void>
  maximizeToggle: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  toggleDevTools: () => Promise<void>
  reload: () => Promise<void>
  onStateChanged: (handler: (state: WindowState) => void) => () => void
}

export interface CodeMonkeyBridge {
  apiPort: number
  platform: NodeJS.Platform
  selectFolder: () => Promise<SelectFolderResult>
  onNewTabRequested: (handler: () => void) => () => void
  window: CodeMonkeyWindowBridge
}

const bridge: CodeMonkeyBridge = {
  apiPort,
  platform: process.platform,
  selectFolder: () =>
    ipcRenderer.invoke('dialog:selectFolder') as Promise<SelectFolderResult>,
  onNewTabRequested: (handler) => {
    const wrapped = () => handler()

    ipcRenderer.on('tabs:new-tab-requested', wrapped)

    return () => {
      ipcRenderer.removeListener('tabs:new-tab-requested', wrapped)
    }
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
    maximizeToggle: () =>
      ipcRenderer.invoke('window:maximizeToggle') as Promise<void>,
    close: () => ipcRenderer.invoke('window:close') as Promise<void>,
    isMaximized: () =>
      ipcRenderer.invoke('window:isMaximized') as Promise<boolean>,
    toggleDevTools: () =>
      ipcRenderer.invoke('window:toggleDevTools') as Promise<void>,
    reload: () => ipcRenderer.invoke('window:reload') as Promise<void>,
    onStateChanged: (handler) => {
      const wrapped = (_event: unknown, state: WindowState) => handler(state)

      ipcRenderer.on('window:state-changed', wrapped)

      return () => {
        ipcRenderer.removeListener('window:state-changed', wrapped)
      }
    }
  }
}

contextBridge.exposeInMainWorld('codeMonkey', bridge)
