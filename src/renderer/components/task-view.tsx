import { Pencil, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
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
import type { ApprovalDecisionShape } from './agent-transcript'
import { cn } from '../lib/utils'
import { AgentHeaderControls } from './agent-header-controls'
import { AgentPane } from './agent-pane'
import { StatePill } from './state-pill'
import { Button } from './ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Textarea } from './ui/textarea'

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

  return (
    <div className='flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border-l bg-background'>
      <div className='flex items-center justify-between gap-4 border-b px-6 py-4'>
        <div className='flex min-w-0 items-center gap-3'>
          <h2 className='truncate font-display text-[15px] font-semibold leading-tight tracking-tight'>
            {task.title}
          </h2>
        </div>

        <div className='flex shrink-0 items-center gap-2'>
          <StatePill
            thread={agent.thread}
            agentState={task.agentState}
          />

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
              className='h-7 w-auto gap-2 text-xs'
              aria-label='Task status'
            >
              <SelectValue />
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

          <Button
            variant='ghost'
            size='icon'
            aria-label='Close task view'
            onClick={closeTaskView}
          >
            <X />
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className='flex flex-1 flex-col gap-0 overflow-hidden'
      >
        <div className='border-b px-6 py-2'>
          <TabsList>
            <TabsTrigger value='overview'>Overview</TabsTrigger>
            <TabsTrigger value='agent'>Agent</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value='overview'
          className='flex flex-1 flex-col gap-6 overflow-y-auto p-6'
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
        </TabsContent>

        <TabsContent
          value='agent'
          className='flex min-h-0 flex-1 flex-col overflow-hidden p-6'
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
      if (!threadId) return
      sendMessage.mutate({ threadId, text })
    },
    onApprovalDecision: (
      requestId: string,
      decision: ApprovalDecisionShape
    ) => {
      if (!threadId) return

      void apiFetch(
        `/threads/${threadId}/approvals/${requestId}`,
        {
          method: 'POST',
          body: JSON.stringify(decision)
        }
      )
    },
    onUserInputDecision: (
      requestId: string,
      answers: Record<string, string>
    ) => {
      if (!threadId) return

      void apiFetch(
        `/threads/${threadId}/user-inputs/${requestId}`,
        {
          method: 'POST',
          body: JSON.stringify({ answers })
        }
      )
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
        className='w-full cursor-text text-left font-display text-3xl font-bold leading-tight tracking-tight outline-none hover:opacity-80'
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
      className='w-full rounded-sm border-0 bg-transparent font-display text-3xl font-bold leading-tight tracking-tight outline-none ring-2 ring-ring/40 focus:ring-ring'
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
        className='min-h-40 resize-y text-sm'
      />
    )
  }

  return (
    <div className='group relative rounded-md'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        aria-label='Edit description'
        onClick={startEditing}
        className='absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100'
      >
        <Pencil />
      </Button>

      {value ? (
        <div className='prose prose-sm max-w-none text-sm text-foreground dark:prose-invert'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
        </div>
      ) : (
        <button
          type='button'
          onClick={startEditing}
          className='text-left text-sm text-muted-foreground hover:text-foreground'
        >
          Add description…
        </button>
      )}
    </div>
  )
}
