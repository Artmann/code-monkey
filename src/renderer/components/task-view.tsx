import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Pencil, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useSearchParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import invariant from 'tiny-invariant'
import { useProviderSettingsQuery } from '../hooks/use-provider-settings'
import {
  useUpdateTaskMutation,
  type Task,
  type TaskStatus
} from '../hooks/use-tasks'
import {
  useMergeTaskMutation,
  useRestartThreadMutation,
  useSendMessageMutation,
  useStartThreadMutation,
  useTaskThreadsQuery,
  useThreadQuery,
  useThreadStream
} from '../hooks/use-thread'
import { apiFetch } from '../lib/api-client'
import { getStatusMeta, statusOrder } from '../lib/task-status'
import { cn } from '../lib/utils'
import { AgentHeaderControls } from './agent-header-controls'
import { AgentPane } from './agent-pane'
import type { ApprovalDecisionShape } from './agent-transcript'
import { shortTaskId } from './task-list'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'
import {
  StatusDot,
  statusFromTaskStatus,
  type StatusKey
} from './ui/status-dot'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Tag, type TagColor } from './ui/tag'
import { Textarea } from './ui/textarea'

dayjs.extend(relativeTime)

interface TaskViewProps {
  task: Task
  onClose?: () => void
}

const taskViewTabs = ['agent', 'overview'] as const
type TaskViewTab = (typeof taskViewTabs)[number]

const deriveDefaultTaskViewTab = (input: {
  hasThread: boolean
  task: Task
}): TaskViewTab => {
  if (input.hasThread || input.task.agentState !== 'idle') {
    return 'agent'
  }

  return 'overview'
}

const parseTaskViewTab = (value: string): TaskViewTab => {
  invariant(
    taskViewTabs.includes(value as TaskViewTab),
    `Invalid task view tab: ${value}`
  )

  return value as TaskViewTab
}

function detailStatusKey(task: Task): StatusKey {
  if (task.agentState === 'working') {
    return 'running'
  }

  if (task.agentState === 'waiting_for_input') {
    return 'blocked'
  }

  return statusFromTaskStatus(task.status)
}

function agentStateTag(
  agentState: Task['agentState']
): { label: string; color: TagColor } | null {
  if (agentState === 'working') {
    return { label: 'Working', color: 'amber' }
  }

  if (agentState === 'waiting_for_input') {
    return { label: 'Needs you', color: 'red' }
  }

  if (agentState === 'done') {
    return { label: 'Done', color: 'green' }
  }

  return null
}

function formatRelative(value: string): string {
  const date = dayjs(value)

  if (!date.isValid()) {
    return '—'
  }

  return date.fromNow()
}

function formatAbsolute(value: string): string {
  const date = dayjs(value)

  if (!date.isValid()) {
    return '—'
  }

  return date.format('MMM D, YYYY · HH:mm')
}

