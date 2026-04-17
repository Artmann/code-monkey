import { dialog, ipcMain } from 'electron'
import { basename } from 'node:path'

export interface SelectFolderResult {
  canceled: boolean
  directoryPath: string | null
  suggestedName: string | null
}

export function registerDialogHandlers(): void {
  ipcMain.handle('dialog:selectFolder', async (): Promise<SelectFolderResult> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, directoryPath: null, suggestedName: null }
    }

    const directoryPath = result.filePaths[0] ?? null

    if (!directoryPath) {
      return { canceled: true, directoryPath: null, suggestedName: null }
    }

    return {
      canceled: false,
      directoryPath,
      suggestedName: basename(directoryPath)
    }
  })
}
