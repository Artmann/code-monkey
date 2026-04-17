import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTask,
  mockApiBridge,
  mockFetchJson,
  renderWithProviders,
  restoreApiBridge
} from '../test-utils'
import { TaskList, groupTasks } from './task-list'

describe('groupTasks', () => {
  it('buckets tasks by status and sorts by sortOrder', () => {
    const tasks = [
      buildTask({ id: 'a', status: 'done', sortOrder: 1 }),
      buildTask({ id: 'b', status: 'todo', sortOrder: 2 }),
      buildTask({ id: 'c', status: 'todo', sortOrder: 1 })
    ]

    const groups = groupTasks(tasks)

    expect(groups.todo.map((task) => task.id)).toEqual(['c', 'b'])
    expect(groups.done.map((task) => task.id)).toEqual(['a'])
    expect(groups.in_progress).toEqual([])
  })
})

describe('TaskList', () => {
  beforeEach(() => {
    mockApiBridge()
    mockFetchJson({})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    restoreApiBridge()
  })

  it('renders a row per task with the title visible', () => {
    renderWithProviders(
      <TaskList
        projectId='project-1'
        tasks={[
          buildTask({ id: 't1', title: 'First task', status: 'todo' }),
          buildTask({ id: 't2', title: 'Second task', status: 'in_progress' })
        ]}
        onRequestCreate={() => undefined}
      />
    )

    expect(screen.getByText('First task')).toBeInTheDocument()
    expect(screen.getByText('Second task')).toBeInTheDocument()
  })

  it('shows empty-state text for groups without tasks', () => {
    renderWithProviders(
      <TaskList
        projectId='project-1'
        tasks={[]}
        onRequestCreate={() => undefined}
      />
    )

    const emptyLabels = screen.getAllByText(/no tasks/i)

    expect(emptyLabels.length).toEqual(3)
  })

  it('shows the agent state badge next to the task', () => {
    renderWithProviders(
      <TaskList
        projectId='project-1'
        tasks={[
          buildTask({
            id: 't1',
            title: 'Waiting task',
            agentState: 'waiting_for_input'
          })
        ]}
        onRequestCreate={() => undefined}
      />
    )

    expect(screen.getByText(/waiting for input/i)).toBeInTheDocument()
  })
})
