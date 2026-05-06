import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCreateThreadMutation } from './use-thread'

export function useNewTab() {
  const navigate = useNavigate()
  const createThread = useCreateThreadMutation()

  return useCallback(async () => {
    const result = await window.codeMonkey.selectFolder()

    if (result.canceled || !result.directoryPath) {
      return null
    }

    const thread = await createThread.mutateAsync({
      directoryPath: result.directoryPath,
      name: result.suggestedName ?? undefined
    })

    navigate(`/threads/${thread.id}`)

    return thread
  }, [createThread, navigate])
}
