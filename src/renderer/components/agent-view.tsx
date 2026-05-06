import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

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

// `threadId` arrives as a prop now (rather than from useParams) because App
// renders one <AgentView> per open thread inside <Activity> blocks for tab
// persistence — the URL only drives which one is *visible*, not which ones
// are mounted. See App.tsx for the routing/visibility wiring.
export function AgentView({ threadId }: { threadId: string }) {
  const navigate = useNavigate()

  const providerQuery = useProviderSettingsQuery()
  const threadQuery = useThreadQuery(threadId)
  useThreadStream(threadId)

  const sendMessage = useSendMessageMutation()
  const cancelThread = useCancelThreadMutation()

  // Local "I just clicked Stop" flag. Lets the UI flip out of the running
  // state immediately rather than waiting for the server round-trip and
  // the SSE event to land. Cleared once a fresh send goes out.
  const [cancelRequested, setCancelRequested] = useState(false)
  // Composer mode is per-thread and lives here so the toggle survives
  // re-renders of AgentPane.
  const [composerMode, setComposerMode] = useState<ComposerMode>('code')

  const thread = threadQuery.data?.thread ?? null
  const events = threadQuery.data?.events ?? []
  const providerConfigured = Boolean(providerQuery.data)

  if (threadQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-[color:var(--fg-3)]">
        Loading…
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-[color:var(--fg-3)]">
        <p>This tab is no longer available.</p>
        <button
          type="button"
          className="underline"
          onClick={() => navigate('/')}
        >
          Go home
        </button>
      </div>
    )
  }

  function onSend(text: string) {
    setCancelRequested(false)
    sendMessage.mutate({
      threadId,
      text,
      mode: composerMode
    })
  }

  function onStop() {
    setCancelRequested(true)
    cancelThread.mutate(threadId)
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
