import { useParams } from 'react-router-dom'

import { ProjectView } from '../components/project-view'
import { useProjectsQuery } from '../hooks/use-projects'

export function ProjectRoute() {
  const { projectId } = useParams<{ projectId: string }>()
  const projectsQuery = useProjectsQuery()

  const projects = projectsQuery.data ?? []
  const project = projects.find((candidate) => candidate.id === projectId)

  if (!project) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    )
  }

  return <ProjectView project={project} />
}
