import { Navigate } from 'react-router-dom'
import { Welcome } from '../components/welcome'
import { useProjectsQuery } from '../hooks/use-projects'

interface HomeRouteProps {
  onCreateProject: () => void
}

export function HomeRoute({ onCreateProject }: HomeRouteProps) {
  const projectsQuery = useProjectsQuery()
  const projects = projectsQuery.data ?? []
  const firstProjectId = projects[0]?.id ?? null

  if (firstProjectId) {
    return (
      <Navigate
        to={`/projects/${firstProjectId}`}
        replace
      />
    )
  }

  return <Welcome onCreateProject={onCreateProject} />
}
