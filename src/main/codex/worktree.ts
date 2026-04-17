import { execFile } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path/posix'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type GitResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type GitExecutor = (
  gitArgs: readonly string[],
  options: { cwd: string }
) => Promise<GitResult>

export type WorktreeDependencies = {
  git: GitExecutor
  ensureDir: (path: string) => Promise<void>
  pathExists: (path: string) => Promise<boolean>
}

export type CreateWorktreeInput = {
  project: { id: string; directoryPath: string }
  task: { id: string }
}

export type CreatedWorktree = {
  path: string
  branch: string
  baseBranch: string
}

export type RemoveWorktreeInput = {
  project: { directoryPath: string }
  thread: { worktreePath: string; branchName: string }
  deleteBranch?: boolean
}

const originHeadPrefix = 'refs/remotes/origin/'

const shortId = (taskId: string) => taskId.slice(0, 8)

const worktreeParent = (projectDirectory: string) => {
  const parent = dirname(projectDirectory)
  const name = basename(projectDirectory)

  return join(parent, `${name}.worktrees`)
}

const worktreePathFor = (projectDirectory: string, taskId: string) =>
  join(worktreeParent(projectDirectory), `t_${shortId(taskId)}`)

const branchNameFor = (taskId: string) => `code-monkey/${taskId}`

const ensureInsideGitRepo = async (
  git: GitExecutor,
  cwd: string
): Promise<void> => {
  const result = await git(['rev-parse', '--is-inside-work-tree'], { cwd })

  if (result.exitCode !== 0 || result.stdout.trim() !== 'true') {
    throw new Error(
      `${cwd} is not a git repository. Initialize one with 'git init' and make at least one commit before starting work.`
    )
  }
}

const branchExists = async (
  git: GitExecutor,
  cwd: string,
  branch: string
): Promise<boolean> => {
  const result = await git(
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    { cwd }
  )

  return result.exitCode === 0
}

const resolveBaseBranch = async (
  git: GitExecutor,
  cwd: string
): Promise<string> => {
  const originHead = await git(['symbolic-ref', 'refs/remotes/origin/HEAD'], {
    cwd
  })

  if (originHead.exitCode === 0) {
    const trimmed = originHead.stdout.trim()

    if (trimmed.startsWith(originHeadPrefix)) {
      return trimmed.slice(originHeadPrefix.length)
    }
  }

  if (await branchExists(git, cwd, 'main')) {
    return 'main'
  }

  if (await branchExists(git, cwd, 'master')) {
    return 'master'
  }

  throw new Error(
    `Could not determine a base branch (tried origin/HEAD, main, master) in ${cwd}.`
  )
}

export const createWorktree = async (
  dependencies: WorktreeDependencies,
  { project, task }: CreateWorktreeInput
): Promise<CreatedWorktree> => {
  const { git, ensureDir, pathExists } = dependencies
  const cwd = project.directoryPath

  await ensureInsideGitRepo(git, cwd)

  const baseBranch = await resolveBaseBranch(git, cwd)
  const branch = branchNameFor(task.id)
  const path = worktreePathFor(cwd, task.id)

  if (await branchExists(git, cwd, branch)) {
    throw new Error(
      `Branch already exists: ${branch}. Delete it with \`git branch -D ${branch}\` or clean up the prior worktree before starting.`
    )
  }

  if (await pathExists(path)) {
    throw new Error(
      `Worktree path already exists: ${path}. Remove it before starting work on this task.`
    )
  }

  await ensureDir(worktreeParent(cwd))

  const addResult = await git(
    ['worktree', 'add', '-b', branch, path, baseBranch],
    { cwd }
  )

  if (addResult.exitCode !== 0) {
    throw new Error(
      `git worktree add failed: ${addResult.stderr.trim() || addResult.stdout.trim()}`
    )
  }

  return { path, branch, baseBranch }
}

export const removeWorktree = async (
  dependencies: WorktreeDependencies,
  { project, thread, deleteBranch = false }: RemoveWorktreeInput
): Promise<void> => {
  const { git } = dependencies
  const cwd = project.directoryPath

  const removeResult = await git(
    ['worktree', 'remove', '--force', thread.worktreePath],
    { cwd }
  )

  if (removeResult.exitCode !== 0) {
    throw new Error(
      `git worktree remove failed: ${removeResult.stderr.trim() || removeResult.stdout.trim()}`
    )
  }

  if (!deleteBranch) return

  const branchResult = await git(['branch', '-D', thread.branchName], {
    cwd
  })

  if (branchResult.exitCode !== 0) {
    throw new Error(
      `git branch -D failed: ${branchResult.stderr.trim() || branchResult.stdout.trim()}`
    )
  }
}

export const createNodeGitExecutor =
  (): GitExecutor =>
  async (gitArgs, { cwd }) => {
    try {
      const { stdout, stderr } = await execFileAsync('git', [...gitArgs], {
        cwd,
        maxBuffer: 16 * 1024 * 1024
      })

      return { stdout, stderr, exitCode: 0 }
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string
        stderr?: string
        code?: number | string
      }

      return {
        stdout: execError.stdout ?? '',
        stderr: execError.stderr ?? execError.message,
        exitCode: typeof execError.code === 'number' ? execError.code : 1
      }
    }
  }

export const createNodeFsDependencies = (): Pick<
  WorktreeDependencies,
  'ensureDir' | 'pathExists'
> => ({
  ensureDir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  pathExists: async (path) => {
    try {
      await stat(path)

      return true
    } catch {
      return false
    }
  }
})
