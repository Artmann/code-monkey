import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Check, ChevronDown, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  useReorderTasksMutation,
  useUpdateTaskMutation,
  type AgentState,
  type ReorderUpdate,
  type Task,
  type TaskStatus
} from '../hooks/use-tasks'
import { getStatusMeta, statusOrder } from '../lib/task-status'
import { cn } from '../lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from './ui/context-menu'
import {
  StatusDot,
  statusFromTaskStatus,
  type StatusKey
} from './ui/status-dot'
import { Tag } from './ui/tag'

dayjs.extend(relativeTime)

export type GroupedTasks = Record<TaskStatus, Task[]>

export function groupTasks(tasks: Task[]): GroupedTasks {
  const buckets: GroupedTasks = {
    in_progress: [],
    todo: [],
    done: []
  }

  for (const task of tasks) {
    buckets[task.status].push(task)
  }

  for (const status of statusOrder) {
    buckets[status].sort((first, second) => first.sortOrder - second.sortOrder)
  }

  return buckets
}

function findContainer(groups: GroupedTasks, id: string): TaskStatus | null {
  if ((statusOrder as readonly string[]).includes(id)) {
    return id as TaskStatus
  }

  for (const status of statusOrder) {
    if (groups[status].some((task) => task.id === id)) {
      return status
    }
  }

  return null
}

function diffUpdates(
  previous: GroupedTasks,
  next: GroupedTasks
): ReorderUpdate[] {
  const previousById = new Map<
    string,
    { status: TaskStatus; sortOrder: number }
  >()

  for (const status of statusOrder) {
    previous[status].forEach((task, index) => {
      previousById.set(task.id, { status, sortOrder: index })
    })
  }

  const updates: ReorderUpdate[] = []

  for (const status of statusOrder) {
    next[status].forEach((task, index) => {
      const previousEntry = previousById.get(task.id)

      if (
        !previousEntry ||
        previousEntry.status !== status ||
        previousEntry.sortOrder !== index
      ) {
        updates.push({ id: task.id, status, sortOrder: index })
      }
    })
  }

  return updates
}

export function shortTaskId(id: string): string {
  const cleaned = id.replace(/-/g, '')
  return cleaned.slice(0, 4).toUpperCase()
}

function formatTaskDate(value: string): string {
  const date = dayjs(value)

  if (!date.isValid()) {
    return ''
  }

  if (date.isSame(dayjs(), 'day')) {
    return date.format('HH:mm')
  }

  return date.format('MMM D')
}

function rowStatusKey(task: Task): StatusKey {
  if (task.agentState === 'working') {
    return 'running'
  }

  if (task.agentState === 'waiting_for_input') {
    return 'blocked'
  }

  return statusFromTaskStatus(task.status)
}

interface TaskListProps {
  projectId: string
  tasks: Task[]
  onRequestCreate: (status: TaskStatus) => void
  selectedTaskId?: string | null
}

