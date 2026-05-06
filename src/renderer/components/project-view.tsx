import { Filter, MoreHorizontal, Plus } from 'lucide-react'
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
  type Task,
  type TaskStatus
} from '../hooks/use-tasks'
import { cn } from '../lib/utils'
import { NewTaskDialog } from './new-task-dialog'
import { ProjectAgentView } from './project-agent-view'
import { TaskList } from './task-list'
import { TaskView } from './task-view'
import { Button } from './ui/button'
import { SidebarTrigger } from './ui/sidebar'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'

interface ProjectViewProps {
  project: Project | null
}

type ActiveTab = 'tasks' | 'agent'

function countActiveTasks(tasks: Task[]) {
  return tasks.filter((task) => task.status !== 'done').length
}

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

  const lastAgentPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!project) {
      return
    }

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
        <p className='text-[color:var(--fg-3)]'>
          Select a project from the sidebar.
        </p>
      </div>
    )
  }

  function onTabChange(next: string) {
    if (!project) {
      return
    }

    const search = location.search

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

  const totalCount = tasks.length
  const activeCount = countActiveTasks(tasks)
  const tabLabel = activeTab === 'agent' ? 'Agent' : 'Tasks'

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-background'>
      <div className='flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[color:var(--line)] px-4'>
        <div className='flex items-center gap-2.5'>
          <SidebarTrigger className='size-6 text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]' />
          <nav
            aria-label='Breadcrumb'
            className='flex items-center gap-1.5 text-[13px]'
          >
            <span className='text-[color:var(--fg-3)]'>{project.name}</span>
            <span className='text-[color:var(--fg-4)]'>/</span>
            <span className='font-medium text-[color:var(--fg)]'>
              {tabLabel}
            </span>
          </nav>
        </div>

        <div className='flex items-center gap-1'>
          {activeTab === 'tasks' ? (
            <>
              <button
                type='button'
                aria-label='Filter'
                className='inline-flex size-6 items-center justify-center rounded-md text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]'
              >
                <Filter
                  aria-hidden='true'
                  className='size-3.5'
                />
              </button>
              <button
                type='button'
                aria-label='More'
                className='inline-flex size-6 items-center justify-center rounded-md text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]'
              >
                <MoreHorizontal
                  aria-hidden='true'
                  className='size-3.5'
                />
              </button>
              <Button
                size='sm'
                onClick={() => openDialog('todo')}
                className='ml-1 h-7 gap-1 px-2.5'
              >
                <Plus
                  aria-hidden='true'
                  className='size-3.5'
                />
                New task
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className='flex shrink-0 items-center justify-between gap-3 border-b border-[color:var(--line)] px-4 py-1.5'>
        <Tabs
          value={activeTab}
          onValueChange={onTabChange}
          className='gap-0'
        >
          <TabsList className='gap-0.5 bg-transparent p-0'>
            <TabsTrigger
              value='tasks'
              className='h-7 gap-1.5'
            >
              <span>Tasks</span>
              <span className='inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[color:var(--bg-3)] px-1.5 text-[10.5px] font-medium tabular-nums text-[color:var(--fg-3)] data-[state=active]:bg-[color:var(--bg)]'>
                {totalCount}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value='agent'
              className='h-7'
            >
              Agent
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <span
          className='inline-flex max-w-[40ch] items-center gap-1 truncate rounded-md border border-[color:var(--line)] bg-[color:var(--bg-3)] px-2 py-[3px] font-mono text-[11px] text-[color:var(--fg-3)]'
          title={project.directoryPath}
        >
          {project.directoryPath}
        </span>
      </div>

      {/* keep `activeCount` reachable for Active filter wiring later */}
      <span
        className='hidden'
        data-active-count={activeCount}
        aria-hidden='true'
      />

      <div className='flex min-h-0 flex-1 overflow-hidden'>
        <div
          className={cn(
            'flex min-w-0 flex-col overflow-hidden transition-[flex-basis] duration-200',
            isSplit ? 'flex-none basis-1/2' : 'flex-1 basis-full'
          )}
        >
          {activeTab === 'tasks' ? (
            <div className='flex min-h-0 flex-1 flex-col overflow-y-auto'>
              <TaskList
                projectId={project.id}
                tasks={tasks}
                onRequestCreate={openDialog}
                selectedTaskId={selectedTask?.id ?? null}
              />
            </div>
          ) : (
            <ProjectAgentView project={project} />
          )}
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
