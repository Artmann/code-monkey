import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, RotateCcw, Settings, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from 'react'
import { useMatch, useNavigate } from 'react-router-dom'

import { useNewTab } from '../hooks/use-new-tab'
import {
  useCancelThreadMutation,
  useCloseThreadMutation,
  useCreateThreadMutation,
  useThreadsQuery,
  useUpdateThreadMutation,
  threadsKey,
  type Thread
} from '../hooks/use-thread'
import {
  useUpdateWorkspaceMutation,
  useWorkspacesQuery,
  type Workspace
} from '../hooks/use-workspace'
import { cn } from '../lib/utils'
import { WindowControls } from './window-controls'
import { WorkspaceSwitcher } from './workspace-switcher'

// `WebkitAppRegion` is an Electron-specific CSS property; React's CSSProperties
// type doesn't know about it, so we cast through here to keep the call sites
// readable.
const dragRegion: CSSProperties = {
  WebkitAppRegion: 'drag'
} as CSSProperties
const noDragRegion: CSSProperties = {
  WebkitAppRegion: 'no-drag'
} as CSSProperties

function TabLabel({
  active,
  thread,
  onCommitName
}: {
  active: boolean
  thread: Thread
  onCommitName: (name: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isEditing = draft !== null

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  const startEditing = () => {
    setDraft(thread.name)
  }

  const commit = () => {
    const next = (draft ?? '').trim()

    setDraft(null)

    if (next.length > 0 && next !== thread.name) {
      onCommitName(next)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()

      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setDraft(null)
    }
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={draft ?? ''}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="w-32 bg-transparent text-[12px] text-[color:var(--fg)] outline-none"
      />
    )
  }

  return (
    <span
      onDoubleClick={(event) => {
        event.stopPropagation()
        startEditing()
      }}
      onClick={() => {
        if (active) {
          startEditing()
        }
      }}
      className="truncate text-[12px]"
      title={thread.directoryPath}
    >
      {thread.name}
    </span>
  )
}

function SortableTab({
  active,
  thread,
  resetting,
  onActivate,
  onClose,
  onCommitName,
  onReset
}: {
  active: boolean
  thread: Thread
  resetting: boolean
  onActivate: () => void
  onClose: () => void
  onCommitName: (name: string) => void
  onReset: () => void
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition
  } = useSortable({ id: thread.id })

  // Spread the dnd-kit transform on top of the Electron `noDragRegion`
  // opt-out so the OS doesn't hijack pointer events for window dragging.
  const style: CSSProperties = {
    ...noDragRegion,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined
  }

  return (
    <div
      ref={setNodeRef}
      onClick={onActivate}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-2.5 select-none',
        active
          ? 'border-[color:var(--fg)] bg-[color:var(--bg)] text-[color:var(--fg)]'
          : 'border-transparent bg-transparent text-[color:var(--fg-3)] hover:text-[color:var(--fg)]'
      )}
    >
      {thread.awaitingInput ? (
        // Pulsing banana dot reads as "needs you" instead of "working".
        // Sized slightly larger than the idle dot so it pops in the
        // corner of the eye while the user is in another tab.
        <span
          aria-label="Awaiting your input"
          role="img"
          className="relative inline-flex size-2 shrink-0 items-center justify-center"
        >
          <span
            aria-hidden="true"
            className="absolute inline-flex size-2 animate-ping rounded-full bg-banana/60"
          />
          <span
            aria-hidden="true"
            className="relative inline-flex size-2 rounded-full bg-banana"
          />
        </span>
      ) : thread.status === 'running' || thread.status === 'starting' ? (
        <Loader2
          aria-label="Working"
          role="img"
          className="size-3 shrink-0 animate-spin text-[color:var(--fg-3)]"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-1.5 rounded-full',
            thread.status === 'error'
              ? 'bg-[color:var(--destructive)]'
              : 'bg-[color:var(--fg-4)]'
          )}
        />
      )}

      <TabLabel
        active={active}
        thread={thread}
        onCommitName={onCommitName}
      />

      <button
        type="button"
        aria-label="Reset chat"
        title="Reset chat"
        disabled={resetting}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onReset()
        }}
        className={cn(
          'ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-[color:var(--fg-4)] opacity-0 hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)] group-hover:opacity-100',
          resetting && 'opacity-100'
        )}
      >
        <RotateCcw
          aria-hidden="true"
          className={cn('size-3', resetting && 'animate-spin')}
        />
      </button>

      <button
        type="button"
        aria-label="Close tab"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-[color:var(--fg-4)] opacity-0 hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)] group-hover:opacity-100"
      >
        <X
          aria-hidden="true"
          className="size-3"
        />
      </button>
    </div>
  )
}