export function TaskList({
  onRequestCreate,
  projectId,
  selectedTaskId = null,
  tasks
}: TaskListProps) {
  const remoteGroups = useMemo(() => groupTasks(tasks), [tasks])

  const [dragGroups, setDragGroups] = useState<GroupedTasks | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const displayGroups = dragGroups ?? remoteGroups

  const reorderTasks = useReorderTasksMutation()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string
    const task = tasks.find((candidate) => candidate.id === id) ?? null

    setActiveTask(task)
    setDragGroups(remoteGroups)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event

    if (!over) {
      return
    }

    const activeId = active.id as string
    const overId = over.id as string

    if (activeId === overId) {
      return
    }

    setDragGroups((current) => {
      const base = current ?? remoteGroups
      const activeContainer = findContainer(base, activeId)
      const overContainer = findContainer(base, overId)

      if (
        !activeContainer ||
        !overContainer ||
        activeContainer === overContainer
      ) {
        return base
      }

      const activeItems = base[activeContainer]
      const overItems = base[overContainer]
      const activeIndex = activeItems.findIndex((task) => task.id === activeId)

      if (activeIndex === -1) {
        return base
      }

      const overIndex = overItems.findIndex((task) => task.id === overId)
      const insertIndex = overIndex === -1 ? overItems.length : overIndex

      const movedTask = activeItems[activeIndex]

      if (!movedTask) {
        return base
      }

      const nextActive = [...activeItems]
      nextActive.splice(activeIndex, 1)

      const nextOver = [...overItems]
      nextOver.splice(insertIndex, 0, { ...movedTask, status: overContainer })

      return {
        ...base,
        [activeContainer]: nextActive,
        [overContainer]: nextOver
      }
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const working = dragGroups ?? remoteGroups

    setActiveTask(null)

    if (!over) {
      setDragGroups(null)

      return
    }

    const activeId = active.id as string
    const overId = over.id as string

    const activeContainer = findContainer(working, activeId)
    const overContainer = findContainer(working, overId)

    let finalGroups = working

    if (
      activeContainer &&
      overContainer &&
      activeContainer === overContainer
    ) {
      const items = working[activeContainer]
      const activeIndex = items.findIndex((task) => task.id === activeId)
      const overIndex = items.findIndex((task) => task.id === overId)

      if (
        activeIndex !== -1 &&
        overIndex !== -1 &&
        activeIndex !== overIndex
      ) {
        finalGroups = {
          ...working,
          [activeContainer]: arrayMove(items, activeIndex, overIndex)
        }
      }
    }

    const updates = diffUpdates(remoteGroups, finalGroups)

    if (updates.length > 0) {
      reorderTasks.mutate({ projectId, updates })
    }

    setDragGroups(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveTask(null)
        setDragGroups(null)
      }}
    >
      {statusOrder.map((status) => (
        <TaskGroup
          key={status}
          status={status}
          tasks={displayGroups[status]}
          onAdd={() => onRequestCreate(status)}
          projectId={projectId}
          selectedTaskId={selectedTaskId}
        />
      ))}

      <DragOverlay>
        {activeTask ? (
          <TaskRow
            task={activeTask}
            projectId={projectId}
            isOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

interface TaskGroupProps {
  status: TaskStatus
  tasks: Task[]
  onAdd: () => void
  projectId: string
  selectedTaskId: string | null
}

function TaskGroup({
  onAdd,
  projectId,
  selectedTaskId,
  status,
  tasks
}: TaskGroupProps) {
  const meta = getStatusMeta(status)
  const groupStatusKey = statusFromTaskStatus(status)
  const [isOpen, setIsOpen] = useState(true)

  const { setNodeRef } = useDroppable({ id: status })

  return (
    <section
      ref={setNodeRef}
      data-testid={`task-group-${status}`}
    >
      <header
        className='sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-[color:var(--line)] bg-[color:var(--bg-2)] px-4 text-[12.5px]'
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <ChevronDown
          aria-hidden='true'
          className={cn(
            'size-3 text-[color:var(--fg-3)] transition-transform',
            !isOpen && '-rotate-90'
          )}
        />
        <StatusDot
          status={groupStatusKey}
          size={13}
        />
        <span className='font-medium text-[color:var(--fg)]'>
          {meta.label}
        </span>
        <span className='tabular-nums text-[11.5px] text-[color:var(--fg-3)]'>
          {tasks.length}
        </span>
        <span className='flex-1' />
        <button
          type='button'
          onClick={(event) => {
            event.stopPropagation()
            onAdd()
          }}
          aria-label={`Add task to ${meta.label}`}
          className='inline-flex size-[18px] items-center justify-center rounded text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]'
        >
          <Plus
            aria-hidden='true'
            className='size-3'
          />
        </button>
      </header>

      {isOpen ? (
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.length === 0 ? (
            <p className='px-4 py-3.5 text-[12px] text-[color:var(--fg-4)]'>
              No tasks.
            </p>
          ) : (
            <ul className='flex flex-col'>
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  projectId={projectId}
                  isSelected={task.id === selectedTaskId}
                />
              ))}
            </ul>
          )}
        </SortableContext>
      ) : null}
    </section>
  )
}

