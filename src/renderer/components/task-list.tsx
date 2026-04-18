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
import { Check, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  useReorderTasksMutation,
  useUpdateTaskMutation,
  type ReorderUpdate,
  type Task,
  type TaskStatus
} from '../hooks/use-tasks'
import { getAgentStateMeta } from '../lib/agent-state'
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
  const previousById = new Map<string, { status: TaskStatus; sortOrder: number }>()

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

interface TaskListProps {
  projectId: string
  tasks: Task[]
  onRequestCreate: (status: TaskStatus) => void
  selectedTaskId?: string | null
}

export function TaskList({
  projectId,
  tasks,
  onRequestCreate,
  selectedTaskId = null
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
  status,
  tasks,
  onAdd,
  projectId,
  selectedTaskId
}: TaskGroupProps) {
  const meta = getStatusMeta(status)
  const Icon = meta.icon

  const { setNodeRef } = useDroppable({ id: status })

  const emptyLabel = emptyLabelForStatus(status)

  return (
    <section
      ref={setNodeRef}
      data-testid={`task-group-${status}`}
    >
      <header className='group/header sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75'>
        <div className='flex items-center gap-2'>
          <Icon
            aria-hidden='true'
            className={cn('size-4', meta.iconClassName)}
          />
          <span className='font-display text-xs font-semibold uppercase tracking-widest'>
            {meta.label}
          </span>
          <span className='rounded-full bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground'>
            {tasks.length}
          </span>
        </div>

        <button
          type='button'
          onClick={onAdd}
          aria-label={`Add task to ${meta.label}`}
          className='flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/header:opacity-100 focus-visible:opacity-100'
        >
          <Plus className='size-4' />
        </button>
      </header>

      <SortableContext
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className='divide-y divide-border/50'>
          {tasks.length === 0 ? (
            <li className='px-6 py-3 font-mono text-[11px] text-muted-foreground/70'>
              {emptyLabel}
            </li>
          ) : (
            tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                projectId={projectId}
                isSelected={task.id === selectedTaskId}
              />
            ))
          )}
        </ul>
      </SortableContext>
    </section>
  )
}

function emptyLabelForStatus(status: TaskStatus): string {
  if (status === 'in_progress') {
    return 'No tasks. 🦍 not working yet.'
  }

  if (status === 'todo') {
    return 'No tasks. Feed ape. 🍌'
  }

  return 'No tasks. Ape ship nothing yet.'
}

interface TaskRowProps {
  task: Task
  projectId: string
  isOverlay?: boolean
  isSelected?: boolean
}

function TaskRow({
  task,
  projectId: _projectId,
  isOverlay = false,
  isSelected = false
}: TaskRowProps) {
  const statusMeta = getStatusMeta(task.status)
  const agentMeta = getAgentStateMeta(task.agentState)
  const StatusIcon = statusMeta.icon
  const AgentIcon = agentMeta.icon

  const [, setSearchParams] = useSearchParams()
  const updateTask = useUpdateTaskMutation()

  const sortable = useSortable({
    id: task.id,
    disabled: isOverlay
  })

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = sortable

  const style = {
    transform: CSS.Translate.toString(transform),
    transition
  }

  function handleStatusChange(status: TaskStatus) {
    if (status === task.status) {
      return
    }

    updateTask.mutate({ id: task.id, status })
  }

  const rowClassName = cn(
    'group/row flex cursor-pointer items-center gap-3 border-l-2 border-l-transparent px-6 py-3 text-sm transition-colors hover:bg-accent/40',
    agentMeta.highlightRow &&
      'border-l-banana bg-banana/[0.06] hover:bg-banana/[0.1]',
    task.agentState === 'working' &&
      'border-l-banana/60 bg-banana/[0.04] hover:bg-banana/[0.08]',
    isSelected && 'bg-accent/60 hover:bg-accent/60',
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
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-wider',
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
        <span>{agentMeta.label}</span>
      </span>

      <span className='flex-1 truncate font-medium'>{task.title}</span>

      {task.description ? (
        <span className='hidden max-w-[40ch] truncate text-xs text-muted-foreground md:inline'>
          {task.description}
        </span>
      ) : null}

      <StatusIcon
        aria-hidden='true'
        className={cn(
          'size-4 shrink-0 opacity-60 transition-opacity group-hover/row:opacity-100',
          statusMeta.iconClassName
        )}
      />
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
            <StatusIcon
              aria-hidden='true'
              className={cn('size-4', statusMeta.iconClassName)}
            />
            Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className='w-56'>
            {statusOrder.map((value) => {
              const itemMeta = getStatusMeta(value)
              const ItemIcon = itemMeta.icon
              const isCurrent = task.status === value

              return (
                <ContextMenuItem
                  key={value}
                  onSelect={() => handleStatusChange(value)}
                >
                  <ItemIcon
                    aria-hidden='true'
                    className={cn('size-4', itemMeta.iconClassName)}
                  />
                  <span className='flex-1'>{itemMeta.label}</span>
                  {isCurrent ? (
                    <Check
                      aria-hidden='true'
                      className='size-4'
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
