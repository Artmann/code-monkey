import { describe, expect, test } from 'vitest'

import {
  runOneOffAgent,
  type OneOffAgentCodex,
  type OneOffAgentTurn,
  type OneOffAgentThread
} from './one-off-agent'

type StartedThread = {
  options: Parameters<OneOffAgentCodex['startThread']>[0]
  inputs: string[]
}

const createFakeCodex = (
  respond: (input: string) => OneOffAgentTurn | Promise<OneOffAgentTurn>
) => {
  const started: StartedThread[] = []

  const codex: OneOffAgentCodex = {
    startThread: (options) => {
      const record: StartedThread = { options, inputs: [] }

      started.push(record)

      const thread: OneOffAgentThread = {
        run: async (input) => {
          record.inputs.push(input)

          return respond(input)
        }
      }

      return thread
    }
  }

  return { codex, started }
}

describe('runOneOffAgent', () => {
  test('starts a thread with the given working directory and returns the final response', async () => {
    const { codex, started } = createFakeCodex(() => ({
      finalResponse: '  Summary line\n'
    }))

    const text = await runOneOffAgent({
      codex,
      prompt: 'Summarize these changes.',
      workingDirectory: '/tmp/worktree'
    })

    expect(text).toEqual('Summary line')
    expect(started).toHaveLength(1)
    expect(started[0]?.options?.workingDirectory).toEqual('/tmp/worktree')
    expect(started[0]?.inputs).toEqual(['Summarize these changes.'])
  })

  test('defaults to a read-only sandbox with the agent unable to prompt', async () => {
    const { codex, started } = createFakeCodex(() => ({
      finalResponse: 'ok'
    }))

    await runOneOffAgent({
      codex,
      prompt: 'hi',
      workingDirectory: '/tmp'
    })

    expect(started[0]?.options?.sandboxMode).toEqual('read-only')
    expect(started[0]?.options?.approvalPolicy).toEqual('never')
    expect(started[0]?.options?.networkAccessEnabled).toEqual(false)
  })

  test('passes explicit overrides through to the thread options', async () => {
    const { codex, started } = createFakeCodex(() => ({
      finalResponse: 'ok'
    }))

    await runOneOffAgent({
      codex,
      prompt: 'hi',
      workingDirectory: '/tmp',
      sandboxMode: 'workspace-write',
      networkAccessEnabled: true,
      modelReasoningEffort: 'high'
    })

    expect(started[0]?.options?.sandboxMode).toEqual('workspace-write')
    expect(started[0]?.options?.networkAccessEnabled).toEqual(true)
    expect(started[0]?.options?.modelReasoningEffort).toEqual('high')
  })
})
