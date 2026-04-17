import { useQueries } from '@tanstack/react-query'
import { Folder, Plus, Settings } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useMatch } from 'react-router-dom'
import type { Project } from '../hooks/use-projects'
import type { AgentState, Task } from '../hooks/use-tasks'
import { apiFetch } from '../lib/api-client'
import { cn } from '../lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from './ui/sidebar'

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
        <span className='absolute inline-flex size-full animate-ping rounded-full bg-banana opacity-75' />
        <span className='relative inline-flex size-2 rounded-full bg-banana' />
      </span>
    )
  }

  if (state === 'running') {
    return (
      <span
        className='size-2 shrink-0 rounded-full bg-sky-500 animate-banana-pulse'
        aria-hidden='true'
      />
    )
  }

  return (
    <span
      className='size-1.5 shrink-0 rounded-full bg-muted-foreground/40'
      aria-hidden='true'
    />
  )
}

interface ProjectSidebarItemProps {
  project: Project
  attention: AttentionState
}

function ProjectSidebarItem({ project, attention }: ProjectSidebarItemProps) {
  const match = useMatch(`/projects/${project.id}`)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={Boolean(match)}
      >
        <Link to={`/projects/${project.id}`}>
          <Folder />
          <span className='flex-1 truncate'>{project.name}</span>
          <AttentionDot state={attention} />
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

interface AttentionSectionProps {
  label: string
  tone: AttentionState
  projects: Project[]
  attentionByProjectId: Map<string, AttentionState>
}

function AttentionSection({
  attentionByProjectId,
  label,
  projects,
  tone
}: AttentionSectionProps) {
  if (projects.length === 0) {
    return null
  }

  const labelClass = cn(
    'px-2 pb-1 pt-3 font-display text-[10px] font-semibold uppercase tracking-widest',
    tone === 'needs_attention' && 'text-banana',
    tone === 'running' && 'text-sky-500',
    tone === 'idle' && 'text-muted-foreground/60'
  )

  return (
    <>
      <div className={labelClass}>{label}</div>
      <SidebarMenu>
        {projects.map((project) => (
          <ProjectSidebarItem
            key={project.id}
            project={project}
            attention={attentionByProjectId.get(project.id) ?? 'idle'}
          />
        ))}
      </SidebarMenu>
    </>
  )
}

function SidebarLogo() {
  return (
    <div className='flex items-center gap-2 px-2 py-2'>
      <div className='flex size-8 items-center justify-center rounded-md bg-banana/20 ring-1 ring-banana/30'>
        <span className='text-xl leading-none select-none'>🦍</span>
      </div>
      <div className='flex flex-col leading-tight'>
        <span className='font-display text-base font-bold tracking-tight'>
          Code Monkey
        </span>
        <span className='font-mono text-[10px] uppercase tracking-wider text-muted-foreground'>
          apes · together · strong
        </span>
      </div>
    </div>
  )
}

function EmptyProjects() {
  return (
    <div className='flex flex-col gap-1 px-2 py-2'>
      <p className='text-sm text-muted-foreground'>No projects yet.</p>
      <p className='font-mono text-[11px] text-muted-foreground/70'>
        🍌 ape idle. make project.
      </p>
    </div>
  )
}

interface GroupedProjectsProps {
  projects: Project[]
}

function GroupedProjects({ projects }: GroupedProjectsProps) {
  const attentionByProjectId = useProjectAttentionMap(projects)

  const grouped = useMemo(() => {
    const buckets: Record<AttentionState, Project[]> = {
      needs_attention: [],
      running: [],
      idle: []
    }

    for (const project of projects) {
      const state = attentionByProjectId.get(project.id) ?? 'idle'
      buckets[state].push(project)
    }

    return buckets
  }, [projects, attentionByProjectId])

  return (
    <>
      <AttentionSection
        label='Needs you 🍌'
        tone='needs_attention'
        projects={grouped.needs_attention}
        attentionByProjectId={attentionByProjectId}
      />
      <AttentionSection
        label='Running'
        tone='running'
        projects={grouped.running}
        attentionByProjectId={attentionByProjectId}
      />
      <AttentionSection
        label='Idle'
        tone='idle'
        projects={grouped.idle}
        attentionByProjectId={attentionByProjectId}
      />
    </>
  )
}

export function AppSidebar({ projects, onAddProject }: AppSidebarProps) {
  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarLogo />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className='font-display text-xs font-semibold tracking-wide text-muted-foreground'>
            Projects
          </SidebarGroupLabel>
          <SidebarGroupAction
            title='New project'
            onClick={onAddProject}
          >
            <Plus />
            <span className='sr-only'>New project</span>
          </SidebarGroupAction>

          <SidebarGroupContent>
            {projects.length === 0 ? (
              <EmptyProjects />
            ) : (
              <GroupedProjects projects={projects} />
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link to='/settings'>
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