export function TaskView({ task, onClose }: TaskViewProps) {
  const [, setSearchParams] = useSearchParams()
  const updateTask = useUpdateTaskMutation()
  const [manualTab, setManualTab] = useState<TaskViewTab | null>(null)

  const agent = useAgentTaskState(task, {
    onStarted: () => setManualTab('agent')
  })

  const activeTab =
    manualTab ??
    deriveDefaultTaskViewTab({
      hasThread: agent.hasThread,
      task
    })

  function handleTabChange(value: string) {
    setManualTab(parseTaskViewTab(value))
  }

  function saveTitle(title: string) {
    const trimmed = title.trim()

    if (!trimmed || trimmed === task.title) {
      return
    }

    updateTask.mutate({ id: task.id, title: trimmed })
  }

  function saveDescription(description: string) {
    const next = description.length > 0 ? description : null

    if (next === task.description) {
      return
    }

    updateTask.mutate({ id: task.id, description: next })
  }

  function closeTaskView() {
    if (onClose) {
      onClose()
      return
    }

    setSearchParams((prev) => {
      const copy = new URLSearchParams(prev)
      copy.delete('task')
      return copy
    })
  }

  const statusMeta = getStatusMeta(task.status)
  const statusKey = detailStatusKey(task)
  const tag = agentStateTag(task.agentState)

  return (
    <div className='flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-l border-[color:var(--line)] bg-background'>
      <div className='flex shrink-0 items-center gap-2 border-b border-[color:var(--line)] px-3 py-2'>
        <span className='font-mono text-[11.5px] font-medium text-[color:var(--fg-3)]'>
          {shortTaskId(task.id)}
        </span>
        <span className='min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--fg)]'>
          {task.title}
        </span>

        {tag ? (
          <Tag
            label={tag.label}
            color={tag.color}
          />
        ) : null}

        <Select
          value={task.status}
          onValueChange={(value) =>
            updateTask.mutate({
              id: task.id,
              status: value as TaskStatus
            })
          }
        >
          <SelectTrigger
            size='sm'
            className='h-7 gap-1.5 px-2 text-[12px]'
            aria-label='Task status'
          >
            <StatusDot
              status={statusKey}
              size={12}
            />
            <SelectValue>{statusMeta.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {statusOrder.map((value) => {
              const meta = getStatusMeta(value)
              const Icon = meta.icon

              return (
                <SelectItem
                  key={value}
                  value={value}
                >
                  <Icon
                    aria-hidden='true'
                    className={cn('size-4', meta.iconClassName)}
                  />
                  {meta.label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>

        <AgentHeaderControls
          task={task}
          thread={agent.thread}
          providerConfigured={agent.providerConfigured}
          onStartWork={agent.onStartWork}
          onRestartChat={agent.onRestartChat}
          onMerge={agent.onMerge}
          isStarting={agent.isStarting}
          isRestarting={agent.isRestarting}
          isMerging={agent.isMerging}
        />

        <button
          type='button'
          aria-label='Close task view'
          onClick={closeTaskView}
          className='inline-flex size-7 items-center justify-center rounded-md text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]'
        >
          <X
            aria-hidden='true'
            className='size-3.5'
          />
        </button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className='flex flex-1 flex-col gap-0 overflow-hidden'
      >
        <div className='shrink-0 border-b border-[color:var(--line)] px-3 py-1'>
          <TabsList className='gap-0.5 bg-transparent p-0'>
            <TabsTrigger
              value='overview'
              className='h-7'
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value='agent'
              className='h-7'
            >
              Agent
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value='overview'
          className='flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4'
        >
          <EditableTitle
            key={`title-${task.id}`}
            value={task.title}
            onSave={saveTitle}
          />

          <EditableDescription
            key={`description-${task.id}`}
            value={task.description ?? ''}
            onSave={saveDescription}
          />

          <div className='mt-2 flex flex-col gap-0.5 border-t border-[color:var(--line)] pt-4'>
            <MetaRow label='Status'>
              <StatusDot
                status={statusKey}
                size={12}
              />
              <span className='ml-1.5 text-[color:var(--fg)]'>
                {statusMeta.label}
              </span>
              {tag ? (
                <span className='ml-2'>
                  <Tag
                    label={tag.label}
                    color={tag.color}
                  />
                </span>
              ) : null}
            </MetaRow>

            <MetaRow label='Created'>
              <span
                className='text-[color:var(--fg)]'
                title={formatAbsolute(task.createdAt)}
              >
                {formatRelative(task.createdAt)}
              </span>
            </MetaRow>

            <MetaRow label='Updated'>
              <span
                className='text-[color:var(--fg)]'
                title={formatAbsolute(task.updatedAt)}
              >
                {formatRelative(task.updatedAt)}
              </span>
            </MetaRow>
          </div>
        </TabsContent>

        <TabsContent
          value='agent'
          className='flex min-h-0 flex-1 flex-col overflow-hidden'
        >
          <div className='flex h-full min-h-0 flex-1 flex-col'>
            <AgentPane
              task={task}
              thread={agent.thread}
              events={agent.events}
              providerConfigured={agent.providerConfigured}
              onSendMessage={agent.onSendMessage}
              onApprovalDecision={agent.onApprovalDecision}
              onUserInputDecision={agent.onUserInputDecision}
              isSending={agent.isSending}
              isStartingNewChat={agent.isRestarting}
              mergeError={agent.mergeError}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface MetaRowProps {
  children: React.ReactNode
  label: string
}

function MetaRow({ children, label }: MetaRowProps) {
  return (
    <div className='grid grid-cols-[84px_1fr] items-center py-1.5 text-[12.5px]'>
      <span className='text-[color:var(--fg-3)]'>{label}</span>
      <span className='flex items-center text-[color:var(--fg)]'>
        {children}
      </span>
    </div>
  )
}

function useAgentTaskState(
  task: Task,
  options: { onStarted?: () => void } = {}
) {
  const providerQuery = useProviderSettingsQuery()
  const threadsQuery = useTaskThreadsQuery(task.id)

  const latestThread = threadsQuery.data?.at(0) ?? null
  const threadId = latestThread?.id ?? null

  const threadQuery = useThreadQuery(threadId)

  useThreadStream(threadId)

  const startThread = useStartThreadMutation()
  const restartThread = useRestartThreadMutation()
  const sendMessage = useSendMessageMutation()
  const mergeTask = useMergeTaskMutation()

  const thread = threadQuery.data?.thread ?? latestThread
  const events = threadQuery.data?.events ?? []
  const hasThread = Boolean(thread)
  const mergeError =
    mergeTask.error instanceof Error ? mergeTask.error.message : null

  return {
    thread,
    events,
    hasThread,
    providerConfigured: Boolean(providerQuery.data),
    isStarting: startThread.isPending,
    isRestarting: restartThread.isPending,
    isSending: sendMessage.isPending,
    isMerging: mergeTask.isPending,
    mergeError,
    onStartWork: () => {
      startThread.mutate(task.id, {
        onSuccess: () => options.onStarted?.()
      })
    },
    onRestartChat: () => {
      restartThread.mutate(task.id, {
        onSuccess: () => options.onStarted?.()
      })
    },
    onSendMessage: (text: string) => {
      if (!threadId) {
        return
      }

      sendMessage.mutate({ threadId, text })
    },
    onApprovalDecision: (
      requestId: string,
      decision: ApprovalDecisionShape
    ) => {
      if (!threadId) {
        return
      }

      void apiFetch(`/threads/${threadId}/approvals/${requestId}`, {
        method: 'POST',
        body: JSON.stringify(decision)
      })
    },
    onUserInputDecision: (
      requestId: string,
      answers: Record<string, string>
    ) => {
      if (!threadId) {
        return
      }

      void apiFetch(`/threads/${threadId}/user-inputs/${requestId}`, {
        method: 'POST',
        body: JSON.stringify({ answers })
      })
    },
    onMerge: () => {
      mergeTask.mutate(task.id)
    }
  }
}

interface EditableTitleProps {
  value: string
  onSave: (next: string) => void
}

function EditableTitle({ value, onSave }: EditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  function startEditing() {
    setDraft(value)
    setIsEditing(true)
  }

  function commit() {
    onSave(draft)
    setIsEditing(false)
  }

  function cancel() {
    setDraft(value)
    setIsEditing(false)
  }

  if (!isEditing) {
    return (
      <button
        type='button'
        onClick={startEditing}
        className='w-full cursor-text text-left text-[18px] font-semibold leading-tight tracking-[-0.01em] text-[color:var(--fg)] outline-none hover:opacity-80'
      >
        {value}
      </button>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          cancel()
        }
      }}
      aria-label='Task title'
      className='w-full rounded-sm border-0 bg-transparent text-[18px] font-semibold leading-tight tracking-[-0.01em] outline-none ring-2 ring-ring/40 focus:ring-ring'
    />
  )
}

interface EditableDescriptionProps {
  value: string
  onSave: (next: string) => void
}

function EditableDescription({ value, onSave }: EditableDescriptionProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const shouldCommitRef = useRef(true)

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus()
      const length = textareaRef.current?.value.length ?? 0
      textareaRef.current?.setSelectionRange(length, length)
    }
  }, [isEditing])

  function startEditing() {
    setDraft(value)
    shouldCommitRef.current = true
    setIsEditing(true)
  }

  function commit() {
    if (shouldCommitRef.current) {
      onSave(draft)
    }

    setIsEditing(false)
  }

  function cancel() {
    shouldCommitRef.current = false
    setDraft(value)
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <Textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
        aria-label='Task description'
        placeholder='Write a description…'
        rows={10}
        className='min-h-40 resize-y text-[13.5px]'
      />
    )
  }

  return (
    <div className='group relative rounded-md'>
      <button
        type='button'
        aria-label='Edit description'
        onClick={startEditing}
        className='absolute right-1 top-1 inline-flex size-7 items-center justify-center rounded-md text-[color:var(--fg-3)] opacity-0 transition-opacity hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)] group-hover:opacity-100'
      >
        <Pencil
          aria-hidden='true'
          className='size-3.5'
        />
      </button>

      {value ? (
        <div className='prose prose-sm max-w-none text-[13.5px] leading-[1.55] text-[color:var(--fg-2)] dark:prose-invert'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      ) : (
        <button
          type='button'
          onClick={startEditing}
          className='text-left text-[13px] text-[color:var(--fg-3)] hover:text-[color:var(--fg)]'
        >
          Add description…
        </button>
      )}
    </div>
  )
}
