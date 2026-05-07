import { Activity, useEffect, useMemo, useRef } from 'react'
import { Route, Routes, useMatch, useNavigate } from 'react-router-dom'

import { AgentView } from './components/agent-view'
import { EmptyState } from './components/empty-state'
import { TabBar } from './components/tab-bar'
import { useAppShortcuts } from './hooks/use-app-shortcuts'
import { useRoutePersistence } from './hooks/use-route-persistence'
import { useThreadsQuery } from './hooks/use-thread'
import {
  useSetActiveWorkspaceMutation,
  useWorkspacesQuery
} from './hooks/use-workspace'
import { SettingsRoute } from './routes/settings-route'

export function App() {
  useRoutePersistence()
  useAppShortcuts()

  // Tab persistence: render *every* open thread's <AgentView> at once, each
  // wrapped in <Activity> mode={'visible' | 'hidden'} keyed off the URL.
  // React 19 keeps hidden subtrees mounted (state + effects intact, render
  // work deprioritized), so switching tabs becomes a visibility flip — no
  // remount, no SSE reconnect, no transcript rebuild. Each AgentView already
  // runs useThreadStream internally, so we get cross-tab cache updates for
  // free without a separate "all-threads" stream subscription.
  const threadsQuery = useThreadsQuery()
  const workspacesQuery = useWorkspacesQuery()
  const setActiveWorkspace = useSetActiveWorkspaceMutation()
  const navigate = useNavigate()

  const openThreadIds = useMemo(
    () => (threadsQuery.data ?? []).map((thread) => thread.id),
    [threadsQuery.data]
  )

  const threadMatch = useMatch('/threads/:threadId')
  const activeThreadId = threadMatch?.params.threadId ?? null
  const isThreadRoute = threadMatch !== null

  // One-shot reconciliation between the restored URL and the active
  // workspace. Two cases:
  //   1) URL points at a thread in a non-active workspace — switch active
  //      workspace to match the URL so the tab strip shows the right thing.
  //   2) URL has no thread (fresh boot, no restored route) — jump to the
  //      active workspace's lastActiveThreadId if that thread is still open.
  // Runs only once after both queries first resolve, so the user can freely
  // switch workspaces afterwards without being yanked back here.
  const reconciledRef = useRef(false)

  useEffect(() => {
    if (reconciledRef.current) {
      return
    }

    const threads = threadsQuery.data
    const workspacesData = workspacesQuery.data

    if (!threads || !workspacesData) {
      return
    }

    reconciledRef.current = true

    if (activeThreadId) {
      const thread = threads.find((entry) => entry.id === activeThreadId)

      if (thread && thread.workspaceId !== workspacesData.activeWorkspaceId) {
        setActiveWorkspace.mutate(thread.workspaceId)
      }

      return
    }

    const activeWorkspace = workspacesData.workspaces.find(
      (workspace) => workspace.id === workspacesData.activeWorkspaceId
    )

    if (!activeWorkspace?.lastActiveThreadId) {
      return
    }

    const lastActive = threads.find(
      (entry) => entry.id === activeWorkspace.lastActiveThreadId
    )

    if (lastActive) {
      navigate(`/threads/${lastActive.id}`, { replace: true })
    }
  }, [
    activeThreadId,
    navigate,
    setActiveWorkspace,
    threadsQuery.data,
    workspacesQuery.data
  ])

  return (
    <div className="flex h-screen min-h-0 flex-col bg-background">
      <TabBar />

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* All AgentViews live here permanently; only the active one is
            visible. Hidden ones are absolutely positioned so they don't
            participate in layout while invisible. */}
        {openThreadIds.map((threadId) => {
          const isActive = threadId === activeThreadId

          return (
            <Activity
              key={threadId}
              mode={isActive ? 'visible' : 'hidden'}
              name={`thread-${threadId}`}
            >
              <div className="absolute inset-0">
                <AgentView threadId={threadId} />
              </div>
            </Activity>
          )
        })}

        {/* Non-thread routes render normally. We only mount them when the
            URL doesn't point at a thread, so they sit underneath the
            Activity layer cleanly. */}
        {!isThreadRoute ? (
          <Routes>
            <Route
              path="/"
              element={<EmptyState />}
            />
            <Route
              path="/settings"
              element={<SettingsRoute />}
            />
          </Routes>
        ) : null}
      </div>
    </div>
  )
}
