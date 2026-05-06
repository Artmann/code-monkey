import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProject,
  buildTask,
  mockApiBridge,
  mockFetchJson,
  renderWithProviders,
  restoreApiBridge
} from '../test-utils'
import { SidebarProvider } from './ui/sidebar'
import { ProjectView } from './project-view'

function renderProjectView(project: ReturnType<typeof buildProject> | null) {
  return renderWithProviders(
    <SidebarProvider>
      <ProjectView project={project} />
    </SidebarProvider>
  )
}

describe('ProjectView', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    restoreApiBridge()
  })

  it('prompts the user to pick a project when nothing is selected', () => {
    renderProjectView(null)

    expect(
      screen.getByText(/select a project from the sidebar/i)
    ).toBeInTheDocument()
  })

  it('renders the project header and status groups', async () => {
    mockFetchJson({ '/tasks': { tasks: [buildTask({ title: 'Setup' })] } })

    renderProjectView(buildProject({ name: 'Hello' }))

    expect(await screen.findByText('Setup')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText(/in progress/i)).toBeInTheDocument()
    expect(screen.getByText(/^todo$/i)).toBeInTheDocument()
    expect(screen.getByText(/^done$/i)).toBeInTheDocument()
  })
})
