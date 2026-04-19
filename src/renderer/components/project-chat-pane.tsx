import { ChevronDown, History, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import type { Project } from '../hooks/use-projects'
import { useProviderSettingsQuery } from '../hooks/use-provider-settings'
import {
  useProjectThreadsQuery,
  useSendMessageMutation,
  useStartProjectThreadMutation,
  useThreadQuery,
  useThreadStream,
  type Thread
} from '../hooks/use-thread'
import { apiFetch } from '../lib/api-client'
import { cn } from '../lib/utils'
import { AgentPane } from './agent-pane'
import type { ApprovalDecisionShape } from './agent-transcript'
import { StatePill } from './state-pill'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

interface ProjectChatPaneProps {
  project: Project
  threadId: string | null
}

const relativeTime = (iso: string): string => {
  const then = new Date(iso).getTime()

  if (Number.isNaN(then)) return ''

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))

  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const statusDotColor = (status: Thread['status']): string => {
  if (status === 'running' || status === 'starting') return 'bg-banana'
  if (status === 'error') return 'bg-[color:var(--ctp-red)]'
  if (status === 'done') return 'bg-[color:var(--ctp-green)]'
  return 'bg-muted-foreground/60'
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
  const navigate = useNavigate()

  const thread = threadQuery.data?.thread ?? null
  const events = threadQuery.data?.events ?? []
  const providerConfigured = Boolean(providerQuery.data)
  const threads = threadsQuery.data ?? []
  const otherThreads = threads.filter((t) => t.id !== threadId)

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
              search: window.location.search
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
    if (!threadId) return

    void apiFetch(`/threads/${threadId}/approvals/${requestId}`, {
      method: 'POST',
      body: JSON.stringify(decision)
    })
  }

  function onNewThread() {
    navigate({
      pathname: `/projects/${project.id}/agent`,
      search: window.location.search
    })
  }

  function onSelectHistoryThread(id: string) {
    navigate({
      pathname: `/projects/${project.id}/agent/threads/${id}`,
      search: window.location.search
    })
  }

  const title = isNew
    ? 'New conversation'
    : thread?.branchName
      ? `on ${thread.branchName}`
      : 'Conversation'

  return (
    <div className='flex h-full min-h-0 w-full flex-1 flex-col bg-background'>
      <div className='flex items-center gap-3 border-b px-5 py-2.5'>
        <h2 className='truncate font-display text-[14px] font-semibold tracking-tight'>
          {title}
        </h2>

        <div className='ml-auto flex items-center gap-2'>
          {thread ? <StatePill thread={thread} /> : null}

          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={onNewThread}
            disabled={isNew}
            className='h-7 gap-1.5 px-2.5 text-xs'
          >
            <Plus
              aria-hidden='true'
              className='size-3'
            />
            New thread
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type='button'
                size='sm'
                variant='ghost'
                disabled={threads.length === 0}
                aria-label='Previous threads'
                className='h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground'
              >
                <History
                  aria-hidden='true'
                  className='size-3.5'
                />
                <ChevronDown
                  aria-hidden='true'
                  className='size-3'
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              className='w-72'
            >
              <DropdownMenuLabel>Previous threads</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {otherThreads.length === 0 ? (
                <div className='px-2 py-3 text-center text-xs text-muted-foreground'>
                  No other threads yet.
                </div>
              ) : (
                otherThreads.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    onSelect={() => onSelectHistoryThread(item.id)}
                    className='flex items-start gap-2.5 py-2'
                  >
                    <span
                      aria-hidden='true'
                      className={cn(
                        'mt-1 inline-block size-1.5 shrink-0 rounded-full',
                        statusDotColor(item.status)
                      )}
                    />
                    <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                      <span className='truncate font-mono text-[11.5px] text-foreground'>
                        {item.branchName ?? 'Project thread'}
                      </span>
                      <span className='text-[10.5px] text-muted-foreground'>
                        {relativeTime(item.lastActivityAt)}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className='flex min-h-0 flex-1 flex-col px-5 pb-4 pt-4'>
        <AgentPane
          thread={thread}
          events={events}
          providerConfigured={providerConfigured}
          onSendMessage={onSend}
          onApprovalDecision={onApprovalDecision}
          isSending={sendMessage.isPending || startProjectThread.isPending}
          allowSendWithoutThread={isNew}
          emptyState={null}
          mergeError={startError}
        />
      </div>
    </div>
  )
}
