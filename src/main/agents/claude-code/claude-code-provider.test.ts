import { describe, expect, test, vi } from 'vitest'

import { createClaudeCodeProvider } from './claude-code-provider'

type CapturedOptions = {
  canUseTool?: (
    tool: string,
    input: Record<string, unknown>,
    context: unknown
  ) => Promise<
    | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
    | { behavior: 'deny'; message: string }
  >
}

type QueryInput = {
  prompt: string
  options?: CapturedOptions & Record<string, unknown>
}

const makeFakeSdk =
  (
    captured: CapturedOptions[],
    onQuery?: (input: QueryInput) => AsyncIterable<{ type: string }>
  ) =>
  async () => ({
    query: (input: QueryInput) => {
      captured.push(input.options ?? {})

      if (onQuery) return onQuery(input)

      return (async function* () {
        // Default: empty stream — lets tests invoke canUseTool directly.
      })()
    }
  })

describe('claude-code provider approval wiring', () => {
  test('passes canUseTool that emits approval_requested and resolves on approve', async () => {
    const captured: CapturedOptions[] = []
    const provider = await createClaudeCodeProvider(
      { mode: 'cli' },
      makeFakeSdk(captured)
    )

    const onApprovalRequest = vi.fn(async () => ({
      decision: 'approve' as const
    }))

    const thread = provider.startThread({
      workingDirectory: '/tmp',
      onApprovalRequest
    })

    const { events } = await thread.runStreamed('hi')
    const iterator = events[Symbol.asyncIterator]()

    const canUse = captured[0]?.canUseTool

    expect(canUse).toBeTypeOf('function')

    const decisionPromise = canUse?.(
      'Bash',
      { command: 'git commit -m test' },
      {}
    )

    const first = await iterator.next()

    expect(first.done).toBe(false)
    expect(first.value).toMatchObject({
      type: 'item.approval_requested',
      item: expect.objectContaining({
        tool: 'Bash',
        summary: 'git commit -m test'
      })
    })

    const second = await iterator.next()

    expect(second.value).toMatchObject({
      type: 'item.approval_resolved',
      item: expect.objectContaining({ decision: 'approve' })
    })

    const decision = await decisionPromise

    expect(decision).toEqual({ behavior: 'allow' })
    expect(onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'Bash' })
    )

    const end = await iterator.next()

    expect(end.done).toBe(true)
  })

  test('reject translates to SDK deny with the reason as message', async () => {
    const captured: CapturedOptions[] = []
    const provider = await createClaudeCodeProvider(
      { mode: 'cli' },
      makeFakeSdk(captured)
    )

    const onApprovalRequest = vi.fn(async () => ({
      decision: 'reject' as const,
      reason: 'let me do this myself'
    }))

    const thread = provider.startThread({
      workingDirectory: '/tmp',
      onApprovalRequest
    })

    const { events } = await thread.runStreamed('hi')
    const iterator = events[Symbol.asyncIterator]()

    const canUse = captured[0]?.canUseTool
    const decisionPromise = canUse?.('Bash', { command: 'rm -rf /' }, {})

    // Drain approval events so the decision promise can resolve.
    await iterator.next()
    await iterator.next()

    const decision = await decisionPromise

    expect(decision).toEqual({
      behavior: 'deny',
      message: 'let me do this myself'
    })
  })

  test('omits canUseTool when no onApprovalRequest is provided', async () => {
    const captured: CapturedOptions[] = []
    const provider = await createClaudeCodeProvider(
      { mode: 'cli' },
      makeFakeSdk(captured)
    )

    const thread = provider.startThread({ workingDirectory: '/tmp' })

    await thread.runStreamed('hi')

    expect(captured[0]?.canUseTool).toBeUndefined()
  })
})
