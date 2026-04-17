import { describe, expect, test } from 'vitest'

import { mergeTaskBranch, type MergeDependencies } from './merge'
import type { GitExecutor, GitResult } from './worktree'

type Call = { args: readonly string[]; cwd: string }

const ok = (stdout = ''): GitResult => ({
  stdout,
  stderr: '',
  exitCode: 0
})

const fail = (stderr = '', exitCode = 1): GitResult => ({
  stdout: '',
  stderr,
  exitCode
})

const createFakeGit = (
  responder: (call: Call) => GitResult | Promise<GitResult>
) => {
  const calls: Call[] = []

  const git: GitExecutor = async (args, options) => {
    const call: Call = { args: [...args], cwd: options.cwd }

    calls.push(call)

    return responder(call)
  }

  return { git, calls }
}

const project = { directoryPath: '/home/u/Code/my-app' }
const thread = {
  worktreePath: '/home/u/.code-monkey/worktrees/my-app/code-monkey-abc',
  branchName: 'code-monkey/abc',
  baseBranch: 'main'
}
const taskTitle = 'Fix the bug'

const deps = (git: GitExecutor): MergeDependencies => ({ git })

describe('mergeTaskBranch', () => {
  test('merges a clean worktree into a clean main clone on the base branch', async () => {
    const { git, calls } = createFakeGit((call) => {
      const key = `${call.cwd}::${call.args.join(' ')}`

      if (
        key === `${thread.worktreePath}::status --porcelain` ||
        key === `${project.directoryPath}::status --porcelain`
      ) {
        return ok('')
      }
      if (
        key ===
        `${project.directoryPath}::rev-parse --abbrev-ref HEAD`
      ) {
        return ok('main\n')
      }
      if (
        key ===
        `${project.directoryPath}::merge -m Merge: ${taskTitle} ${thread.branchName}`
      ) {
        return ok('Merge made.')
      }
      if (key === `${project.directoryPath}::rev-parse HEAD`) {
        return ok('deadbeef\n')
      }

      throw new Error(`unexpected git call: ${key}`)
    })

    const result = await mergeTaskBranch(deps(git), {
      project,
      thread,
      taskTitle
    })

    expect(result).toEqual({
      mergeCommitSha: 'deadbeef',
      autoCommitted: false
    })

    expect(calls.map((call) => call.args.join(' '))).toEqual([
      'status --porcelain',
      'rev-parse --abbrev-ref HEAD',
      'status --porcelain',
      `merge -m Merge: ${taskTitle} ${thread.branchName}`,
      'rev-parse HEAD'
    ])
  })

  test('auto-commits dirty worktree files before merging', async () => {
    const committed: Call[] = []

    const { git } = createFakeGit((call) => {
      const key = `${call.cwd}::${call.args.join(' ')}`

      if (key === `${thread.worktreePath}::status --porcelain`)
        return ok(' M src/foo.ts\n')
      if (key === `${thread.worktreePath}::add -A`) {
        committed.push(call)

        return ok('')
      }
      if (
        key.startsWith(`${thread.worktreePath}::commit -m`)
      ) {
        committed.push(call)

        return ok('')
      }
      if (key === `${project.directoryPath}::status --porcelain`) return ok('')
      if (
        key === `${project.directoryPath}::rev-parse --abbrev-ref HEAD`
      )
        return ok('main\n')
      if (
        key ===
        `${project.directoryPath}::merge -m Merge: ${taskTitle} ${thread.branchName}`
      )
        return ok('')
      if (key === `${project.directoryPath}::rev-parse HEAD`)
        return ok('beef0001\n')

      throw new Error(`unexpected git call: ${key}`)
    })

    const result = await mergeTaskBranch(deps(git), {
      project,
      thread,
      taskTitle
    })

    expect(result.autoCommitted).toEqual(true)
    expect(committed.map((call) => call.args.join(' '))).toEqual([
      'add -A',
      `commit -m Agent: ${taskTitle}`
    ])
  })

  test('refuses to merge when the main clone is not on the base branch', async () => {
    const { git } = createFakeGit((call) => {
      const key = `${call.cwd}::${call.args.join(' ')}`

      if (key === `${thread.worktreePath}::status --porcelain`) return ok('')
      if (
        key === `${project.directoryPath}::rev-parse --abbrev-ref HEAD`
      )
        return ok('feature/other\n')

      throw new Error(`unexpected git call: ${key}`)
    })

    await expect(
      mergeTaskBranch(deps(git), { project, thread, taskTitle })
    ).rejects.toThrow(/on branch "feature\/other".*expects "main"/i)
  })

  test('refuses to merge when the main clone has uncommitted changes', async () => {
    const { git } = createFakeGit((call) => {
      const key = `${call.cwd}::${call.args.join(' ')}`

      if (key === `${thread.worktreePath}::status --porcelain`) return ok('')
      if (
        key === `${project.directoryPath}::rev-parse --abbrev-ref HEAD`
      )
        return ok('main\n')
      if (key === `${project.directoryPath}::status --porcelain`)
        return ok(' M src/bar.ts\n')

      throw new Error(`unexpected git call: ${key}`)
    })

    await expect(
      mergeTaskBranch(deps(git), { project, thread, taskTitle })
    ).rejects.toThrow(/uncommitted changes/i)
  })

  test('aborts and surfaces the error when merge fails', async () => {
    const aborted: Call[] = []

    const { git } = createFakeGit((call) => {
      const key = `${call.cwd}::${call.args.join(' ')}`

      if (key === `${thread.worktreePath}::status --porcelain`) return ok('')
      if (
        key === `${project.directoryPath}::rev-parse --abbrev-ref HEAD`
      )
        return ok('main\n')
      if (key === `${project.directoryPath}::status --porcelain`) return ok('')
      if (
        key ===
        `${project.directoryPath}::merge -m Merge: ${taskTitle} ${thread.branchName}`
      ) {
        return fail('CONFLICT (content): merge conflict in src/x.ts', 1)
      }
      if (key === `${project.directoryPath}::merge --abort`) {
        aborted.push(call)

        return ok('')
      }

      throw new Error(`unexpected git call: ${key}`)
    })

    await expect(
      mergeTaskBranch(deps(git), { project, thread, taskTitle })
    ).rejects.toThrow(/conflict|merge failed/i)

    expect(aborted).toHaveLength(1)
  })

  test('uses a generated commit message when generateMessage is provided and succeeds', async () => {
    const generatorCalls: Array<{
      taskTitle: string
      diff: string
      worktreePath: string
    }> = []
    const generatedSubject = 'Tweak x to 2'
    const diffOutput = 'diff --git a/x b/x\n+changed'

    const { git, calls } = createFakeGit((call) => {
      const key = `${call.cwd}::${call.args.join(' ')}`

      if (
        key === `${thread.worktreePath}::status --porcelain` ||
        key === `${project.directoryPath}::status --porcelain`
      )
        return ok('')
      if (key === `${project.directoryPath}::rev-parse --abbrev-ref HEAD`)
        return ok('main\n')
      if (
        key ===
        `${project.directoryPath}::diff ${thread.baseBranch}...${thread.branchName}`
      )
        return ok(diffOutput)
      if (
        key ===
        `${project.directoryPath}::merge -m ${generatedSubject} ${thread.branchName}`
      )
        return ok('Merge made.')
      if (key === `${project.directoryPath}::rev-parse HEAD`)
        return ok('cafef00d\n')

      throw new Error(`unexpected git call: ${key}`)
    })

    const result = await mergeTaskBranch(
      {
        git,
        generateMessage: async (input) => {
          generatorCalls.push(input)

          return generatedSubject
        }
      },
      { project, thread, taskTitle }
    )

    expect(result.mergeCommitSha).toEqual('cafef00d')
    expect(generatorCalls).toEqual([
      { taskTitle, diff: diffOutput, worktreePath: thread.worktreePath }
    ])
    expect(calls.map((call) => call.args.join(' '))).toContain(
      `merge -m ${generatedSubject} ${thread.branchName}`
    )
  })

  test('falls back to "Merge: <taskTitle>" when generateMessage returns null', async () => {
    let generateCalls = 0

    const { git, calls } = createFakeGit((call) => {
      const key = `${call.cwd}::${call.args.join(' ')}`

      if (
        key === `${thread.worktreePath}::status --porcelain` ||
        key === `${project.directoryPath}::status --porcelain`
      )
        return ok('')
      if (key === `${project.directoryPath}::rev-parse --abbrev-ref HEAD`)
        return ok('main\n')
      if (
        key ===
        `${project.directoryPath}::diff ${thread.baseBranch}...${thread.branchName}`
      )
        return ok('some diff')
      if (
        key ===
        `${project.directoryPath}::merge -m Merge: ${taskTitle} ${thread.branchName}`
      )
        return ok('Merge made.')
      if (key === `${project.directoryPath}::rev-parse HEAD`)
        return ok('f00dcafe\n')

      throw new Error(`unexpected git call: ${key}`)
    })

    const result = await mergeTaskBranch(
      {
        git,
        generateMessage: async () => {
          generateCalls++

          return null
        }
      },
      { project, thread, taskTitle }
    )

    expect(generateCalls).toEqual(1)
    expect(result.mergeCommitSha).toEqual('f00dcafe')
    expect(calls.map((call) => call.args.join(' '))).toContain(
      `merge -m Merge: ${taskTitle} ${thread.branchName}`
    )
  })
})
