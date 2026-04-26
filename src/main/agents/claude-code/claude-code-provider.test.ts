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
  permissionMode?: string
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
      { kind: 'claude-code', mode: 'cli', executablePath: null },
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
      { kind: 'claude-code', mode: 'cli', executablePath: null },
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
      { kind: 'claude-code', mode: 'cli', executablePath: null },
      makeFakeSdk(captured)
    )

    const thread = provider.startThread({ workingDirectory: '/tmp' })

    await thread.runStreamed('hi')

    expect(captured[0]?.canUseTool).toBeUndefined()
  })
})

describe('claude-code provider runtimeMode → permissionMode', () => {
  test.each([
    ['approval-required', 'default'],
    ['auto-accept-edits', 'acceptEdits'],
    ['full-access', 'bypassPermissions']
  ] as const)('%s maps to %s', async (runtimeMode, expectedPermissionMode) => {
    const captured: CapturedOptions[] = []
    const provider = await createClaudeCodeProvider(
      { kind: 'claude-code', mode: 'cli', executablePath: null },
      makeFakeSdk(captured)
    )

    const thread = provider.startThread({
      workingDirectory: '/tmp',
      runtimeMode
    })

    await thread.runStreamed('hi')

    expect(captured[0]?.permissionMode).toEqual(expectedPermissionMode)
  })

  test('defaults to permissionMode=default when runtimeMode is unset', async () => {
    const captured: CapturedOptions[] = []
    const provider = await createClaudeCodeProvider(
      { kind: 'claude-code', mode: 'cli', executablePath: null },
      makeFakeSdk(captured)
    )

    const thread = provider.startThread({ workingDirectory: '/tmp' })

    await thread.runStreamed('hi')

    expect(captured[0]?.permissionMode).toEqual('default')
  })
})

describe('claude-code provider special tools', () => {
  test('ExitPlanMode is denied without consulting onApprovalRequest, emits plan_proposed', async () => {
    const captured: CapturedOptions[] = []
    const provider = await createClaudeCodeProvider(
      { kind: 'claude-code', mode: 'cli', executablePath: null },
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

    const decisionPromise = canUse?.(
      'ExitPlanMode',
      { plan: '## Step 1\n- do thing' },
      {}
    )

    const first = await iterator.next()

    expect(first.done).toEqual(false)
    expect(first.value).toMatchObject({
      type: 'item.plan_proposed',
      item: expect.objectContaining({
        plan: '## Step 1\n- do thing'
      })
    })

    const decision = await decisionPromise

    expect(decision).toMatchObject({ behavior: 'deny' })
    expect(onApprovalRequest).not.toHaveBeenCalled()
  })

  test('AskUserQuestion routes through onUserInputRequest and returns answers as updatedInput', async () => {
    const captured: CapturedOptions[] = []
    const provider = await createClaudeCodeProvider(
      { kind: 'claude-code', mode: 'cli', executablePath: null },
      makeFakeSdk(captured)
    )

    const onUserInputRequest = vi.fn(async () => ({
      'Pick a color?': 'blue'
    }))

    const thread = provider.startThread({
      workingDirectory: '/tmp',
      onUserInputRequest
    })

    const { events } = await thread.runStreamed('hi')
    const iterator = events[Symbol.asyncIterator]()

    const canUse = captured[0]?.canUseTool

    const decisionPromise = canUse?.(
      'AskUserQuestion',
      {
        questions: [
          {
            question: 'Pick a color?',
            header: 'Color',
            multiSelect: false,
            options: [
              { label: 'red', description: 'a red color' },
              { label: 'blue', description: 'a blue color' }
            ]
          }
        ]
      },
      {}
    )

    const first = await iterator.next()

    expect(first.value).toMatchObject({
      type: 'item.user_input_requested',
      item: expect.objectContaining({
        questions: expect.arrayContaining([
          expect.objectContaining({ question: 'Pick a color?' })
        ])
      })
    })

    const second = await iterator.next()

    expect(second.value).toMatchObject({
      type: 'item.user_input_resolved',
      item: expect.objectContaining({
        answers: { 'Pick a color?': 'blue' }
      })
    })

    const decision = await decisionPromise

    expect(decision).toEqual({
      behavior: 'allow',
      updatedInput: { answers: { 'Pick a color?': 'blue' } }
    })
    expect(onUserInputRequest).toHaveBeenCalledTimes(1)
  })
})

describe('claude-code provider request classification', () => {
  test.each([
    ['Bash', { command: 'ls' }, 'command'],
    ['Edit', { file_path: '/tmp/x.ts' }, 'file_write'],
    ['Read', { file_path: '/tmp/x.ts' }, 'file_read'],
    ['WebFetch', { url: 'https://example.com' }, 'network'],
    ['WeirdUnknownTool', {}, 'other']
  ])(
    'classifies %s as %s',
    async (tool, input, expectedKind) => {
      const captured: CapturedOptions[] = []
      const provider = await createClaudeCodeProvider(
        { kind: 'claude-code', mode: 'cli', executablePath: null },
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

      void canUse?.(tool, input, {})

      const first = await iterator.next()

      expect(first.value).toMatchObject({
        type: 'item.approval_requested',
        item: expect.objectContaining({ kind: expectedKind })
      })
    }
  )
})
