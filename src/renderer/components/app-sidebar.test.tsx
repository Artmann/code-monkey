import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildProject, renderWithProviders } from '../test-utils'
import { AppSidebar } from './app-sidebar'
import { SidebarProvider } from './ui/sidebar'

function renderSidebar(props: Partial<React.ComponentProps<typeof AppSidebar>>) {
  return renderWithProviders(
    <SidebarProvider>
      <AppSidebar
        projects={props.projects ?? []}
        onAddProject={props.onAddProject ?? (() => undefined)}
      />
    </SidebarProvider>
  )
}

describe('AppSidebar', () => {
  it('shows an empty state when there are no projects', () => {
    renderSidebar({ projects: [] })

    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument()
  })

  it('lists each project as a link', () => {
    const projects = [
      buildProject({ id: 'p1', name: 'Alpha' }),
      buildProject({ id: 'p2', name: 'Beta' })
    ]

    renderSidebar({ projects })

    const alphaLink = screen.getByRole('link', { name: /alpha/i })
    const betaLink = screen.getByRole('link', { name: /beta/i })

    expect(alphaLink).toHaveAttribute('href', '/projects/p1')
    expect(betaLink).toHaveAttribute('href', '/projects/p2')
  })

  it('calls onAddProject when the + button is clicked', async () => {
    const user = userEvent.setup()
    const onAddProject = vi.fn()

    renderSidebar({ projects: [], onAddProject })

    await user.click(screen.getByRole('button', { name: /new project/i }))

    expect(onAddProject).toHaveBeenCalledOnce()
  })
})
