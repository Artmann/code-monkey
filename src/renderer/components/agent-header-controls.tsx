import { MessageSquarePlus } from 'lucide-react'

import type { Task } from '../hooks/use-tasks'
import type { Thread } from '../hooks/use-thread'
import { Button } from './ui/button'

export type AgentHeaderControlsProps = {
  task: Task
  thread: Thread | null
  providerConfigured: boolean
  onStartWork: () => void
  onRestartChat: () => void
  onMerge: () => void
  isStarting: boolean
  isRestarting: boolean
  isMerging: boolean
}

export function AgentHeaderControls({
  task,
  thread,
  providerConfigured,
  onStartWork,
  onRestartChat,
  onMerge,
  isStarting,
  isRestarting,
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
    <>
      <Button
        type='button'
        size='sm'
        variant='outline'
        onClick={onRestartChat}
        disabled={!providerConfigured || isRestarting}
        aria-label='Start new chat'
      >
        <MessageSquarePlus
          aria-hidden='true'
          className='size-3.5'
        />
        {isRestarting ? 'Starting…' : 'New chat'}
      </Button>

      <Button
        type='button'
        size='sm'
        onClick={onMerge}
        disabled={threadBusy || agentWorking || isMerging}
      >
        {isMerging ? 'Merging…' : 'Merge to Main'}
      </Button>
    </>
  )
}
