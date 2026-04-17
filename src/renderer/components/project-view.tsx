import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useParams } from 'react-router-dom'
import type { Project } from '../hooks/use-projects'
import { useTasksQuery, type TaskStatus } from '../hooks/use-tasks'
import { cn } from '../lib/utils'
import { NewTaskDialog } from './new-task-dialog'
import { TaskList } from './task-list'
import { TaskView } from './task-view'
import { Button } from './ui/button'

interface ProjectViewProps {
  project: Project | null
}

export function ProjectView({ project }: ProjectViewProps) {
  const tasksQuery = useTasksQuery(project?.id)
  const tasks = tasksQuery.data ?? []

  const { taskId } = useParams<{ taskId?: string }>()
  const selectedTask = taskId
    ? tasks.find((task) => task.id === taskId) ?? null
    : null
  const isSplit = Boolean(selectedTask)

  const [isDialogOpen, setDialogOpen] = useState(false)
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>('todo')

  function openDialog(status: TaskStatus = 'todo') {
    setDefaultStatus(status)
    setDialogOpen(true)
  }

  useHotkeys(
    'c',
    (event) => {
      if (!project) {
        return
      }

      event.preventDefault()
      openDialog('todo')
    },
    { enabled: Boolean(project), preventDefault: true },
    [project]
  )

  if (!project) {
    return (
      <div className='flex h-full flex-1 flex-col items-center justify-center gap-3 p-8'>
        <span className='text-4xl opacity-40 select-none'>🦍</span>
        <p className='text-muted-foreground'>
          Select a project from the sidebar.
        </p>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden'>
      <div className='flex items-center justify-between gap-4 border-b px-6 py-5'>
        <div className='flex min-w-0 flex-col gap-1'>
          <h1 className='font-display text-2xl font-bold tracking-tight'>
            {project.name}
          </h1>
          <p
            className='truncate font-mono text-xs text-muted-foreground'
            title={project.directoryPath}
          >
            {project.directoryPath}
          </p>
        </div>

        <Button
          size='sm'
          onClick={() => openDialog('todo')}
          className='font-display font-semibold'
        >
          <Plus />
          New task
        </Button>
      </div>

      <div className='flex flex-1 overflow-hidden'>
        <div
          className={cn(
            'flex min-w-0 flex-col overflow-y-auto transition-[flex-basis] duration-200',
            isSplit ? 'flex-none basis-1/2' : 'flex-1 basis-full'
          )}
        >
          <TaskList
            projectId={project.id}
            tasks={tasks}
            onRequestCreate={openDialog}
            selectedTaskId={selectedTask?.id ?? null}
          />
        </div>

        {selectedTask ? (
          <div className='flex min-w-0 flex-1 basis-1/2 animate-in slide-in-from-right duration-200'>
            <TaskView task={selectedTask} />
          </div>
        ) : null}
      </div>

      <NewTaskDialog
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
        defaultProjectId={project.id}
        defaultStatus={defaultStatus}
      />
    </div>
  )
}
