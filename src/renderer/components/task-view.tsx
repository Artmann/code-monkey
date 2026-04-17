import { Pencil, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProviderSettingsQuery } from '../hooks/use-provider-settings'
import {
  useUpdateTaskMutation,
  type Task,
  type TaskStatus
} from '../hooks/use-tasks'
import {
  useMergeTaskMutation,
  useSendMessageMutation,
  useStartThreadMutation,
  useTaskThreadsQuery,
  useThreadQuery,
  useThreadStream
} from '../hooks/use-thread'
import { getAgentStateMeta } from '../lib/agent-state'
import { getStatusMeta, statusOrder } from '../lib/task-status'
import { cn } from '../lib/utils'
import { AgentPane } from './agent-pane'
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
}

export function TaskView({ task }: TaskViewProps) {
  const navigate = useNavigate()
  const { projectId } = useParams<{ projectId: string }>()
  const updateTask = useUpdateTaskMutation()

  const agentMeta = getAgentStateMeta(task.agentState)
  const AgentIcon = agentMeta.icon

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
    if (projectId) {
      navigate(`/projects/${projectId}`)
    }
  }

  return (
    <div className='flex h-full w-full min-w-0 flex-1 flex-col border-l bg-background'>
      <div className='flex items-center justify-between gap-4 border-b px-6 py-4'>
        <div className='flex flex-wrap items-center gap-3'>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-wider',
              agentMeta.badgeClassName
            )}
            title={`Agent: ${agentMeta.label}`}
          >
            <AgentIcon
              aria-hidden='true'
              className={cn(
                'size-3.5',
                agentMeta.iconClassName,
                agentMeta.animate && 'animate-spin'
              )}
            />
            {agentMeta.label}
          </span>

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
        </div>

        <Button
          variant='ghost'
          size='icon'
          aria-label='Close task view'
          onClick={closeTaskView}
        >
          <X />
        </Button>
      </div>

      <Tabs
        defaultValue='overview'
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
          className='flex flex-1 flex-col overflow-y-auto p-6'
        >
          <AgentPaneContainer task={task} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function AgentPaneContainer({ task }: { task: Task }) {
  const providerQuery = useProviderSettingsQuery()
  const threadsQuery = useTaskThreadsQuery(task.id)

  const latestThread = threadsQuery.data?.at(0) ?? null
  const threadId = latestThread?.id ?? null

  const threadQuery = useThreadQuery(threadId)

  useThreadStream(threadId)

  const startThread = useStartThreadMutation()
  const sendMessage = useSendMessageMutation()
  const mergeTask = useMergeTaskMutation()

  const thread = threadQuery.data?.thread ?? latestThread
  const events = threadQuery.data?.events ?? []
  const mergeError =
    mergeTask.error instanceof Error ? mergeTask.error.message : null

  return (
    <AgentPane
      task={task}
      thread={thread}
      events={events}
      providerConfigured={Boolean(providerQuery.data)}
      onStartWork={() => {
        startThread.mutate(task.id)
      }}
      onSendMessage={(text) => {
        if (!threadId) return
        sendMessage.mutate({ threadId, text })
      }}
      onMerge={() => {
        mergeTask.mutate(task.id)
      }}
      isStarting={startThread.isPending}
      isSending={sendMessage.isPending}
      isMerging={mergeTask.isPending}
      mergeError={mergeError}
    />
  )
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