export function TabBar() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const threadsQuery = useThreadsQuery()
  const workspacesQuery = useWorkspacesQuery()
  const createThread = useCreateThreadMutation()
  const updateThread = useUpdateThreadMutation()
  const updateWorkspace = useUpdateWorkspaceMutation()
  const closeThread = useCloseThreadMutation()
  const cancelThread = useCancelThreadMutation()
  const startNewTab = useNewTab()
  const [resettingThreadId, setResettingThreadId] = useState<string | null>(
    null
  )

  // PointerSensor with a small distance threshold lets a click pass through
  // to the tab's onClick (so single-clicking still switches tabs) while a
  // small drag motion starts the reorder gesture.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const threadMatch = useMatch('/threads/:threadId')
  const settingsMatch = useMatch('/settings')

  const allThreads = threadsQuery.data ?? []
  const activeWorkspaceId = workspacesQuery.data?.activeWorkspaceId ?? null
  const threads = activeWorkspaceId
    ? allThreads.filter((thread) => thread.workspaceId === activeWorkspaceId)
    : allThreads
  const activeThreadId = threadMatch?.params.threadId ?? null
  const isSettingsActive = settingsMatch !== null
  const activeWorkspace =
    workspacesQuery.data?.workspaces.find(
      (workspace) => workspace.id === activeWorkspaceId
    ) ?? null

  useEffect(() => {
    const dispose = window.codeMonkey.onNewTabRequested(() => {
      void startNewTab()
    })

    return dispose
  }, [startNewTab])

  // Mirror the URL-driven active tab into the workspace's persisted
  // last-active pointer, so reopening the app or returning from another
  // workspace lands on the right tab. Depend on the cached query data
  // directly so the effect doesn't re-fire on every render from a
  // freshly-derived `threads` array.
  useEffect(() => {
    if (!activeWorkspace || !activeThreadId) {
      return
    }

    const stillOpen = (threadsQuery.data ?? []).some(
      (thread) =>
        thread.id === activeThreadId &&
        thread.workspaceId === activeWorkspace.id
    )

    if (!stillOpen) {
      return
    }

    if (activeWorkspace.lastActiveThreadId === activeThreadId) {
      return
    }

    updateWorkspace.mutate({
      workspaceId: activeWorkspace.id,
      lastActiveThreadId: activeThreadId
    })
  }, [activeThreadId, activeWorkspace, threadsQuery.data, updateWorkspace])

  const onSwitchWorkspace = (target: Workspace) => {
    const targetThreads = allThreads.filter(
      (thread) => thread.workspaceId === target.id
    )
    const restored = target.lastActiveThreadId
      ? targetThreads.find((thread) => thread.id === target.lastActiveThreadId)
      : null
    const next = restored ?? targetThreads[0] ?? null

    navigate(next ? `/threads/${next.id}` : '/')
  }

  const onClose = async (thread: Thread) => {
    await closeThread.mutateAsync(thread.id)

    if (activeThreadId !== thread.id) {
      return
    }

    const refreshed = await threadsQuery.refetch()
    const remaining = (refreshed.data ?? []).filter(
      (entry) =>
        entry.id !== thread.id && entry.workspaceId === thread.workspaceId
    )
    const next = remaining[0] ?? null

    navigate(next ? `/threads/${next.id}` : '/')
  }

  // Reset = drop the thread and reopen a fresh one in the same folder, in
  // the same tab slot. Preserve directory + name + tabOrder so it feels
  // like an in-place "clear history" rather than a brand-new tab at the
  // end of the strip.
  const onReset = async (thread: Thread) => {
    if (resettingThreadId) {
      return
    }

    setResettingThreadId(thread.id)

    try {
      if (thread.status === 'running' || thread.status === 'starting') {
        try {
          await cancelThread.mutateAsync(thread.id)
        } catch {
          // Best-effort — proceed even if cancel fails.
        }
      }

      const fresh = await createThread.mutateAsync({
        directoryPath: thread.directoryPath,
        name: thread.name
      })

      try {
        await updateThread.mutateAsync({
          threadId: fresh.id,
          tabOrder: thread.tabOrder
        })
      } catch {
        // Tab will still work, just at the end of the strip.
      }

      // Only yank focus when the user resets the tab they're looking at.
      // Resetting a background tab should leave the foreground tab alone.
      if (activeThreadId === thread.id) {
        navigate(`/threads/${fresh.id}`)
      }

      try {
        await closeThread.mutateAsync(thread.id)
      } catch {
        // Old thread will linger in the DB but is hidden from the list.
      }
    } finally {
      setResettingThreadId(null)
    }
  }

  // Reorder by permuting the existing tabOrder values across the workspace's
  // visible threads. Reusing the same set of integers (rather than renumbering
  // 0..N) keeps us from colliding with closed threads or threads in other
  // workspaces, which share the same `tab_order` column. Optimistically patch
  // the React Query cache so the strip settles instantly, then fan out one
  // PATCH per moved thread — the server is the source of truth.
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (!over || active.id === over.id) {
      return
    }

    const oldIndex = threads.findIndex((thread) => thread.id === active.id)
    const newIndex = threads.findIndex((thread) => thread.id === over.id)

    if (oldIndex < 0 || newIndex < 0) {
      return
    }

    const reordered = arrayMove(threads, oldIndex, newIndex)
    const sortedTabOrders = threads
      .map((thread) => thread.tabOrder)
      .sort((a, b) => a - b)

    const updates: Array<{ threadId: string; tabOrder: number }> = []

    reordered.forEach((thread, index) => {
      const nextOrder = sortedTabOrders[index]

      if (nextOrder !== undefined && nextOrder !== thread.tabOrder) {
        updates.push({ threadId: thread.id, tabOrder: nextOrder })
      }
    })

    if (updates.length === 0) {
      return
    }

    const nextOrderById = new Map(
      updates.map((update) => [update.threadId, update.tabOrder])
    )

    queryClient.setQueryData<Thread[]>(threadsKey, (previous) => {
      if (!previous) {
        return previous
      }

      const remapped = previous.map((thread) => {
        const nextOrder = nextOrderById.get(thread.id)

        return nextOrder !== undefined
          ? { ...thread, tabOrder: nextOrder }
          : thread
      })

      return remapped.sort((a, b) => a.tabOrder - b.tabOrder)
    })

    for (const update of updates) {
      updateThread.mutate(update)
    }
  }

  // The TabBar doubles as the window title bar. The whole row is a drag
  // region (`WebkitAppRegion: drag`); every interactive child opts back out
  // with `noDragRegion` so clicks still register. On macOS the native traffic
  // lights live on the left, so we reserve ~80px of padding to clear them.
  const isMac = window.codeMonkey.platform === 'darwin'

  return (
    <div
      className={cn(
        'flex h-9 shrink-0 items-stretch gap-0.5 border-b border-[color:var(--line)] bg-[color:var(--bg-2)]',
        isMac ? 'pl-20 pr-1' : 'pl-1'
      )}
      style={dragRegion}
    >
      <WorkspaceSwitcher
        noDragRegion={noDragRegion}
        onSwitchWorkspace={onSwitchWorkspace}
      />

      <div
        aria-hidden="true"
        className="mx-1 my-2 w-px self-stretch bg-[color:var(--line)]"
      />

      <DndContext
        sensors={sensors}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={threads.map((thread) => thread.id)}
          strategy={horizontalListSortingStrategy}
        >
          {threads.map((thread) => (
            <SortableTab
              key={thread.id}
              active={thread.id === activeThreadId}
              thread={thread}
              resetting={resettingThreadId === thread.id}
              onActivate={() => navigate(`/threads/${thread.id}`)}
              onClose={() => {
                void onClose(thread)
              }}
              onCommitName={(name) => {
                void updateThread.mutate({ threadId: thread.id, name })
              }}
              onReset={() => {
                void onReset(thread)
              }}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        type="button"
        aria-label="New tab"
        onClick={() => {
          void startNewTab()
        }}
        style={noDragRegion}
        className="ml-1 inline-flex size-7 shrink-0 items-center justify-center self-center rounded-md text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]"
      >
        <Plus
          aria-hidden="true"
          className="size-4"
        />
      </button>

      <div
        className="ml-auto flex items-stretch self-stretch"
        style={noDragRegion}
      >
        <div className="flex items-center px-1">
          <button
            type="button"
            aria-label="Settings"
            onClick={() => navigate('/settings')}
            className={cn(
              'inline-flex size-7 shrink-0 items-center justify-center self-center rounded-md hover:bg-[color:var(--bg-3)]',
              isSettingsActive
                ? 'text-[color:var(--fg)]'
                : 'text-[color:var(--fg-3)] hover:text-[color:var(--fg)]'
            )}
          >
            <Settings
              aria-hidden="true"
              className="size-4"
            />
          </button>
        </div>

        {!isMac ? (
          <div className="mx-1 my-2 w-px self-stretch bg-[color:var(--line)]" />
        ) : null}

        <WindowControls />
      </div>
    </div>
  )
}
