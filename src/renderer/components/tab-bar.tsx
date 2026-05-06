import { Plus, Settings, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { useMatch, useNavigate } from 'react-router-dom'

import { useNewTab } from '../hooks/use-new-tab'
import {
  useCloseThreadMutation,
  useThreadsQuery,
  useUpdateThreadMutation,
  type Thread
} from '../hooks/use-thread'
import { cn } from '../lib/utils'

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
        className='w-32 bg-transparent text-[12px] text-[color:var(--fg)] outline-none'
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
      className='truncate text-[12px]'
      title={thread.directoryPath}
    >
      {thread.name}
    </span>
  )
}

export function TabBar() {
  const navigate = useNavigate()
  const threadsQuery = useThreadsQuery()
  const updateThread = useUpdateThreadMutation()
  const closeThread = useCloseThreadMutation()
  const startNewTab = useNewTab()

  const threadMatch = useMatch('/threads/:threadId')
  const settingsMatch = useMatch('/settings')

  const threads = threadsQuery.data ?? []
  const activeThreadId = threadMatch?.params.threadId ?? null
  const isSettingsActive = settingsMatch !== null

  useEffect(() => {
    const dispose = window.codeMonkey.onNewTabRequested(() => {
      void startNewTab()
    })

    return dispose
  }, [startNewTab])

  const onClose = async (thread: Thread) => {
    await closeThread.mutateAsync(thread.id)

    if (activeThreadId !== thread.id) {
      return
    }

    const refreshed = await threadsQuery.refetch()
    const remaining = refreshed.data ?? []
    const next = remaining.find((entry) => entry.id !== thread.id)

    navigate(next ? `/threads/${next.id}` : '/')
  }

  return (
    <div className='flex h-9 shrink-0 items-stretch gap-0.5 border-b border-[color:var(--line)] bg-[color:var(--bg-2)] px-1'>
      {threads.map((thread) => {
        const isActive = thread.id === activeThreadId

        return (
          <div
            key={thread.id}
            onClick={() => navigate(`/threads/${thread.id}`)}
            className={cn(
              'group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-2.5',
              isActive
                ? 'border-[color:var(--accent)] bg-[color:var(--bg)] text-[color:var(--fg)]'
                : 'border-transparent bg-transparent text-[color:var(--fg-3)] hover:text-[color:var(--fg)]'
            )}
          >
            <span
              aria-hidden='true'
              className={cn(
                'inline-block size-1.5 rounded-full',
                thread.status === 'running'
                  ? 'bg-[color:var(--accent)]'
                  : thread.status === 'error'
                    ? 'bg-[color:var(--destructive)]'
                    : 'bg-[color:var(--fg-4)]'
              )}
            />

            <TabLabel
              active={isActive}
              thread={thread}
              onCommitName={(name) => {
                void updateThread.mutate({ threadId: thread.id, name })
              }}
            />

            <button
              type='button'
              aria-label='Close tab'
              onClick={(event) => {
                event.stopPropagation()
                void onClose(thread)
              }}
              className='ml-1 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-[color:var(--fg-4)] opacity-0 hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)] group-hover:opacity-100'
            >
              <X
                aria-hidden='true'
                className='size-3'
              />
            </button>
          </div>
        )
      })}

      <button
        type='button'
        aria-label='New tab'
        onClick={() => {
          void startNewTab()
        }}
        className='ml-1 inline-flex size-7 shrink-0 items-center justify-center self-center rounded-md text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]'
      >
        <Plus
          aria-hidden='true'
          className='size-4'
        />
      </button>

      <div className='ml-auto flex items-center pr-1'>
        <button
          type='button'
          aria-label='Settings'
          onClick={() => navigate('/settings')}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center self-center rounded-md hover:bg-[color:var(--bg-3)]',
            isSettingsActive
              ? 'text-[color:var(--fg)]'
              : 'text-[color:var(--fg-3)] hover:text-[color:var(--fg)]'
          )}
        >
          <Settings
            aria-hidden='true'
            className='size-4'
          />
        </button>
      </div>
    </div>
  )
}
