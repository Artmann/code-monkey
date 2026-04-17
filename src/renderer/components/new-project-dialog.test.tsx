import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProject,
  mockApiBridge,
  mockFetchJson,
  renderWithProviders,
  restoreApiBridge
} from '../test-utils'
import { NewProjectDialog } from './new-project-dialog'

describe('NewProjectDialog', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    restoreApiBridge()
  })

  it('renders title and description', () => {
    renderWithProviders(
      <NewProjectDialog
        open
        onOpenChange={() => undefined}
      />
    )

    expect(
      screen.getByRole('heading', { name: /new project/i })
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/folder/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
  })

  it('prefills name from the selected folder basename', async () => {
    const user = userEvent.setup()
    const selectFolder = vi.fn(async () => ({
      canceled: false,
      directoryPath: '/Users/test/Code/alpha',
      suggestedName: 'alpha'
    }))

    ;(window as unknown as { codeMonkey: { apiPort: number; selectFolder: typeof selectFolder } }).codeMonkey =
      { apiPort: 1234, selectFolder }

    renderWithProviders(
      <NewProjectDialog
        open
        onOpenChange={() => undefined}
      />
    )

    await user.click(screen.getByRole('button', { name: /browse/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/folder/i)).toHaveValue(
        '/Users/test/Code/alpha'
      )
    })
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('alpha')
  })

  it('submits the form and closes on success', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    const selectFolder = vi.fn(async () => ({
      canceled: false,
      directoryPath: '/Users/test/beta',
      suggestedName: 'beta'
    }))

    ;(window as unknown as { codeMonkey: { apiPort: number; selectFolder: typeof selectFolder } }).codeMonkey =
      { apiPort: 1234, selectFolder }

    mockFetchJson({
      '/projects': { project: buildProject({ id: 'new', name: 'beta' }) }
    })

    renderWithProviders(
      <NewProjectDialog
        open
        onOpenChange={onOpenChange}
      />
    )

    await user.click(screen.getByRole('button', { name: /browse/i }))

    await waitFor(() => {
      expect(screen.getByLabelText(/^name$/i)).toHaveValue('beta')
    })

    await user.click(screen.getByRole('button', { name: /create project/i }))

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
