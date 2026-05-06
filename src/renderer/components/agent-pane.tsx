import { ChevronDown, Loader2, SendHorizontal, ShieldCheck } from 'lucide-react'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useStickToBottom } from '../hooks/use-stick-to-bottom'
import type { Task } from '../hooks/use-tasks'
import type { Thread, ThreadEvent } from '../hooks/use-thread'
import { cn } from '../lib/utils'
import {
  AgentTranscript,
  ApprovalActionsProvider,
  UserInputActionsProvider,
  type ApprovalDecisionShape
} from './agent-transcript'
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
  onUserInputDecision?: (
    requestId: string,
    answers: Record<string, string>
  ) => void
  isSending: boolean
  isStartingNewChat?: boolean
  mergeError?: string | null
  emptyState?: ReactNode
  allowSendWithoutThread?: boolean
}

const Composer = ({
  branchName,
  disabled,
  onSend
}: {
  branchName?: string | null
  disabled: boolean
  onSend: (text: string) => void
}) => {
  const [text, setText] = useState('')

  const submit = () => {
    const value = text.trim()

    if (!value || disabled) {
      return
    }

    onSend(value)
    setText('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isSubmitShortcut =
      event.key === 'Enter' && (event.metaKey || event.ctrlKey)
    const isPlainEnter = event.key === 'Enter' && !event.shiftKey

    if (isSubmitShortcut || isPlainEnter) {
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
        'flex w-full max-w-[760px] flex-col gap-1 self-center rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] p-1 shadow-[var(--shadow-1)]'
      )}
    >
      <Textarea
        placeholder='Ask for follow-up changes…'
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={2}
        className={cn(
          'min-h-[44px] max-h-40 resize-none border-0 bg-transparent px-2.5 py-2 text-[13px] text-[color:var(--fg)] shadow-none placeholder:text-[color:var(--fg-4)] focus-visible:ring-0'
        )}
      />
      <div className='flex items-center justify-between gap-2 px-1.5 pb-1 pt-0'>
        <div className='flex items-center gap-1.5'>
          <ChipButton>
            <span
              aria-hidden='true'
              className='inline-block size-1.5 rounded-full bg-[color:var(--accent)]'
            />
            <ShieldCheck
              aria-hidden='true'
              className='size-3'
            />
            Full access
          </ChipButton>
          <ChipButton>
            <span aria-hidden='true'>⌥</span>
            <span className='font-mono'>{branchName ?? 'main'}</span>
          </ChipButton>
        </div>

        <div className='flex items-center gap-1.5'>
          <span className='inline-flex items-center rounded-[4px] border border-[color:var(--line)] bg-[color:var(--bg-3)] px-1.5 py-0.5 font-mono text-[10.5px] text-[color:var(--fg-3)]'>
            ⌘↵
          </span>
          <Button
            type='submit'
            size='sm'
            disabled={disabled || text.trim() === ''}
            className='h-7 gap-1.5 px-2.5 text-[12px]'
          >
            <span>Send</span>
            <SendHorizontal
              aria-hidden='true'
              className='size-3'
            />
          </Button>
        </div>
      </div>
    </form>
  )
}

function ChipButton({
  children,
  onClick
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='inline-flex items-center gap-1.5 rounded-full border border-[color:var(--line)] bg-transparent px-2 py-[3px] text-[11.5px] text-[color:var(--fg-2)] hover:bg-[color:var(--bg-3)]'
    >
      {children}
    </button>
  )
}

