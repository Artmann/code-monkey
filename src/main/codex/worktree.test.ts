import { describe, expect, test } from 'vitest'

import {
  createWorktree,
  removeWorktree,
  type GitExecutor,
  type GitResult,
  type WorktreeDependencies
} from './worktree'

type Call = { args: readonly string[]; cwd: string }

type Responder = (call: Call) => GitResult | Promise<GitResult>

const ok = (stdout = ''): GitResult => ({
  stdout,
  stderr: '',
  exitCode: 0
})

const fail = (stderr = '', exitCode = 128): GitResult => ({
  stdout: '',
  stderr,
  exitCode
})

const createFakeGit = (responder: Responder) => {
  const calls: Call[] = []

  const git: GitExecutor = async (args, options) => {
    const call: Call = { args: [...args], cwd: options.cwd }

    calls.push(call)

    return responder(call)
  }

  return { git, calls }
}

const worktreesRoot = '/home/u/.code-monkey/worktrees'
const taskId = 'e0b97cd3-1234-5678-9abc-def012345678'
const expectedBranch = `code-monkey/${taskId}`
const expectedDirName = `code-monkey-${taskId}`
const expectedPath = `/home/u/.code-monkey/worktrees/my-app/${expectedDirName}`

const createFakeFs = () => {
  const ensured: string[] = []
  const existing = new Set<string>()
  const links: Array<{ from: string; to: string }> = []

  const deps: Omit<WorktreeDependencies, 'git'> = {
    worktreesRoot,
    ensureDir: async (path) => {
      ensured.push(path)
      existing.add(path)
    },
    pathExists: async (path) => existing.has(path),
    linkNodeModules: async (from, to) => {
      links.push({ from, to })
    }
  }

  return { deps, ensured, existing, links }
}

const project = { id: 'proj-1', directoryPath: '/home/u/Code/my-app' }
const task = { id: taskId }

