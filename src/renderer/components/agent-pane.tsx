import { ChevronDown, Code2, Map, SendHorizontal, Square } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { Link } from 'react-router-dom'

import { useDraft } from '../hooks/use-draft'
import { useStickToBottom } from '../hooks/use-stick-to-bottom'
import type {
  ComposerMode,
  Thread,
  ThreadEvent
} from '../hooks/use-thread'
import { cn } from '../lib/utils'
import {
  AgentTranscript,
  ApprovalActionsProvider,
  UserInputActionsProvider,
  type ApprovalDecisionShape
} from './agent-transcript'
import { Button } from './ui/button'
import {
  RichComposer,
  type RichComposerHandle,
  type RichComposerSnapshot
} from './ui/rich-composer'

export type AgentPaneProps = {
  thread: Thread
  events: ThreadEvent[]
  providerConfigured: boolean
  onSendMessage: (text: string) => void
  onStopMessage?: () => void
  onApprovalDecision?: (
    requestId: string,
    decision: ApprovalDecisionShape
  ) => void
  onUserInputDecision?: (
    requestId: string,
    answers: Record<string, string>
  ) => void
  isSending: boolean
  cancelRequested?: boolean
  composerMode?: ComposerMode
  onComposerModeChange?: (mode: ComposerMode) => void
  emptyState?: ReactNode
}

const MODE_OPTIONS: ReadonlyArray<{
  value: ComposerMode
  label: string
  Icon: typeof Code2
  hint: string
}> = [
  {
    value: 'code',
    label: 'Code',
    Icon: Code2,
    hint: 'Agent reads and writes files'
  },
  {
    value: 'plan',
    label: 'Plan',
    Icon: Map,
    hint: 'Agent plans without executing tools'
  }
]

