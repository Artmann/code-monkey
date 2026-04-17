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
  isStarting: boolean
  isSending: boolean
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
  const disabledByProvider = !providerConfigured
  const disabledByStatus = task.status !== 'todo'

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
          disabled={disabledByProvider || disabledByStatus || isStarting}
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
  isStarting,
  isSending
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

  const composerDisabled =
    thread.status === 'running' ||
    thread.status === 'starting' ||
    isSending

  return (
    <div className='flex flex-col gap-3'>
      {thread.status === 'error' && thread.errorMessage && (
        <div
          role='alert'
          className='rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive'
        >
          {thread.errorMessage}
        </div>
      )}

      <AgentTranscript events={events} />

      <Composer
        disabled={composerDisabled}
        onSend={onSendMessage}
      />
    </div>
  )
}