describe('createWorktree', () => {
  test('resolves base branch via origin/HEAD and runs the right git commands', async () => {
    const { git, calls } = createFakeGit((call) => {
      const joined = call.args.join(' ')

      if (joined === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (joined === 'symbolic-ref refs/remotes/origin/HEAD')
        return ok('refs/remotes/origin/main\n')
      if (joined.startsWith('show-ref --verify --quiet')) return fail('', 1)
      if (joined.startsWith('worktree add')) return ok()

      throw new Error(`unexpected git call: ${joined}`)
    })
    const fs = createFakeFs()

    const result = await createWorktree(
      { git, ...fs.deps },
      { project, task }
    )

    expect(result).toEqual({
      path: expectedPath,
      branch: expectedBranch,
      baseBranch: 'main'
    })

    expect(fs.ensured).toEqual(['/home/u/.code-monkey/worktrees/my-app'])

    expect(calls.map((call) => call.args.join(' '))).toEqual([
      'rev-parse --is-inside-work-tree',
      'symbolic-ref refs/remotes/origin/HEAD',
      `show-ref --verify --quiet refs/heads/${expectedBranch}`,
      `worktree add -b ${expectedBranch} ${expectedPath} main`
    ])

    expect(calls.every((call) => call.cwd === project.directoryPath)).toBe(
      true
    )
  })

  test('links the project node_modules into the worktree when present', async () => {
    const { git } = createFakeGit((call) => {
      const joined = call.args.join(' ')

      if (joined === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (joined === 'symbolic-ref refs/remotes/origin/HEAD')
        return ok('refs/remotes/origin/main\n')
      if (joined.startsWith('show-ref --verify --quiet')) return fail('', 1)
      if (joined.startsWith('worktree add')) return ok()

      throw new Error(`unexpected git call: ${joined}`)
    })
    const fs = createFakeFs()

    fs.existing.add('/home/u/Code/my-app/node_modules')

    await createWorktree({ git, ...fs.deps }, { project, task })

    expect(fs.links).toEqual([
      {
        from: '/home/u/Code/my-app/node_modules',
        to: `${expectedPath}/node_modules`
      }
    ])
  })

  test('does not link node_modules when the project has none', async () => {
    const { git } = createFakeGit((call) => {
      const joined = call.args.join(' ')

      if (joined === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (joined === 'symbolic-ref refs/remotes/origin/HEAD')
        return ok('refs/remotes/origin/main\n')
      if (joined.startsWith('show-ref --verify --quiet')) return fail('', 1)
      if (joined.startsWith('worktree add')) return ok()

      throw new Error(`unexpected git call: ${joined}`)
    })
    const fs = createFakeFs()

    await createWorktree({ git, ...fs.deps }, { project, task })

    expect(fs.links).toEqual([])
  })

  test('falls back to `main` when symbolic-ref fails', async () => {
    const { git } = createFakeGit((call) => {
      const joined = call.args.join(' ')

      if (joined === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (joined === 'symbolic-ref refs/remotes/origin/HEAD')
        return fail('fatal: no HEAD', 128)
      if (joined === 'show-ref --verify --quiet refs/heads/main') return ok()
      if (joined.startsWith('show-ref --verify --quiet refs/heads/code-monkey'))
        return fail('', 1)
      if (joined.startsWith('worktree add')) return ok()

      throw new Error(`unexpected git call: ${joined}`)
    })
    const fs = createFakeFs()

    const result = await createWorktree(
      { git, ...fs.deps },
      { project, task }
    )

    expect(result.baseBranch).toEqual('main')
  })

  test('falls back to `master` when neither origin/HEAD nor main exists', async () => {
    const { git } = createFakeGit((call) => {
      const joined = call.args.join(' ')

      if (joined === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (joined === 'symbolic-ref refs/remotes/origin/HEAD')
        return fail('', 128)
      if (joined === 'show-ref --verify --quiet refs/heads/main')
        return fail('', 1)
      if (joined === 'show-ref --verify --quiet refs/heads/master') return ok()
      if (joined.startsWith('show-ref --verify --quiet refs/heads/code-monkey'))
        return fail('', 1)
      if (joined.startsWith('worktree add')) return ok()

      throw new Error(`unexpected git call: ${joined}`)
    })
    const fs = createFakeFs()

    const result = await createWorktree(
      { git, ...fs.deps },
      { project, task }
    )

    expect(result.baseBranch).toEqual('master')
  })

  test('throws when the project is not a git repo', async () => {
    const { git } = createFakeGit(() => fail('not a git repo', 128))
    const fs = createFakeFs()

    await expect(
      createWorktree({ git, ...fs.deps }, { project, task })
    ).rejects.toThrow(/not a git repository/i)
  })

  test('throws when the task branch already exists', async () => {
    const { git } = createFakeGit((call) => {
      const joined = call.args.join(' ')

      if (joined === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (joined === 'symbolic-ref refs/remotes/origin/HEAD')
        return ok('refs/remotes/origin/main\n')
      if (joined.startsWith('show-ref --verify --quiet refs/heads/code-monkey'))
        return ok()

      throw new Error(`unexpected git call: ${joined}`)
    })
    const fs = createFakeFs()

    await expect(
      createWorktree({ git, ...fs.deps }, { project, task })
    ).rejects.toThrow(/branch already exists/i)
  })

  test('throws when the worktree path already exists', async () => {
    const { git } = createFakeGit((call) => {
      const joined = call.args.join(' ')

      if (joined === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (joined === 'symbolic-ref refs/remotes/origin/HEAD')
        return ok('refs/remotes/origin/main\n')
      if (joined.startsWith('show-ref --verify --quiet')) return fail('', 1)

      throw new Error(`unexpected git call: ${joined}`)
    })
    const fs = createFakeFs()

    fs.existing.add(expectedPath)

    await expect(
      createWorktree({ git, ...fs.deps }, { project, task })
    ).rejects.toThrow(/already exists/i)
  })

  test('falls back to "main" as the base branch when symbolic-ref prints a non-ref', async () => {
    const { git } = createFakeGit((call) => {
      const joined = call.args.join(' ')

      if (joined === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (joined === 'symbolic-ref refs/remotes/origin/HEAD')
        return ok('garbage\n')
      if (joined === 'show-ref --verify --quiet refs/heads/main') return ok()
      if (joined.startsWith('show-ref --verify --quiet refs/heads/code-monkey'))
        return fail('', 1)
      if (joined.startsWith('worktree add')) return ok()

      throw new Error(`unexpected git call: ${joined}`)
    })
    const fs = createFakeFs()

    const result = await createWorktree(
      { git, ...fs.deps },
      { project, task }
    )

    expect(result.baseBranch).toEqual('main')
  })
})

describe('removeWorktree', () => {
  test('runs `git worktree remove --force` at the project directory', async () => {
    const { git, calls } = createFakeGit(() => ok())
    const fs = createFakeFs()

    await removeWorktree(
      { git, ...fs.deps },
      {
        project,
        thread: {
          worktreePath: expectedPath,
          branchName: expectedBranch
        }
      }
    )

    expect(calls.map((call) => call.args.join(' '))).toEqual([
      `worktree remove --force ${expectedPath}`
    ])
    expect(calls.at(0)?.cwd).toEqual(project.directoryPath)
  })

  test('deletes the branch when deleteBranch is true', async () => {
    const { git, calls } = createFakeGit(() => ok())
    const fs = createFakeFs()

    await removeWorktree(
      { git, ...fs.deps },
      {
        project,
        thread: {
          worktreePath: expectedPath,
          branchName: expectedBranch
        },
        deleteBranch: true
      }
    )

    expect(calls.map((call) => call.args.join(' '))).toEqual([
      `worktree remove --force ${expectedPath}`,
      `branch -D ${expectedBranch}`
    ])
  })
})
