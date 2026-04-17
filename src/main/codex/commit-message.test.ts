import { describe, expect, test } from 'vitest'

import {
  generateMergeCommitMessage,
  type GenerateMergeCommitMessageDependencies
} from './commit-message'

type AgentCall = { prompt: string; workingDirectory: string }

const createFakeAgent = (
  respond: (call: AgentCall) => string | Promise<string> | Error
) => {
  const calls: AgentCall[] = []

  const deps: GenerateMergeCommitMessageDependencies = {
    runAgent: async (call) => {
      calls.push(call)

      const result = await respond(call)

      if (result instanceof Error) throw result

      return result
    }
  }

  return { deps, calls }
}

const sampleDiff = [
  'diff --git a/src/app.ts b/src/app.ts',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1 +1 @@',
  '-export const x = 1',
  '+export const x = 2'
].join('\n')

describe('generateMergeCommitMessage', () => {
  test('invokes the agent with the diff and task title, returns the first line trimmed', async () => {
    const { deps, calls } = createFakeAgent(
      () => '  Tweak x to 2   \n\nExtra paragraph explaining things'
    )

    const message = await generateMergeCommitMessage(deps, {
      taskTitle: 'Bump x',
      diff: sampleDiff,
      worktreePath: '/tmp/wt'
    })

    expect(message).toEqual('Tweak x to 2')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.workingDirectory).toEqual('/tmp/wt')
    expect(calls[0]?.prompt).toContain('Bump x')
    expect(calls[0]?.prompt).toContain(sampleDiff)
  })

  test('returns null when the diff is empty', async () => {
    const { deps, calls } = createFakeAgent(() => 'should not be called')

    const message = await generateMergeCommitMessage(deps, {
      taskTitle: 'Nothing',
      diff: '   \n',
      worktreePath: '/tmp/wt'
    })

    expect(message).toBeNull()
    expect(calls).toHaveLength(0)
  })

  test('returns null when the agent throws', async () => {
    const { deps } = createFakeAgent(() => new Error('network boom'))

    const message = await generateMergeCommitMessage(deps, {
      taskTitle: 'Bump x',
      diff: sampleDiff,
      worktreePath: '/tmp/wt'
    })

    expect(message).toBeNull()
  })

  test('returns null when the agent returns an empty response', async () => {
    const { deps } = createFakeAgent(() => '   \n\n  ')

    const message = await generateMergeCommitMessage(deps, {
      taskTitle: 'Bump x',
      diff: sampleDiff,
      worktreePath: '/tmp/wt'
    })

    expect(message).toBeNull()
  })

  test('truncates overly long subjects to 72 characters', async () => {
    const long = 'a'.repeat(120)
    const { deps } = createFakeAgent(() => long)

    const message = await generateMergeCommitMessage(deps, {
      taskTitle: 'long one',
      diff: sampleDiff,
      worktreePath: '/tmp/wt'
    })

    expect(message).toEqual('a'.repeat(72))
  })

  test('strips a leading "Subject:" or markdown-quote prefix if the agent adds one', async () => {
    const { deps } = createFakeAgent(() => '> Subject: Fix the bug')

    const message = await generateMergeCommitMessage(deps, {
      taskTitle: 'Fix',
      diff: sampleDiff,
      worktreePath: '/tmp/wt'
    })

    expect(message).toEqual('Fix the bug')
  })

  test('truncates very large diffs before sending to the agent', async () => {
    const { deps, calls } = createFakeAgent(() => 'fine')
    const hugeDiff = 'x'.repeat(200_000)

    await generateMergeCommitMessage(deps, {
      taskTitle: 'Big',
      diff: hugeDiff,
      worktreePath: '/tmp/wt'
    })

    expect(calls[0]?.prompt.length).toBeLessThan(200_000)
    expect(calls[0]?.prompt).toContain('truncated')
  })
})
