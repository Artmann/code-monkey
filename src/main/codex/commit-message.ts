export type GenerateMergeCommitMessageInput = {
  taskTitle: string
  diff: string
  worktreePath: string
}

export type GenerateMergeCommitMessageDependencies = {
  runAgent: (input: {
    prompt: string
    workingDirectory: string
  }) => Promise<string>
}

const maxSubjectLength = 72

const maxDiffCharacters = 60_000

const cleanSubject = (raw: string): string | null => {
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim() !== '')

  if (firstLine == null) return null

  let subject = firstLine.trim()

  subject = subject.replace(/^[>\-*]\s*/, '')
  subject = subject.replace(/^(?:subject|commit(?: message)?)\s*:\s*/i, '')
  subject = subject.replace(/^["'`]+|["'`]+$/g, '')

  if (subject === '') return null

  if (subject.length > maxSubjectLength) {
    return subject.slice(0, maxSubjectLength)
  }

  return subject
}

const truncateDiff = (diff: string): { diff: string; truncated: boolean } => {
  if (diff.length <= maxDiffCharacters) return { diff, truncated: false }

  return {
    diff: diff.slice(0, maxDiffCharacters),
    truncated: true
  }
}

const buildPrompt = (input: GenerateMergeCommitMessageInput): string => {
  const { diff, truncated } = truncateDiff(input.diff)
  const suffix = truncated
    ? '\n\n(diff truncated for brevity)'
    : ''

  return [
    'You are writing a git commit subject line for a merge commit.',
    '',
    `Task title: ${input.taskTitle}`,
    '',
    'Summarize the following diff as a single concise imperative sentence.',
    'Respond with ONLY the subject line — no preamble, no quoting, no trailing period,',
    `no more than ${maxSubjectLength} characters.`,
    '',
    '```diff',
    diff + suffix,
    '```'
  ].join('\n')
}

export const generateMergeCommitMessage = async (
  deps: GenerateMergeCommitMessageDependencies,
  input: GenerateMergeCommitMessageInput
): Promise<string | null> => {
  if (input.diff.trim() === '') return null

  const prompt = buildPrompt(input)

  let raw: string

  try {
    raw = await deps.runAgent({
      prompt,
      workingDirectory: input.worktreePath
    })
  } catch {
    return null
  }

  return cleanSubject(raw)
}