const TranscriptScrollArea = ({
  events,
  onApprovalDecision,
  onUserInputDecision,
  thread
}: {
  events: ThreadEvent[]
  onApprovalDecision: AgentPaneProps['onApprovalDecision']
  onUserInputDecision: AgentPaneProps['onUserInputDecision']
  thread: Thread | null
}) => {
  const { hasNewContent, isPinned, scrollRef, scrollToBottom } =
    useStickToBottom(events)

  return (
    <div className='relative min-h-0 flex-1'>
      <div
        ref={scrollRef}
        className='absolute inset-0 overflow-y-auto'
      >
        <div className='mx-auto flex max-w-[760px] flex-col gap-3 px-6 py-5'>
          <ApprovalActionsProvider value={onApprovalDecision ?? null}>
            <UserInputActionsProvider value={onUserInputDecision ?? null}>
              <AgentTranscript
                events={events}
                thread={thread}
              />
            </UserInputActionsProvider>
          </ApprovalActionsProvider>
        </div>
      </div>

      {!isPinned && hasNewContent && (
        <Button
          type='button'
          variant='secondary'
          size='icon'
          onClick={() => scrollToBottom('smooth')}
          aria-label='Scroll to latest'
          className='absolute bottom-3 left-1/2 size-8 -translate-x-1/2 rounded-full shadow-md'
        >
          <ChevronDown
            aria-hidden='true'
            className='size-4'
          />
        </Button>
      )}
    </div>
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
      <div className='mx-auto w-full max-w-[760px] rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4 text-[13px] text-[color:var(--fg-3)]'>
        This task is marked as done.
      </div>
    )
  }

  return (
    <div className='mx-auto flex w-full max-w-[760px] flex-col gap-2 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4 text-[13px]'>
      <p className='text-[color:var(--fg-3)]'>
        This task has no agent thread yet. Use{' '}
        <span className='font-medium text-[color:var(--fg)]'>Start Work</span>{' '}
        above to begin.
      </p>
      {!providerConfigured && (
        <p className='text-[12px] text-[color:var(--accent)]'>
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
  onUserInputDecision,
  isSending,
  isStartingNewChat = false,
  mergeError = null,
  emptyState,
  allowSendWithoutThread = false
}: AgentPaneProps) {
  const branchName = thread?.branchName ?? null

  if (isStartingNewChat) {
    return (
      <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
        <div className='flex min-h-0 flex-1 items-center justify-center'>
          <div className='flex items-center gap-3 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3'>
            <Loader2
              aria-hidden='true'
              className='size-4 animate-spin text-[color:var(--accent)]'
            />
            <span className='text-[13px] font-medium'>Starting new chat…</span>
          </div>
        </div>

        <div className='shrink-0 px-6 pb-4'>
          <Composer
            branchName={branchName}
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
        <div className='flex h-full min-h-0 flex-1 flex-col items-stretch justify-center px-6'>
          <TaskEmptyState
            task={task}
            providerConfigured={providerConfigured}
          />
        </div>
      )
    }

    return (
      <div className='mx-auto w-full max-w-[760px] rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-4 text-[13px] text-[color:var(--fg-3)]'>
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
          className='mx-auto w-full max-w-[760px] shrink-0 px-6 pt-3 text-[12px] text-[color:var(--destructive)]'
        >
          <span className='block rounded-md border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/5 px-3 py-2'>
            {thread.errorMessage}
          </span>
        </p>
      ) : null}

      <TranscriptScrollArea
        events={events}
        onApprovalDecision={onApprovalDecision}
        onUserInputDecision={onUserInputDecision}
        thread={thread ?? null}
      />

      {mergeError && (
        <p
          role='alert'
          className='mx-auto w-full max-w-[760px] shrink-0 px-6 pb-1 text-[12px] text-[color:var(--destructive)]'
        >
          <span className='block rounded-md border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/5 px-3 py-2'>
            {mergeError}
          </span>
        </p>
      )}

      {!providerConfigured && (
        <p className='mx-auto w-full max-w-[760px] shrink-0 px-6 pb-1 text-[12px] text-[color:var(--accent)]'>
          <Link
            to='/settings'
            className='underline'
          >
            Configure Codex
          </Link>{' '}
          before sending messages.
        </p>
      )}

      <div className='shrink-0 px-6 pb-4 pt-2'>
        <Composer
          branchName={branchName}
          disabled={composerDisabled}
          onSend={onSendMessage}
        />
      </div>
    </div>
  )
}
