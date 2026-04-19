import { Loader2, SendHorizontal } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { Task } from '../hooks/use-tasks'
import {
  derivePendingApproval,
  type Thread,
  type ThreadEvent
} from '../hooks/use-thread'
import { cn } from '../lib/utils'
import {
  AgentTranscript,
  ApprovalActionsProvider,
  type ApprovalDecisionShape
} from './agent-transcript'
import { ApprovalCard } from './approval-card'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

export type AgentPaneProps = {
  task?: Task | null
  thread: Thread | null
  events: ThreadEvent[]
  providerConfigured: boolean
  onSendMessage: (text: string) => void
  onApprovalDecision?: (
    requestId: string,
    decision: ApprovalDecisionShape
  ) => void
  isSending: boolean
  isStartingNewChat?: boolean
  mergeError?: string | null
  emptyState?: ReactNode
  allowSendWithoutThread?: boolean
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

    if (!value || disabled) return

    onSend(value)
    setText('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-card px-3 py-2.5 transition-colors',
        'focus-within:border-muted-foreground/50'
      )}
    >
      <Textarea
        placeholder='Nudge the agent, or type a follow-up…'
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={1}
        className={cn(
          'min-h-[40px] max-h-40 resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0'
        )}
      />
      <div className='flex items-center gap-2'>
        <span className='ml-1 text-[11px] text-muted-foreground/70'>
          Enter to send · ⇧Enter for newline
        </span>
        <Button
          type='submit'
          size='sm'
          disabled={disabled || text.trim() === ''}
          className='ml-auto h-7 gap-1.5 px-3 text-xs'
        >
          <SendHorizontal
            aria-hidden='true'
            className='size-3'
          />
          Send
        </Button>
      </div>
    </form>
  )
}

const TaskEmptyState = ({
  task,
  providerConfigured
}: {
  task: Task
  providerConfigured: boolean
}) => {
  if (task.status === 'done') {
    return (
      <div className='rounded-xl border bg-card px-4 py-4 text-sm text-muted-foreground'>
        This task is marked as done.
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2 rounded-xl border bg-card px-4 py-4 text-sm'>
      <p className='text-muted-foreground'>
        This task has no agent thread yet. Use{' '}
        <span className='font-medium text-foreground'>Start Work</span> above to
        begin.
      </p>
      {!providerConfigured && (
        <p className='text-xs text-[color:var(--ctp-yellow)]'>
          <Link
            to='/settings'
            className='underline'
          >
            Configure Codex
          </Link>{' '}
          before starting work.
        </p>
      )}
    </div>
  )
}

export function AgentPane({
  task,
  thread,
  events,
  providerConfigured,
  onSendMessage,
  onApprovalDecision,
  isSending,
  isStartingNewChat = false,
  mergeError = null,
  emptyState,
  allowSendWithoutThread = false
}: AgentPaneProps) {
  const pendingApproval = derivePendingApproval(events)
  if (isStartingNewChat) {
    return (
      <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
        <div className='flex min-h-0 flex-1 items-center justify-center'>
          <div className='flex items-center gap-3 rounded-lg border bg-card px-4 py-3'>
            <Loader2
              aria-hidden='true'
              className='size-4 animate-spin text-banana'
            />
            <span className='text-sm font-medium'>Starting new chat…</span>
          </div>
        </div>

        <div className='mt-3 shrink-0'>
          <Composer
            disabled
            onSend={onSendMessage}
          />
        </div>
      </div>
    )
  }

  if (!thread && !allowSendWithoutThread) {
    if (emptyState !== undefined) {
      return <>{emptyState}</>
    }

    if (task) {
      return (
        <TaskEmptyState
          task={task}
          providerConfigured={providerConfigured}
        />
      )
    }

    return (
      <div className='rounded-xl border bg-card px-4 py-4 text-sm text-muted-foreground'>
        No conversation yet.
      </div>
    )
  }

  // Always allow the user to send messages, even while the thread is running.
  // The agent forwards queued input into its current turn, so we don't gate
  // the composer on thread status — only on send-in-flight and provider setup.
  const composerDisabled = isSending || !providerConfigured

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      {thread?.status === 'error' && thread.errorMessage ? (
        <p
          role='alert'
          className='mb-2 shrink-0 rounded-lg border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/5 px-3 py-2 text-xs text-[color:var(--destructive)]'
        >
          {thread.errorMessage}
        </p>
      ) : null}

      <div className='min-h-0 flex-1 overflow-y-auto pr-1'>
        <ApprovalActionsProvider value={onApprovalDecision ?? null}>
          <AgentTranscript
            events={events}
            thread={thread}
          />
        </ApprovalActionsProvider>
      </div>

      {mergeError && (
        <p
          role='alert'
          className='mt-2 shrink-0 rounded-lg border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/5 px-3 py-2 text-xs text-[color:var(--destructive)]'
        >
          {mergeError}
        </p>
      )}

      {!providerConfigured && (
        <p className='mt-2 shrink-0 text-xs text-[color:var(--ctp-yellow)]'>
          <Link
            to='/settings'
            className='underline'
          >
            Configure Codex
          </Link>{' '}
          before sending messages.
        </p>
      )}

      <div className='mt-3 shrink-0'>
        {pendingApproval ? (
          <ApprovalCard
            state='pending'
            tool={pendingApproval.tool}
            summary={pendingApproval.summary}
            onDecide={(decision) =>
              onApprovalDecision?.(pendingApproval.id, decision)
            }
          />
        ) : (
          <Composer
            disabled={composerDisabled}
            onSend={onSendMessage}
          />
        )}
      </div>
    </div>
  )
}
