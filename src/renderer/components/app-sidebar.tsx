import { useQueries } from '@tanstack/react-query'
import { ChevronDown, Plus, Settings } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useMatch } from 'react-router-dom'
import type { Project } from '../hooks/use-projects'
import type { AgentState, Task } from '../hooks/use-tasks'
import { apiFetch } from '../lib/api-client'
import { cn } from '../lib/utils'
import { Mark } from './ui/mark'
import { Sidebar, SidebarContent } from './ui/sidebar'

type AttentionState = 'needs_attention' | 'running' | 'idle'

interface AppSidebarProps {
  projects: Project[]
  onAddProject: () => void
}

function deriveAttention(agentStates: AgentState[]): AttentionState {
  if (agentStates.includes('waiting_for_input')) {
    return 'needs_attention'
  }

  if (agentStates.includes('working')) {
    return 'running'
  }

  return 'idle'
}

function useProjectAttentionMap(
  projects: Project[]
): Map<string, AttentionState> {
  const results = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['tasks', project.id] as const,
      queryFn: async () => {
        const data = await apiFetch<{ tasks: Task[] }>(
          `/tasks?projectId=${encodeURIComponent(project.id)}`
        )

        return data.tasks
      }
    }))
  })

  return useMemo(() => {
    const map = new Map<string, AttentionState>()

    projects.forEach((project, index) => {
      const tasks = results[index]?.data ?? []
      map.set(project.id, deriveAttention(tasks.map((task) => task.agentState)))
    })

    return map
  }, [projects, results])
}

function AttentionDot({ state }: { state: AttentionState }) {
  if (state === 'needs_attention') {
    return (
      <span
        className='relative flex size-2 shrink-0'
        aria-label='needs your attention'
      >
        <span className='absolute inline-flex size-full animate-ping rounded-full bg-[color:var(--accent)] opacity-75' />
        <span className='relative inline-flex size-2 rounded-full bg-[color:var(--accent)]' />
      </span>
    )
  }

  if (state === 'running') {
    return (
      <span
        className='size-2 shrink-0 animate-attention-pulse rounded-full bg-[color:var(--st-running)]'
        aria-hidden='true'
      />
    )
  }

  return null
}

interface ProjectItemProps {
  project: Project
  attention: AttentionState
}

function ProjectItem({ attention, project }: ProjectItemProps) {
  const match = useMatch(`/projects/${project.id}`)
  const agentMatch = useMatch(`/projects/${project.id}/agent/*`)
  const isActive = Boolean(match) || Boolean(agentMatch)

  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className={cn(
          'flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-[color:var(--fg-2)] transition-colors',
          'hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]',
          isActive &&
            'bg-[color:var(--selected-bg)] font-medium text-[color:var(--fg)]'
        )}
      >
        <span
          aria-hidden='true'
          className='size-3 shrink-0 rounded-[3px]'
          style={{ backgroundColor: 'var(--accent)' }}
        />
        <span className='flex-1 truncate'>{project.name}</span>
        <AttentionDot state={attention} />
      </Link>
    </li>
  )
}

interface ProjectsListProps {
  projects: Project[]
  onAddProject: () => void
}

function ProjectsList({ onAddProject, projects }: ProjectsListProps) {
  const attentionByProjectId = useProjectAttentionMap(projects)

  if (projects.length === 0) {
    return (
      <div className='px-2 py-2'>
        <p className='text-[12px] text-[color:var(--fg-3)]'>No projects yet.</p>
        <button
          type='button'
          onClick={onAddProject}
          className='mt-1 text-[11px] text-[color:var(--accent)] hover:underline'
        >
          Create your first project
        </button>
      </div>
    )
  }

  return (
    <ul className='flex flex-col gap-[1px]'>
      {projects.map((project) => (
        <ProjectItem
          key={project.id}
          project={project}
          attention={attentionByProjectId.get(project.id) ?? 'idle'}
        />
      ))}
    </ul>
  )
}

export function AppSidebar({ onAddProject, projects }: AppSidebarProps) {
  return (
    <Sidebar className='border-r border-[color:var(--line)]'>
      <SidebarContent className='gap-3.5 px-2 py-2.5'>
        <div className='flex items-center gap-1 px-1'>
          <button
            type='button'
            className='flex flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] font-medium text-[color:var(--fg)] hover:bg-[color:var(--bg-3)]'
          >
            <Mark size={20} />
            <span className='flex-1 truncate'>code-monkey</span>
            <ChevronDown
              aria-hidden='true'
              className='size-3 text-[color:var(--fg-3)]'
            />
          </button>
          <button
            type='button'
            onClick={onAddProject}
            aria-label='New project'
            className='inline-flex size-6 items-center justify-center rounded-md text-[color:var(--fg-3)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]'
          >
            <Plus
              aria-hidden='true'
              className='size-3.5'
            />
          </button>
        </div>

        <div className='group/projects flex flex-col gap-[1px]'>
          <div className='flex items-center justify-between px-2 py-1 text-[11px] font-medium text-[color:var(--fg-3)]'>
            <span>Projects</span>
            <button
              type='button'
              onClick={onAddProject}
              aria-label='New project'
              className='inline-flex size-[18px] items-center justify-center rounded-md text-[color:var(--fg-3)] opacity-0 transition-opacity hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)] group-hover/projects:opacity-100 focus-visible:opacity-100'
            >
              <Plus
                aria-hidden='true'
                className='size-3'
              />
            </button>
          </div>

          <ProjectsList
            projects={projects}
            onAddProject={onAddProject}
          />
        </div>

        <div className='flex-1' />

        <div className='border-t border-[color:var(--line)] pt-1.5'>
          <Link
            to='/settings'
            className='flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-[color:var(--fg-2)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]'
          >
            <Settings
              aria-hidden='true'
              className='size-3.5 text-[color:var(--fg-3)]'
            />
            <span>Settings</span>
          </Link>
        </div>
      </SidebarContent>
    </Sidebar>
  )
}
