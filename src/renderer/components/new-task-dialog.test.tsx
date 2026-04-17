import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProject,
  buildTask,
  mockApiBridge,
  mockFetchJson,
  renderWithProviders,
  restoreApiBridge
} from '../test-utils'
import { NewTaskDialog } from './new-task-dialog'

describe('NewTaskDialog', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    restoreApiBridge()
  })

  it('renders the task title, description, and create button', () => {
    mockFetchJson({ '/projects': { projects: [buildProject()] } })

    renderWithProviders(
      <NewTaskDialog
        open
        onOpenChange={() => undefined}
        defaultProjectId='project-1'
      />
    )

    expect(screen.getByPlaceholderText(/task title/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/add description/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /create task/i })
    ).toBeInTheDocument()
  })

  it('disables submit until a title is entered', async () => {
    mockFetchJson({ '/projects': { projects: [buildProject()] } })

    renderWithProviders(
      <NewTaskDialog
        open
        onOpenChange={() => undefined}
        defaultProjectId='project-1'
      />
    )

    const submit = screen.getByRole('button', { name: /create task/i })
    expect(submit).toBeDisabled()

    await userEvent.type(screen.getByPlaceholderText(/task title/i), 'A task')
    expect(submit).not.toBeDisabled()
  })

  it('submits the task and closes the dialog', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    mockFetchJson({
      '/projects': { projects: [buildProject()] },
      '/tasks': { task: buildTask({ title: 'Ship it' }) }
    })

    renderWithProviders(
      <NewTaskDialog
        open
        onOpenChange={onOpenChange}
        defaultProjectId='project-1'
      />
    )

    await user.type(screen.getByPlaceholderText(/task title/i), 'Ship it')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('keeps the dialog open when Create more is enabled', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    mockFetchJson({
      '/projects': { projects: [buildProject()] },
      '/tasks': { task: buildTask({ title: 'Ship it' }) }
    })

    renderWithProviders(
      <NewTaskDialog
        open
        onOpenChange={onOpenChange}
        defaultProjectId='project-1'
      />
    )

    await user.click(screen.getByRole('switch'))
    await user.type(screen.getByPlaceholderText(/task title/i), 'Ship it')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/task title/i)).toHaveValue('')
    })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
