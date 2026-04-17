import type { Task } from '../hooks/use-tasks'
import type { Thread } from '../hooks/use-thread'
import { Button } from './ui/button'

export type AgentHeaderControlsProps = {
  task: Task
  thread: Thread | null
  providerConfigured: boolean
  onStartWork: () => void
  onMerge: () => void
  isStarting: boolean
  isMerging: boolean
}

export function AgentHeaderControls({
  task,
  thread,
  providerConfigured,
  onStartWork,
  onMerge,
  isStarting,
  isMerging
}: AgentHeaderControlsProps) {
  if (task.status === 'done') return null

  if (!thread) {
    return (
      <Button
        type='button'
        size='sm'
        onClick={onStartWork}
        disabled={!providerConfigured || isStarting}
      >
        {isStarting ? 'Starting…' : 'Start Work'}
      </Button>
    )
  }

  const threadBusy =
    thread.status === 'running' || thread.status === 'starting'
  const agentWorking = task.agentState === 'working'

  return (
    <Button
      type='button'
      size='sm'
      onClick={onMerge}
      disabled={threadBusy || agentWorking || isMerging}
    >
      {isMerging ? 'Merging…' : 'Merge to Main'}
    </Button>
  )
}
