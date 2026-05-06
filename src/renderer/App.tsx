import { useState } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppSidebar } from './components/app-sidebar'
import { NewProjectDialog } from './components/new-project-dialog'
import { SidebarInset, SidebarProvider } from './components/ui/sidebar'
import { useProjectsQuery } from './hooks/use-projects'
import { useRoutePersistence } from './hooks/use-route-persistence'
import { HomeRoute } from './routes/home-route'
import { ProjectRoute } from './routes/project-route'
import { SettingsRoute } from './routes/settings-route'

function LegacyTaskRedirect() {
  const { projectId, taskId } = useParams<{
    projectId: string
    taskId: string
  }>()

  return (
    <Navigate
      to={`/projects/${projectId}?task=${taskId}`}
      replace
    />
  )
}

export function App() {
  useRoutePersistence()

  const projectsQuery = useProjectsQuery()
  const [isDialogOpen, setDialogOpen] = useState(false)

  const projects = projectsQuery.data ?? []

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': '220px',
          '--sidebar-width-icon': '3rem'
        } as React.CSSProperties
      }
    >
      <AppSidebar
        projects={projects}
        onAddProject={() => setDialogOpen(true)}
      />

      <SidebarInset className='min-h-0 overflow-hidden bg-background'>
        <Routes>
          <Route
            path='/'
            element={<HomeRoute onCreateProject={() => setDialogOpen(true)} />}
          />
          <Route
            path='/projects/:projectId'
            element={<ProjectRoute />}
          />
          <Route
            path='/projects/:projectId/agent'
            element={<ProjectRoute />}
          />
          <Route
            path='/projects/:projectId/agent/threads/:threadId'
            element={<ProjectRoute />}
          />
          <Route
            path='/projects/:projectId/tasks/:taskId'
            element={<LegacyTaskRedirect />}
          />
          <Route
            path='/settings'
            element={<SettingsRoute />}
          />
        </Routes>
      </SidebarInset>

      <NewProjectDialog
        open={isDialogOpen}
        onOpenChange={setDialogOpen}
      />
    </SidebarProvider>
  )
}
