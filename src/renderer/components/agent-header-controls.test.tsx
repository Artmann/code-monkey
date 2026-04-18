import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { Thread } from '../hooks/use-thread'
import { buildTask, renderWithProviders } from '../test-utils'
import { AgentHeaderControls } from './agent-header-controls'

const buildThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  taskId: 'task-1',
  projectId: null,
  codexThreadId: null,
  worktreePath: '/tmp/wt',
  branchName: 'code-monkey/t',
  baseBranch: 'main',
  status: 'idle',
  errorMessage: null,
  createdAt: new Date(0).toISOString(),
  lastActivityAt: new Date(0).toISOString(),
  ...overrides
})

describe('AgentHeaderControls', () => {
  test('shows Start Work when there is no thread and the provider is configured', async () => {
    const onStartWork = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <AgentHeaderControls
        task={buildTask({ status: 'todo' })}
        thread={null}
        providerConfigured={true}
        onStartWork={onStartWork}
        onMerge={() => undefined}
        isStarting={false}
        isMerging={false}
      />
    )

    const button = screen.getByRole('button', { name: /start work/i })

    expect(button).toBeEnabled()

    await user.click(button)

    expect(onStartWork).toHaveBeenCalledTimes(1)
  })

  test('disables Start Work when the provider is not configured', () => {
    renderWithProviders(
      <AgentHeaderControls
        task={buildTask({ status: 'todo' })}
        thread={null}
        providerConfigured={false}
        onStartWork={() => undefined}
        onMerge={() => undefined}
        isStarting={false}
        isMerging={false}
      />
    )

    expect(
      screen.getByRole('button', { name: /start work/i })
    ).toBeDisabled()
  })

  test('disables Start Work while starting', () => {
    renderWithProviders(
      <AgentHeaderControls
        task={buildTask({ status: 'todo' })}
        thread={null}
        providerConfigured={true}
        onStartWork={() => undefined}
        onMerge={() => undefined}
        isStarting={true}
        isMerging={false}
      />
    )

    expect(
      screen.getByRole('button', { name: /starting/i })
    ).toBeDisabled()
  })

  test('shows Merge to Main when a thread exists and the task is not done', async () => {
    const onMerge = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <AgentHeaderControls
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'idle' })}
        providerConfigured={true}
        onStartWork={() => undefined}
        onMerge={onMerge}
        isStarting={false}
        isMerging={false}
      />
    )

    const button = screen.getByRole('button', { name: /merge to main/i })

    expect(button).toBeEnabled()

    await user.click(button)

    expect(onMerge).toHaveBeenCalledTimes(1)
  })

  test('disables Merge to Main while the thread is running', () => {
    renderWithProviders(
      <AgentHeaderControls
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'running' })}
        providerConfigured={true}
        onStartWork={() => undefined}
        onMerge={() => undefined}
        isStarting={false}
        isMerging={false}
      />
    )

    expect(
      screen.getByRole('button', { name: /merge to main/i })
    ).toBeDisabled()
  })

  test('disables Merge to Main while the agent state is working', () => {
    renderWithProviders(
      <AgentHeaderControls
        task={buildTask({ status: 'in_progress', agentState: 'working' })}
        thread={buildThread({ status: 'idle' })}
        providerConfigured={true}
        onStartWork={() => undefined}
        onMerge={() => undefined}
        isStarting={false}
        isMerging={false}
      />
    )

    expect(
      screen.getByRole('button', { name: /merge to main/i })
    ).toBeDisabled()
  })

  test('disables Merge to Main while merging', () => {
    renderWithProviders(
      <AgentHeaderControls
        task={buildTask({ status: 'in_progress' })}
        thread={buildThread({ status: 'idle' })}
        providerConfigured={true}
        onStartWork={() => undefined}
        onMerge={() => undefined}
        isStarting={false}
        isMerging={true}
      />
    )

    expect(
      screen.getByRole('button', { name: /merging/i })
    ).toBeDisabled()
  })

  test('renders nothing when the task is done', () => {
    const { container } = renderWithProviders(
      <AgentHeaderControls
        task={buildTask({ status: 'done' })}
        thread={buildThread({ status: 'idle' })}
        providerConfigured={true}
        onStartWork={() => undefined}
        onMerge={() => undefined}
        isStarting={false}
        isMerging={false}
      />
    )

    expect(
      screen.queryByRole('button', { name: /start work/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /merge to main/i })
    ).not.toBeInTheDocument()
    expect(container.firstChild).toBeNull()
  })
})
