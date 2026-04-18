import { useParams } from 'react-router-dom'

import type { Project } from '../hooks/use-projects'
import { ProjectChatPane } from './project-chat-pane'

interface ProjectAgentViewProps {
  project: Project
}

export function ProjectAgentView({ project }: ProjectAgentViewProps) {
  const { threadId } = useParams<{ threadId?: string }>()

  return (
    <div className='flex min-h-0 flex-1 overflow-hidden'>
      <ProjectChatPane
        project={project}
        threadId={threadId ?? null}
      />
    </div>
  )
}
