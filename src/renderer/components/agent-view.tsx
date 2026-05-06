import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useProviderSettingsQuery } from '../hooks/use-provider-settings'
import {
  useCancelThreadMutation,
  useSendMessageMutation,
  useThreadQuery,
  useThreadStream,
  type ComposerMode
} from '../hooks/use-thread'
import { apiFetch } from '../lib/api-client'
import { AgentPane } from './agent-pane'
import type { ApprovalDecisionShape } from './agent-transcript'

export function AgentView() {
  const { threadId } = useParams<{ threadId: string }>()
  const navigate = useNavigate()

  const providerQuery = useProviderSettingsQuery()
  const threadQuery = useThreadQuery(threadId)
  useThreadStream(threadId ?? null)

  const sendMessage = useSendMessageMutation()
  const cancelThread = useCancelThreadMutation()

  // Local "I just clicked Stop" flag. Lets the UI flip out of the running
  // state immediately rather than waiting for the server round-trip and
  // the SSE event to land. Cleared as soon as a fresh send goes out or the
  // user navigates to a different thread.
  const [cancelRequestedFor, setCancelRequestedFor] = useState<string | null>(
    null
  )
  // Composer mode is per-thread and lives here so the toggle survives
  // re-renders of AgentPane and resets when the user switches threads.
  const [composerMode, setComposerMode] = useState<ComposerMode>('code')
  const previousThreadIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (previousThreadIdRef.current !== threadId) {
      previousThreadIdRef.current = threadId ?? null
      setCancelRequestedFor(null)
      setComposerMode('code')
    }
  }, [threadId])

  const thread = threadQuery.data?.thread ?? null
  const events = threadQuery.data?.events ?? []
  const providerConfigured = Boolean(providerQuery.data)

  if (!threadId) {
    return null
  }

  if (threadQuery.isLoading) {
    return (
      <div className='flex h-full items-center justify-center text-[13px] text-[color:var(--fg-3)]'>
        Loading…
      </div>
    )
  }

  if (!thread) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-2 text-[13px] text-[color:var(--fg-3)]'>
        <p>This tab is no longer available.</p>
        <button
          type='button'
          className='underline'
          onClick={() => navigate('/')}
        >
          Go home
        </button>
      </div>
    )
  }

  function onSend(text: string) {
    setCancelRequestedFor(null)
    sendMessage.mutate({
      threadId: threadId as string,
      text,
      mode: composerMode
    })
  }

  function onStop() {
    setCancelRequestedFor(threadId as string)
    cancelThread.mutate(threadId as string)
  }

  function onApprovalDecision(
    requestId: string,
    decision: ApprovalDecisionShape
  ) {
    void apiFetch(`/threads/${threadId}/approvals/${requestId}`, {
      method: 'POST',
      body: JSON.stringify(decision)
    })
  }

  function onUserInputDecision(
    requestId: string,
    answers: Record<string, string>
  ) {
    void apiFetch(`/threads/${threadId}/user-inputs/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ answers })
    })
  }

  const cancelRequested = cancelRequestedFor === threadId

  return (
    <AgentPane
      thread={thread}
      events={events}
      providerConfigured={providerConfigured}
      onSendMessage={onSend}
      onStopMessage={onStop}
      onApprovalDecision={onApprovalDecision}
      onUserInputDecision={onUserInputDecision}
      isSending={sendMessage.isPending}
      cancelRequested={cancelRequested}
      composerMode={composerMode}
      onComposerModeChange={setComposerMode}
    />
  )
}
