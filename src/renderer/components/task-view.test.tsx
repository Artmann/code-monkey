import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTask,
  mockApiBridge,
  mockFetchJson,
  renderWithProviders,
  restoreApiBridge
} from '../test-utils'
import { TaskView } from './task-view'

describe('TaskView', () => {
  beforeEach(() => {
    mockApiBridge()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    restoreApiBridge()
  })

  it('renders the task title and agent state', () => {
    renderWithProviders(
      <TaskView
        task={buildTask({
          title: 'Build the thing',
          agentState: 'working'
        })}
      />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    expect(
      screen.getByRole('button', { name: /build the thing/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/working/i)).toBeInTheDocument()
  })

  it('renders the description as markdown', () => {
    renderWithProviders(
      <TaskView
        task={buildTask({
          title: 'Docs',
          description: '# Heading\n\nSome **bold** text.'
        })}
      />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    expect(
      screen.getByRole('heading', { level: 1, name: /heading/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/bold/i).tagName).toEqual('STRONG')
  })

  it('edits the title on click and saves on Enter', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchJson({
      '/tasks/task-1': {
        task: buildTask({ title: 'Updated title' })
      }
    })

    renderWithProviders(
      <TaskView task={buildTask({ id: 'task-1', title: 'Old title' })} />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    await user.click(screen.getByRole('button', { name: /old title/i }))

    const input = screen.getByRole('textbox', { name: /task title/i })
    await user.clear(input)
    await user.type(input, 'Updated title{enter}')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })

    const call = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit]
    const init = call[1]
    expect(init.method).toEqual('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Updated title' })
  })

  it('opens the description editor from the pen button', async () => {
    const user = userEvent.setup()
    mockFetchJson({})

    renderWithProviders(
      <TaskView
        task={buildTask({ description: 'Original description' })}
      />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    await user.click(screen.getByRole('button', { name: /edit description/i }))

    expect(
      screen.getByRole('textbox', { name: /task description/i })
    ).toHaveValue('Original description')
  })

  it('cancels title edit on Escape without saving', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchJson({})

    renderWithProviders(
      <TaskView task={buildTask({ title: 'Keep me' })} />,
      { initialEntries: ['/projects/project-1/tasks/task-1'] }
    )

    await user.click(screen.getByRole('button', { name: /keep me/i }))
    await user.type(
      screen.getByRole('textbox', { name: /task title/i }),
      'discard'
    )
    await user.keyboard('{Escape}')

    expect(
      screen.getByRole('button', { name: /keep me/i })
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
