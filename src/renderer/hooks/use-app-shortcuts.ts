import { useEffect } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'

import { useNewTab } from './use-new-tab'
import { useCloseThreadMutation, useThreadsQuery } from './use-thread'
import { useWorkspacesQuery } from './use-workspace'

// The OS application menu is removed entirely (see main.ts). These shortcuts
// re-implement the accelerators that previously lived under File / View, plus
// a Cmd/Ctrl+W binding that closes the active tab.
export function useAppShortcuts(): void {
  const navigate = useNavigate()
  const startNewTab = useNewTab()
  const closeThread = useCloseThreadMutation()
  const threadsQuery = useThreadsQuery()
  const workspacesQuery = useWorkspacesQuery()

  const threadMatch = useMatch('/threads/:threadId')
  const activeThreadId = threadMatch?.params.threadId ?? null
  const activeWorkspaceId = workspacesQuery.data?.activeWorkspaceId ?? null

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) {
        return
      }

      const isMac = window.codeMonkey.platform === 'darwin'
      const mod = isMac ? event.metaKey : event.ctrlKey

      if (!mod || event.altKey) {
        return
      }

      const key = event.key.toLowerCase()

      // Cmd/Ctrl+T — new tab
      if (key === 't' && !event.shiftKey) {
        event.preventDefault()
        void startNewTab()
        return
      }

      // Cmd/Ctrl+1..9 — jump directly to the Nth tab. Threads come back from
      // the server pre-sorted by tabOrder ASC, which is the same order the
      // TabBar renders them, so threads[index - 1] maps to the tab visually
      // at position N. Cmd/Ctrl+9 conventionally jumps to the *last* tab in
      // most browsers; we fall back to that here too — handy when the user
      // has more than 9 tabs open. Scope to the active workspace's tabs so
      // the shortcut targets what the user actually sees.
      if (!event.shiftKey && /^[1-9]$/.test(key)) {
        const allThreads = threadsQuery.data ?? []
        const threads = activeWorkspaceId
          ? allThreads.filter(
              (thread) => thread.workspaceId === activeWorkspaceId
            )
          : allThreads

        if (threads.length === 0) {
          return
        }

        event.preventDefault()

        const numeric = Number(key)
        const target =
          numeric === 9
            ? threads[threads.length - 1]
            : threads[numeric - 1]

        if (!target || target.id === activeThreadId) {
          return
        }

        navigate(`/threads/${target.id}`)
        return
      }

      // Cmd/Ctrl+W — close active tab (no-op if none active)
      if (key === 'w' && !event.shiftKey) {
        if (!activeThreadId) {
          return
        }

        event.preventDefault()
        void (async () => {
          await closeThread.mutateAsync(activeThreadId)

          const refreshed = await threadsQuery.refetch()
          const remaining = refreshed.data ?? []
          const next = remaining.find((entry) => entry.id !== activeThreadId)

          navigate(next ? `/threads/${next.id}` : '/')
        })()
        return
      }

      // Cmd/Ctrl+Shift+I — toggle DevTools
      if (event.shiftKey && key === 'i') {
        event.preventDefault()
        void window.codeMonkey.window.toggleDevTools()
        return
      }

      // Cmd/Ctrl+R — reload (only without shift; preserves Cmd+Shift+R for
      // future hard-reload semantics if desired)
      if (key === 'r' && !event.shiftKey) {
        event.preventDefault()
        void window.codeMonkey.window.reload()
      }
    }

    window.addEventListener('keydown', handler)

    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [
    activeThreadId,
    activeWorkspaceId,
    closeThread,
    navigate,
    startNewTab,
    threadsQuery
  ])
}
