import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { Task } from '../hooks/use-tasks'
import type { Thread, ThreadEvent } from '../hooks/use-thread'
import { AgentTranscript } from './agent-transcript'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

export type AgentPaneProps = {
  task: Task
  thread: Thread | null
  events: ThreadEvent[]
  providerConfigured: boolean
  onStartWork: () => void
  onSendMessage: (text: string) => void
  onMerge?: () => void
  isStarting: boolean
  isSending: boolean
  isMerging?: boolean
  mergeError?: string | null
}

const StartWorkSection = ({
  task,
  providerConfigured,
  onStartWork,
  isStarting
}: {
  task: Task
  providerConfigured: boolean
  onStartWork: () => void
  isStarting: boolean
}) => {
  if (task.status === 'done') {
    return (
      <div className='rounded-md border p-4 text-sm text-muted-foreground'>
        This task is marked as done.
      </div>
    )
  }

  const disabledByProvider = !providerConfigured

  return (
    <div className='flex flex-col gap-2 rounded-md border p-4 text-sm'>
      <p className='text-muted-foreground'>
        This task has no agent thread yet.
      </p>
      {disabledByProvider && (
        <p className='text-xs text-amber-600'>
          <Link
            to='/settings'
            className='underline'
          >
            Configure Codex
          </Link>{' '}
          before starting work.
        </p>
      )}
      <div>
        <Button
          type='button'
          onClick={onStartWork}
          disabled={disabledByProvider || isStarting}
        >
          {isStarting ? 'Starting…' : 'Start Work'}
        </Button>
      </div>
    </div>
  )
}

const Composer = ({
  disabled,
  onSend
}: {
  disabled: boolean
  onSend: (text: string) => void
}) => {
  const [text, setText] = useState('')

  const submit = () => {
    const value = text.trim()

    if (!value) return

    onSend(value)
    setText('')
  }

  return (
    <form
      className='flex items-end gap-2'
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <Textarea
        placeholder='Type a follow-up…'
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={disabled}
        className='min-h-[60px]'
      />
      <Button
        type='submit'
        disabled={disabled || text.trim() === ''}
      >
        Send
      </Button>
    </form>
  )
}

export function AgentPane({
  task,
  thread,
  events,
  providerConfigured,
  onStartWork,
  onSendMessage,
  onMerge,
  isStarting,
  isSending,
  isMerging = false,
  mergeError = null
}: AgentPaneProps) {
  if (!thread) {
    return (
      <StartWorkSection
        task={task}
        providerConfigured={providerConfigured}
        onStartWork={onStartWork}
        isStarting={isStarting}
      />
    )
  }

  const threadBusy =
    thread.status === 'running' || thread.status === 'starting'
  const composerDisabled = threadBusy || isSending
  const showMergeButton = onMerge && task.status !== 'done'

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      {thread.status === 'error' && thread.errorMessage && (
        <div
          role='alert'
          className='shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive'
        >
          {thread.errorMessage}
        </div>
      )}

      <div className='min-h-0 flex-1 overflow-y-auto pr-1'>
        <AgentTranscript events={events} />
      </div>

      <div className='shrink-0 pt-3'>
        <Composer
          disabled={composerDisabled}
          onSend={onSendMessage}
        />
      </div>

      {showMergeButton && (
        <div className='flex shrink-0 flex-col gap-2 border-t pt-3'>
          {mergeError && (
            <p
              role='alert'
              className='rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive'
            >
              {mergeError}
            </p>
          )}
          <div>
            <Button
              type='button'
              onClick={onMerge}
              disabled={threadBusy || isMerging}
            >
              {isMerging ? 'Merging…' : 'Merge to Main'}
            </Button>
            <span className='ml-2 text-xs text-muted-foreground'>
              Merges <code className='font-mono'>{thread.branchName}</code>{' '}
              into <code className='font-mono'>{thread.baseBranch}</code> and
              marks the task as Done.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
