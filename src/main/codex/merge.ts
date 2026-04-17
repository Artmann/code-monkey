import type { GitExecutor } from './worktree'

export type MergeDependencies = {
  git: GitExecutor
}

export type MergeTaskInput = {
  project: { directoryPath: string }
  thread: { worktreePath: string; branchName: string; baseBranch: string }
  taskTitle: string
}

export type MergeTaskResult = {
  mergeCommitSha: string | null
  autoCommitted: boolean
}

const assertOk = (
  result: { exitCode: number; stderr: string; stdout: string },
  label: string
) => {
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} failed: ${result.stderr.trim() || result.stdout.trim()}`
    )
  }
}

export const mergeTaskBranch = async (
  dependencies: MergeDependencies,
  { project, thread, taskTitle }: MergeTaskInput
): Promise<MergeTaskResult> => {
  const { git } = dependencies
  const worktreeCwd = thread.worktreePath
  const projectCwd = project.directoryPath

  const worktreeStatus = await git(['status', '--porcelain'], {
    cwd: worktreeCwd
  })

  assertOk(worktreeStatus, 'git status (worktree)')

  let autoCommitted = false

  if (worktreeStatus.stdout.trim() !== '') {
    const addResult = await git(['add', '-A'], { cwd: worktreeCwd })

    assertOk(addResult, 'git add')

    const commitResult = await git(
      ['commit', '-m', `Agent: ${taskTitle}`],
      { cwd: worktreeCwd }
    )

    assertOk(commitResult, 'git commit')

    autoCommitted = true
  }

  const headResult = await git(['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: projectCwd
  })

  assertOk(headResult, 'git rev-parse')

  const currentBranch = headResult.stdout.trim()

  if (currentBranch !== thread.baseBranch) {
    throw new Error(
      `Main clone is on branch "${currentBranch}"; merge expects "${thread.baseBranch}". Check out the base branch in your main clone and try again.`
    )
  }

  const mainStatus = await git(['status', '--porcelain'], { cwd: projectCwd })

  assertOk(mainStatus, 'git status (main clone)')

  if (mainStatus.stdout.trim() !== '') {
    throw new Error(
      `Main clone has uncommitted changes. Commit or stash them before merging "${thread.branchName}".`
    )
  }

  const mergeResult = await git(
    ['merge', '-m', `Merge: ${taskTitle}`, thread.branchName],
    { cwd: projectCwd }
  )

  if (mergeResult.exitCode !== 0) {
    await git(['merge', '--abort'], { cwd: projectCwd })

    throw new Error(
      `Merge failed: ${mergeResult.stderr.trim() || mergeResult.stdout.trim() || 'merge conflict'}`
    )
  }

  const mergedHead = await git(['rev-parse', 'HEAD'], { cwd: projectCwd })

  return {
    mergeCommitSha:
      mergedHead.exitCode === 0 ? mergedHead.stdout.trim() : null,
    autoCommitted
  }
}
