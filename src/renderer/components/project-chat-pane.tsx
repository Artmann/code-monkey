import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { GitBranch, History, Plus, RefreshCw } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import type { Project } from '../hooks/use-projects'
import { useProviderSettingsQuery } from '../hooks/use-provider-settings'
import {
  useProjectThreadsQuery,
  useSendMessageMutation,
  useStartProjectThreadMutation,
  useThreadQuery,
  useThreadStream,
  type ThreadStatus
} from '../hooks/use-thread'
import { apiFetch } from '../lib/api-client'
import { AgentPane } from './agent-pane'
import type { ApprovalDecisionShape } from './agent-transcript'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import {
  StatusDot,
  statusFromThreadStatus
} from './ui/status-dot'

dayjs.extend(relativeTime)

interface ProjectChatPaneProps {
  project: Project
  threadId: string | null
}

function formatRelative(value: string): string {
  const date = dayjs(value)

  if (!date.isValid()) {
    return ''
  }

  return date.fromNow()
}

function statusLabel(status: ThreadStatus): string {
  if (status === 'running' || status === 'starting') {
    return 'Running'
  }

  if (status === 'error') {
    return 'Error'
  }

  if (status === 'done') {
    return 'Done'
  }

  return 'Idle'
}

export function ProjectChatPane({
  project,
  threadId
}: ProjectChatPaneProps) {
  const providerQuery = useProviderSettingsQuery()
  const threadsQuery = useProjectThreadsQuery(project.id)
  const threadQuery = useThreadQuery(threadId)
  useThreadStream(threadId)

  const startProjectThread = useStartProjectThreadMutation()
  const sendMessage = useSendMessageMutation()
  const location = useLocation()
  const navigate = useNavigate()

  const thread = threadQuery.data?.thread ?? null
  const events = threadQuery.data?.events ?? []
  const providerConfigured = Boolean(providerQuery.data)
  const threads = threadsQuery.data ?? []
  const otherThreads = threads.filter((entry) => entry.id !== threadId)

  // No threadId in the URL = compose-new mode. The composer is live and ready
  // to send; we don't pre-render a history list.
  const isNew = !threadId

  const startError =
    startProjectThread.error instanceof Error
      ? startProjectThread.error.message
      : null

  function onSend(text: string) {
    if (threadId) {
      sendMessage.mutate({ threadId, text })
      return
    }

    startProjectThread.mutate(
      { projectId: project.id, text },
      {
        onSuccess: (created) => {
          navigate(
            {
              pathname: `/projects/${project.id}/agent/threads/${created.id}`,
              search: location.search
            },
            { replace: false }
          )
        }
      }
    )
  }

  function onApprovalDecision(
    requestId: string,
    decision: ApprovalDecisionShape
  ) {
    if (!threadId) {
      return
    }

    void apiFetch(`/threads/${threadId}/approvals/${requestId}`, {
      method: 'POST',
      body: JSON.stringify(decision)
    })
  }

  function onUserInputDecision(
    requestId: string,
    answers: Record<string, string>
  ) {
    if (!threadId) {
      return
    }

    void apiFetch(`/threads/${threadId}/user-inputs/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ answers })
    })
  }

  function onNewThread() {
    navigate({
      pathname: `/projects/${project.id}/agent`,
      search: location.search
    })
  }

  function onSelectHistoryThread(id: string) {
    navigate({
      pathname: `/projects/${project.id}/agent/threads/${id}`,
      search: location.search
    })
  }

  function onRefresh() {
    void threadQuery.refetch()
    void threadsQuery.refetch()
  }

  const branchName = thread?.branchName ?? 'main'
  const status = thread?.status ?? 'idle'
  const dotKey = statusFromThreadStatus(status)

  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col bg-background'>
      <div className='flex shrink-0 items-center justify-between border-b border-[color:var(--line)] px-4 py-2'>
        <div className='flex min-w-0 items-center gap-2 text-[12.5px] text-[color:var(--fg-2)]'>
          <GitBranch
            aria-hidden='true'
            className='size-3.5 shrink-0 text-[color:var(--fg-3)]'
          />
          <span className='text-[color:var(--fg-3)]'>on</span>
          <code className='inline-flex items-center rounded-[4px] border border-[color:var(--line)] bg-[color:var(--kbd-bg)] px-1.5 py-px font-mono text-[11.5px] text-[color:var(--fg)]'>
            {branchName}
          </code>
          {thread ? (
            <>
              <span className='text-[color:var(--fg-4)]'>·</span>
              <StatusDot
                status={dotKey}
                size={12}
              />
              <span className='text-[color:var(--fg-2)]'>
                {statusLabel(status)}
              </span>
            </>
          ) : (
            <>
              <span className='text-[color:var(--fg-4)]'>·</span>
              <span className='text-[color:var(--fg-3)]'>New conversation</span>
            </>
          )}
        </div>

        <div className='flex items-center gap-1'>
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={onNewThread}
            disabled={isNew}
            className='h-7 gap-1.5 px-2.5 text-[12px]'
          >
            <Plus
              aria-hidden='true'
              className='size-3'
            />
            New thread
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                disabled={threads.length === 0}
                aria-label='Previous threads'
                className='inline-flex size-7 items-center justify-center rounded-md text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)] disabled:cursor-not-allowed disabled:opacity-50'
              >
                <History
                  aria-hidden='true'
                  className='size-3.5'
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              className='w-72'
            >
              <DropdownMenuLabel>Previous threads</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {otherThreads.length === 0 ? (
                <div className='px-2 py-3 text-center text-[12px] text-[color:var(--fg-3)]'>
                  No other threads yet.
                </div>
              ) : (
                otherThreads.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    onSelect={() => onSelectHistoryThread(item.id)}
                    className='flex items-start gap-2.5 py-2'
                  >
                    <span className='mt-1 shrink-0'>
                      <StatusDot
                        status={statusFromThreadStatus(item.status)}
                        size={10}
                      />
                    </span>
                    <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                      <span className='truncate font-mono text-[11.5px] text-[color:var(--fg)]'>
                        {item.branchName ?? 'Project thread'}
                      </span>
                      <span className='text-[10.5px] text-[color:var(--fg-3)]'>
                        {formatRelative(item.lastActivityAt)}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            type='button'
            onClick={onRefresh}
            aria-label='Refresh'
            className='inline-flex size-7 items-center justify-center rounded-md text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]'
          >
            <RefreshCw
              aria-hidden='true'
              className='size-3.5'
            />
          </button>
        </div>
      </div>

      <div className='flex min-h-0 flex-1 flex-col'>
        <AgentPane
          thread={thread}
          events={events}
          providerConfigured={providerConfigured}
          onSendMessage={onSend}
          onApprovalDecision={onApprovalDecision}
          onUserInputDecision={onUserInputDecision}
          isSending={sendMessage.isPending || startProjectThread.isPending}
          allowSendWithoutThread={isNew}
          emptyState={null}
          mergeError={startError}
        />
      </div>
    </div>
  )
}
