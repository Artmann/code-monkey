import { useEffect } from 'react'
import { useMatch, useNavigate } from 'react-router-dom'

import { useNewTab } from './use-new-tab'
import { useCloseThreadMutation, useThreadsQuery } from './use-thread'
import {
  useSetActiveWorkspaceMutation,
  useWorkspacesQuery
} from './use-workspace'

// The OS application menu is removed entirely (see main.ts). These shortcuts
// re-implement the accelerators that previously lived under File / View, plus
// a Cmd/Ctrl+W binding that closes the active tab.
export function useAppShortcuts(): void {
  const navigate = useNavigate()
  const startNewTab = useNewTab()
  const closeThread = useCloseThreadMutation()
  const threadsQuery = useThreadsQuery()
  const workspacesQuery = useWorkspacesQuery()
  const setActiveWorkspace = useSetActiveWorkspaceMutation()

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

      // Cmd/Ctrl+Shift+1..9 — jump directly to the Nth workspace, mirroring
      // the Cmd/Ctrl+1..9 = Nth tab shortcut. Cmd/Ctrl+Shift+9 falls back to
      // the *last* workspace when the user has more than 9, matching the tab
      // shortcut's behaviour. Match against `event.code` because Shift turns
      // the digit row into symbols (! @ # ...) on most layouts.
      const shiftedDigitMatch = event.shiftKey
        ? /^Digit([1-9])$/.exec(event.code)
        : null

      if (shiftedDigitMatch) {
        const workspaces = workspacesQuery.data?.workspaces ?? []

        if (workspaces.length === 0) {
          return
        }

        event.preventDefault()

        const numeric = Number(shiftedDigitMatch[1])
        const target =
          numeric === 9 ? workspaces[workspaces.length - 1] : workspaces[numeric - 1]

        if (!target || target.id === activeWorkspaceId) {
          return
        }

        void (async () => {
          await setActiveWorkspace.mutateAsync(target.id)

          // Restore the workspace's last active thread, mirroring
          // TabBar.onSwitchWorkspace so keyboard and mouse switches land on
          // the same tab.
          const allThreads = threadsQuery.data ?? []
          const targetThreads = allThreads.filter(
            (thread) => thread.workspaceId === target.id
          )
          const restored = target.lastActiveThreadId
            ? targetThreads.find(
                (thread) => thread.id === target.lastActiveThreadId
              )
            : null
          const next = restored ?? targetThreads[0] ?? null

          navigate(next ? `/threads/${next.id}` : '/')
        })()

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
    setActiveWorkspace,
    startNewTab,
    threadsQuery,
    workspacesQuery
  ])
}