const ModeToggle = ({
  disabled,
  mode,
  onChange
}: {
  disabled: boolean
  mode: ComposerMode
  onChange: (mode: ComposerMode) => void
}) => {
  return (
    <div
      role='radiogroup'
      aria-label='Agent mode'
      className='inline-flex items-center gap-0.5 rounded-full border border-[color:var(--line)] bg-transparent p-0.5'
    >
      {MODE_OPTIONS.map(({ value, label, Icon, hint }) => {
        const isActive = mode === value

        return (
          <button
            key={value}
            type='button'
            role='radio'
            aria-checked={isActive}
            title={hint}
            disabled={disabled}
            onClick={() => onChange(value)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-medium transition-colors',
              isActive
                ? 'bg-[color:var(--accent)] text-white shadow-[0_0_0_1px_var(--accent)]'
                : 'text-[color:var(--fg-2)] hover:text-[color:var(--fg)]',
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            <Icon
              aria-hidden='true'
              className='size-3'
            />
            {label}
          </button>
        )
      })}
    </div>
  )
}

const Composer = ({
  directoryLabel,
  disabled,
  isRunning,
  mode,
  onModeChange,
  onSend,
  onStop,
  threadId
}: {
  directoryLabel: string
  disabled: boolean
  isRunning: boolean
  mode: ComposerMode
  onModeChange: (mode: ComposerMode) => void
  onSend: (text: string) => void
  onStop?: () => void
  threadId: string
}) => {
  const draft = useDraft(threadId)
  const { text, setText, clear: clearDraft } = draft
  const composerRef = useRef<RichComposerHandle>(null)
  // Track the live snapshot so we can drive submit-button enablement and the
  // "image present" notice without re-rendering on every keystroke. The
  // RichComposer itself is uncontrolled — these mirrors are read-only.
  const [snapshot, setSnapshot] = useState<RichComposerSnapshot>({
    text,
    imageCount: 0
  })

  // Focus the prompt on mount and whenever the active thread changes (tab
  // switch, refresh, app start). The cursor is moved to the end so the user
  // can keep typing a restored draft without re-clicking into the editor.
  useEffect(() => {
    const handle = composerRef.current

    if (!handle || disabled) {
      return
    }

    handle.focus()
  }, [threadId, disabled])

  const submit = () => {
    if (isRunning) {
      onStop?.()

      return
    }

    const value = (composerRef.current?.getSnapshot().text ?? text).trim()

    if (!value || disabled) {
      return
    }

    onSend(value)
    composerRef.current?.clear()
    clearDraft()
  }

  const handleComposerChange = (next: RichComposerSnapshot) => {
    setSnapshot(next)
    // Persist only the text portion of the draft. Pasted images live in
    // editor DOM state and are intentionally not stored — drafts are
    // best-effort and we don't want to bloat localStorage with blob data.
    setText(next.text)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && isRunning) {
      event.preventDefault()
      onStop?.()

      return
    }

    const isSubmitShortcut =
      event.key === 'Enter' && (event.metaKey || event.ctrlKey)
    const isPlainEnter = event.key === 'Enter' && !event.shiftKey

    if (isSubmitShortcut || isPlainEnter) {
      event.preventDefault()
      submit()
    }
  }

  // Global Escape shortcut: stop the running turn no matter where focus is.
  // Only attached while running so we don't interfere with other Escape
  // affordances (e.g. closing menus) when idle.
  useEffect(() => {
    if (!isRunning || !onStop) {
      return
    }

    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }

      event.preventDefault()
      onStop()
    }

    window.addEventListener('keydown', handler)

    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [isRunning, onStop])

  const hasText = snapshot.text.trim().length > 0
  const hasImages = snapshot.imageCount > 0

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className={cn(
        'mx-auto flex w-full max-w-[760px] flex-col gap-1 rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] p-1 shadow-[var(--shadow-1)]'
      )}
    >
      <RichComposer
        ref={composerRef}
        // Re-mount the editor when switching threads so the new draft hydrates
        // cleanly without React fighting the contenteditable DOM state.
        key={threadId}
        ariaLabel='Message composer'
        placeholder='Tell the agent what to do…'
        initialText={text}
        disabled={disabled}
        onChange={handleComposerChange}
        onKeyDown={onKeyDown}
        className={cn(
          'min-h-[44px] max-h-40 overflow-y-auto px-2.5 py-2 text-[13px] text-[color:var(--fg)] outline-none'
        )}
      />
      {hasImages ? (
        <p className='px-2.5 pt-0.5 text-[11px] text-[color:var(--fg-3)]'>
          {snapshot.imageCount === 1
            ? '1 image attached — only the text portion will be sent for now.'
            : `${snapshot.imageCount} images attached — only the text portion will be sent for now.`}
        </p>
      ) : null}
      <div className='flex items-center justify-between gap-2 px-1.5 pb-1 pt-0'>
        <div className='flex items-center gap-1.5'>
          <ModeToggle
            disabled={disabled || isRunning}
            mode={mode}
            onChange={onModeChange}
          />
          <span
            className='inline-flex items-center gap-1.5 truncate rounded-full border border-[color:var(--line)] bg-transparent px-2 py-[3px] font-mono text-[11.5px] text-[color:var(--fg-2)]'
            title={directoryLabel}
          >
            {directoryLabel}
          </span>
        </div>

        <div className='flex items-center gap-1.5'>
          <span className='inline-flex items-center rounded-[4px] border border-[color:var(--line)] bg-[color:var(--bg-3)] px-1.5 py-0.5 font-mono text-[10.5px] text-[color:var(--fg-3)]'>
            {isRunning ? 'Esc' : '⌘↵'}
          </span>
          {isRunning ? (
            <Button
              type='button'
              size='sm'
              variant='destructive'
              onClick={() => onStop?.()}
              className='h-7 gap-1.5 px-2.5 text-[12px]'
            >
              <span>Stop</span>
              <Square
                aria-hidden='true'
                className='size-3 fill-current'
              />
            </Button>
          ) : (
            <Button
              type='submit'
              size='sm'
              disabled={disabled || !hasText}
              className='h-7 gap-1.5 px-2.5 text-[12px]'
            >
              <span>Send</span>
              <SendHorizontal
                aria-hidden='true'
                className='size-3'
              />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

const TranscriptScrollArea = ({
  events,
  onApprovalDecision,
  onUserInputDecision,
  thread,
  cancelRequested
}: {
  events: ThreadEvent[]
  onApprovalDecision: AgentPaneProps['onApprovalDecision']
  onUserInputDecision: AgentPaneProps['onUserInputDecision']
  thread: Thread
  cancelRequested: boolean
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
                cancelRequested={cancelRequested}
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

export function AgentPane({
  thread,
  events,
  providerConfigured,
  onSendMessage,
  onStopMessage,
  onApprovalDecision,
  onUserInputDecision,
  isSending,
  cancelRequested = false,
  composerMode,
  onComposerModeChange
}: AgentPaneProps) {
  // AgentPane can be used standalone (without a parent owning the toggle
  // state) so fall back to local state when the caller doesn't provide it.
  const [internalMode, setInternalMode] = useState<ComposerMode>('code')
  const mode = composerMode ?? internalMode
  const handleModeChange = onComposerModeChange ?? setInternalMode
  const serverRunning =
    thread.status === 'running' || thread.status === 'starting'
  // Once the user clicks Stop the UI flips out of "running" instantly,
  // ignoring any in-flight events still trickling through the SSE stream.
  const isRunning = serverRunning && !cancelRequested
  const composerDisabled = isSending || !providerConfigured
  const directoryLabel = thread.directoryPath

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      {thread.status === 'error' && thread.errorMessage ? (
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
        thread={thread}
        cancelRequested={cancelRequested}
      />

      {!providerConfigured && (
        <p className='mx-auto w-full max-w-[760px] shrink-0 px-6 pb-1 text-[12px] text-[color:var(--accent)]'>
          <Link
            to='/settings'
            className='underline'
          >
            Configure an agent provider
          </Link>{' '}
          before sending messages.
        </p>
      )}

      <div className='shrink-0 px-6 pb-4 pt-2'>
        <Composer
          directoryLabel={directoryLabel}
          disabled={composerDisabled}
          isRunning={isRunning}
          mode={mode}
          onModeChange={handleModeChange}
          onSend={onSendMessage}
          onStop={onStopMessage}
          threadId={thread.id}
        />
      </div>
    </div>
  )
}
