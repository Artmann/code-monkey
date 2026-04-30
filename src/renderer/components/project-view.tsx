import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  useLocation,
  useNavigate,
  useSearchParams
} from 'react-router-dom'
import type { Project } from '../hooks/use-projects'
import {
  useProjectTaskStream,
  useTasksQuery,
  type TaskStatus
} from '../hooks/use-tasks'
import { cn } from '../lib/utils'
import { NewTaskDialog } from './new-task-dialog'
import { ProjectAgentView } from './project-agent-view'
import { TaskList } from './task-list'
import { TaskView } from './task-view'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

interface ProjectViewProps {
  project: Project | null
}

type ActiveTab = 'tasks' | 'agent'

export function ProjectView({ project }: ProjectViewProps) {
  const tasksQuery = useTasksQuery(project?.id)
  const tasks = tasksQuery.data ?? []

  useProjectTaskStream(project?.id)

  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const taskId = searchParams.get('task')

  const activeTab: ActiveTab =
    project && location.pathname.startsWith(`/projects/${project.id}/agent`)
      ? 'agent'
      : 'tasks'

  const selectedTask = taskId
    ? tasks.find((task) => task.id === taskId) ?? null
    : null
  const isSplit = Boolean(selectedTask)

  const [isDialogOpen, setDialogOpen] = useState(false)
  const [defaultStatus, setDefaultStatus] = useState<TaskStatus>('todo')

  // Remember the pathname of the agent tab (for thread selection) so switching
  // back to it restores the last selected thread. The tasks tab pathname is
  // just the project root, so no memory is needed for it. The selected task
  // lives in `?task=` and is preserved across tab switches below.
  const lastAgentPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!project) return

    if (activeTab === 'agent') {
      lastAgentPathRef.current = location.pathname
    }
  }, [project, activeTab, location.pathname])

  useEffect(() => {
    lastAgentPathRef.current = null
  }, [project?.id])

  function openDialog(status: TaskStatus = 'todo') {
    setDefaultStatus(status)
    setDialogOpen(true)
  }

  useHotkeys(
    'c',
    (event) => {
      if (!project || activeTab !== 'tasks') {
        return
      }

      event.preventDefault()
      openDialog('todo')
    },
    {
      enabled: Boolean(project) && activeTab === 'tasks',
      preventDefault: true
    },
    [project, activeTab]
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

  function onTabChange(next: string) {
    if (!project) return

    const search = location.search // preserve ?task= across tab switches

    if (next === 'agent') {
      const pathname =
        lastAgentPathRef.current ?? `/projects/${project.id}/agent`
      navigate({ pathname, search })
    } else {
      navigate({ pathname: `/projects/${project.id}`, search })
    }
  }

  function closeTaskView() {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('task')
        return next
      },
      { replace: false }
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

        {activeTab === 'tasks' ? (
          <Button
            size='sm'
            onClick={() => openDialog('todo')}
            className='font-display font-semibold'
          >
            <Plus />
            New task
          </Button>
        ) : null}
      </div>

      <div className='flex min-h-0 flex-1 overflow-hidden'>
        <div
          className={cn(
            'flex min-w-0 flex-col overflow-hidden transition-[flex-basis] duration-200',
            isSplit ? 'flex-none basis-1/2' : 'flex-1 basis-full'
          )}
        >
          <Tabs
            value={activeTab}
            onValueChange={onTabChange}
            className='flex min-h-0 flex-1 flex-col gap-0 overflow-hidden'
          >
            <div className='border-b px-6 py-2'>
              <TabsList>
                <TabsTrigger value='tasks'>Tasks</TabsTrigger>
                <TabsTrigger value='agent'>Agent</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent
              value='tasks'
              className='flex min-h-0 flex-1 overflow-y-auto'
            >
              <div className='flex min-h-0 flex-1 flex-col'>
                <TaskList
                  projectId={project.id}
                  tasks={tasks}
                  onRequestCreate={openDialog}
                  selectedTaskId={selectedTask?.id ?? null}
                />
              </div>
            </TabsContent>

            <TabsContent
              value='agent'
              className='flex min-h-0 flex-1 overflow-hidden'
            >
              <ProjectAgentView project={project} />
            </TabsContent>
          </Tabs>
        </div>

        {selectedTask ? (
          <div className='flex min-w-0 flex-1 basis-1/2 animate-in slide-in-from-right duration-200'>
            <TaskView
              key={selectedTask.id}
              task={selectedTask}
              onClose={closeTaskView}
            />
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
