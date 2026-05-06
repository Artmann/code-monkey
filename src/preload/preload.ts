import { contextBridge, ipcRenderer } from 'electron'
import type { SelectFolderResult } from '../main/ipc/dialog'

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

export interface CodeMonkeyBridge {
  apiPort: number
  selectFolder: () => Promise<SelectFolderResult>
  onNewTabRequested: (handler: () => void) => () => void
}

const bridge: CodeMonkeyBridge = {
  apiPort,
  selectFolder: () =>
    ipcRenderer.invoke('dialog:selectFolder') as Promise<SelectFolderResult>,
  onNewTabRequested: (handler) => {
    const wrapped = () => handler()

    ipcRenderer.on('tabs:new-tab-requested', wrapped)

    return () => {
      ipcRenderer.removeListener('tabs:new-tab-requested', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('codeMonkey', bridge)
