import { useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AppSidebar } from './components/app-sidebar'
import { NewProjectDialog } from './components/new-project-dialog'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger
} from './components/ui/sidebar'
import { useProjectsQuery } from './hooks/use-projects'
import { HomeRoute } from './routes/home-route'
import { ProjectRoute } from './routes/project-route'

export function App() {
  const projectsQuery = useProjectsQuery()
  const [isDialogOpen, setDialogOpen] = useState(false)

  const projects = projectsQuery.data ?? []

  return (
    <SidebarProvider>
      <AppSidebar
        projects={projects}
        onAddProject={() => setDialogOpen(true)}
      />

      <SidebarInset>
        <header className='flex items-center gap-2 border-b px-3 py-2'>
          <SidebarTrigger />
          <span className='font-mono text-[10px] uppercase tracking-widest text-muted-foreground'>
            🍌 apes strong together
          </span>
        </header>

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
            path='/projects/:projectId/tasks/:taskId'
            element={<ProjectRoute />}
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
