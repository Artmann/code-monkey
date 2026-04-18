import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import type { Thread } from '../hooks/use-thread'
import { buildTask, renderWithProviders } from '../test-utils'
import {
  AgentHeaderControls,
  type AgentHeaderControlsProps
} from './agent-header-controls'

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

const baseProps = (
  overrides: Partial<AgentHeaderControlsProps> = {}
): AgentHeaderControlsProps => ({
  task: buildTask({ status: 'todo' }),
  thread: null,
  providerConfigured: true,
  onStartWork: () => undefined,
  onRestartChat: () => undefined,
  onMerge: () => undefined,
  isStarting: false,
  isRestarting: false,
  isMerging: false,
  ...overrides
})

describe('AgentHeaderControls', () => {
  test('shows Start Work when there is no thread and the provider is configured', async () => {
    const onStartWork = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <AgentHeaderControls {...baseProps({ onStartWork })} />
    )

    const button = screen.getByRole('button', { name: /start work/i })

    expect(button).toBeEnabled()

    await user.click(button)

    expect(onStartWork).toHaveBeenCalledTimes(1)
  })

  test('disables Start Work when the provider is not configured', () => {
    renderWithProviders(
      <AgentHeaderControls {...baseProps({ providerConfigured: false })} />
    )

    expect(
      screen.getByRole('button', { name: /start work/i })
    ).toBeDisabled()
  })

  test('disables Start Work while starting', () => {
    renderWithProviders(
      <AgentHeaderControls {...baseProps({ isStarting: true })} />
    )

    expect(
      screen.getByRole('button', { name: /starting/i })
    ).toBeDisabled()
  })

  test('shows Merge to Main and New chat when a thread exists and the task is not done', async () => {
    const onMerge = vi.fn()
    const onRestartChat = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <AgentHeaderControls
        {...baseProps({
          task: buildTask({ status: 'in_progress' }),
          thread: buildThread({ status: 'idle' }),
          onMerge,
          onRestartChat
        })}
      />
    )

    const merge = screen.getByRole('button', { name: /merge to main/i })
    const restart = screen.getByRole('button', { name: /start new chat/i })

    expect(merge).toBeEnabled()
    expect(restart).toBeEnabled()

    await user.click(merge)
    await user.click(restart)

    expect(onMerge).toHaveBeenCalledTimes(1)
    expect(onRestartChat).toHaveBeenCalledTimes(1)
  })

  test('disables Merge to Main while the thread is running', () => {
    renderWithProviders(
      <AgentHeaderControls
        {...baseProps({
          task: buildTask({ status: 'in_progress' }),
          thread: buildThread({ status: 'running' })
        })}
      />
    )

    expect(
      screen.getByRole('button', { name: /merge to main/i })
    ).toBeDisabled()
  })

  test('disables New chat while the thread is running', () => {
    renderWithProviders(
      <AgentHeaderControls
        {...baseProps({
          task: buildTask({ status: 'in_progress' }),
          thread: buildThread({ status: 'running' })
        })}
      />
    )

    expect(
      screen.getByRole('button', { name: /start new chat/i })
    ).toBeDisabled()
  })

  test('disables New chat while restarting', () => {
    renderWithProviders(
      <AgentHeaderControls
        {...baseProps({
          task: buildTask({ status: 'in_progress' }),
          thread: buildThread({ status: 'idle' }),
          isRestarting: true
        })}
      />
    )

    expect(
      screen.getByRole('button', { name: /start new chat/i })
    ).toBeDisabled()
  })

  test('disables Merge to Main while the agent state is working', () => {
    renderWithProviders(
      <AgentHeaderControls
        {...baseProps({
          task: buildTask({ status: 'in_progress', agentState: 'working' }),
          thread: buildThread({ status: 'idle' })
        })}
      />
    )

    expect(
      screen.getByRole('button', { name: /merge to main/i })
    ).toBeDisabled()
  })

  test('disables Merge to Main while merging', () => {
    renderWithProviders(
      <AgentHeaderControls
        {...baseProps({
          task: buildTask({ status: 'in_progress' }),
          thread: buildThread({ status: 'idle' }),
          isMerging: true
        })}
      />
    )

    expect(
      screen.getByRole('button', { name: /merging/i })
    ).toBeDisabled()
  })

  test('renders nothing when the task is done', () => {
    const { container } = renderWithProviders(
      <AgentHeaderControls
        {...baseProps({
          task: buildTask({ status: 'done' }),
          thread: buildThread({ status: 'idle' })
        })}
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
