import { Loader2 } from 'lucide-react'
import type { Thread, ThreadStatus } from '../hooks/use-thread'
import type { AgentState } from '../hooks/use-tasks'
import { cn } from '../lib/utils'

export type PillMode = 'idle' | 'running' | 'thinking' | 'waiting' | 'blocked' | 'done'

type PillMeta = {
  mode: PillMode
  label: string
  colorClass: string
  animated: boolean
  showSpinner: boolean
}

export function resolveThreadPill(
  thread: Thread | null,
  agentState: AgentState | null = null,
  overrideLabel?: string
): PillMeta {
  const meta = pillMetaFor(thread, agentState)

  return overrideLabel ? { ...meta, label: overrideLabel } : meta
}

function pillMetaFor(
  thread: Thread | null,
  agentState: AgentState | null
): PillMeta {
  const status: ThreadStatus | null = thread?.status ?? null

  if (status === 'error') {
    return {
      mode: 'blocked',
      label: 'Blocked',
      colorClass: 'state-red',
      animated: false,
      showSpinner: false
    }
  }

  if (status === 'starting') {
    return {
      mode: 'thinking',
      label: 'Thinking',
      colorClass: 'state-violet',
      animated: true,
      showSpinner: true
    }
  }

  if (status === 'running') {
    return {
      mode: 'running',
      label: 'Running',
      colorClass: 'state-amber',
      animated: true,
      showSpinner: true
    }
  }

  if (status === 'done' || agentState === 'done') {
    return {
      mode: 'done',
      label: 'Done',
      colorClass: 'state-green',
      animated: false,
      showSpinner: false
    }
  }

  if (agentState === 'working') {
    return {
      mode: 'running',
      label: 'Working',
      colorClass: 'state-amber',
      animated: true,
      showSpinner: true
    }
  }

  if (agentState === 'waiting_for_input') {
    return {
      mode: 'waiting',
      label: 'Needs you',
      colorClass: 'state-blue',
      animated: false,
      showSpinner: false
    }
  }

  return {
    mode: 'idle',
    label: 'Idle',
    colorClass: 'state-muted',
    animated: false,
    showSpinner: false
  }
}

interface StatePillProps {
  thread: Thread | null
  agentState?: AgentState | null
  label?: string
  className?: string
}

export function StatePill({
  thread,
  agentState = null,
  label,
  className
}: StatePillProps) {
  const meta = resolveThreadPill(thread, agentState, label)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]',
        meta.colorClass,
        className
      )}
      style={{
        color: 'var(--state-fg)',
        background: 'var(--state-bg)',
        borderColor: 'var(--state-border)'
      }}
      title={meta.label}
    >
      {meta.showSpinner ? (
        <Loader2
          aria-hidden='true'
          className='size-3 animate-spin'
        />
      ) : (
        <span
          aria-hidden='true'
          className={cn(
            'size-1.5 rounded-full',
            meta.animated && 'animate-banana-pulse'
          )}
          style={{ background: 'var(--state-fg)' }}
        />
      )}
      <span>{meta.label}</span>
    </span>
  )
}