interface TaskRowProps {
  task: Task
  projectId: string
  isOverlay?: boolean
  isSelected?: boolean
}

function TaskRow({
  isOverlay = false,
  isSelected = false,
  projectId: _projectId,
  task
}: TaskRowProps) {
  const [, setSearchParams] = useSearchParams()
  const updateTask = useUpdateTaskMutation()

  const sortable = useSortable({
    id: task.id,
    disabled: isOverlay
  })

  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition
  } = sortable

  const style = {
    transform: CSS.Translate.toString(transform),
    transition
  }

  const rowStatus = rowStatusKey(task)
  const agentTagLabel = task.agentState !== 'idle'
    ? agentTagFor(task.agentState)
    : null

  function handleStatusChange(status: TaskStatus) {
    if (status === task.status) {
      return
    }

    updateTask.mutate({ id: task.id, status })
  }

  const rowClassName = cn(
    'group/row grid h-9 cursor-pointer items-center gap-3 border-b border-[color:var(--line)] px-4 text-[13px] transition-colors',
    'hover:bg-[color:var(--bg-3)]',
    'grid-cols-[44px_14px_minmax(0,1fr)_auto_auto]',
    isSelected &&
      'bg-[color:var(--selected-bg)] shadow-[inset_2px_0_0_var(--accent)] hover:bg-[color:var(--selected-bg)]',
    isDragging && !isOverlay && 'opacity-40',
    isOverlay && 'border bg-background shadow-lg'
  )

  function handleRowClick() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('task', task.id)
      return next
    })
  }

  const rowContent = (
    <>
      <span className='truncate font-mono text-[11.5px] font-medium text-[color:var(--fg-3)]'>
        {shortTaskId(task.id)}
      </span>
      <StatusDot status={rowStatus} />
      <span className='truncate text-[color:var(--fg)]'>{task.title}</span>
      <span className='inline-flex shrink-0 items-center gap-1'>
        {agentTagLabel ? (
          <Tag
            label={agentTagLabel.label}
            color={agentTagLabel.color}
          />
        ) : null}
      </span>
      <span className='w-12 shrink-0 text-right text-[11.5px] tabular-nums text-[color:var(--fg-3)]'>
        {formatTaskDate(task.updatedAt)}
      </span>
    </>
  )

  if (isOverlay) {
    return <div className={rowClassName}>{rowContent}</div>
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          onClick={handleRowClick}
          className={rowClassName}
          data-testid={`task-row-${task.id}`}
        >
          {rowContent}
        </li>
      </ContextMenuTrigger>

      <ContextMenuContent className='w-56'>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <StatusDot
              status={statusFromTaskStatus(task.status)}
              size={12}
            />
            <span className='ml-2'>Status</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className='w-56'>
            {statusOrder.map((value) => {
              const itemMeta = getStatusMeta(value)
              const isCurrent = task.status === value

              return (
                <ContextMenuItem
                  key={value}
                  onSelect={() => handleStatusChange(value)}
                >
                  <StatusDot
                    status={statusFromTaskStatus(value)}
                    size={12}
                  />
                  <span className='ml-2 flex-1'>{itemMeta.label}</span>
                  {isCurrent ? (
                    <Check
                      aria-hidden='true'
                      className='size-3.5'
                    />
                  ) : null}
                </ContextMenuItem>
              )
            })}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function agentTagFor(state: AgentState) {
  if (state === 'working') {
    return { label: 'Working', color: 'amber' as const }
  }

  if (state === 'waiting_for_input') {
    return { label: 'Needs you', color: 'red' as const }
  }

  if (state === 'done') {
    return { label: 'Done', color: 'green' as const }
  }

  return null
}
