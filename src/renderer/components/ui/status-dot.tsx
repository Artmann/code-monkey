import type { AgentState, TaskStatus } from '../../hooks/use-tasks'
import type { ThreadStatus } from '../../hooks/use-thread'
import { cn } from '../../lib/utils'

export type StatusKey = 'idle' | 'running' | 'done' | 'blocked'

interface StatusDotProps {
  status: StatusKey
  size?: number
  className?: string
  ariaLabel?: string
}

const colorByStatus: Record<StatusKey, string> = {
  idle: 'text-[color:var(--st-idle)]',
  running: 'text-[color:var(--st-running)]',
  done: 'text-[color:var(--st-done)]',
  blocked: 'text-[color:var(--st-blocked)]'
}

const labelByStatus: Record<StatusKey, string> = {
  idle: 'Todo',
  running: 'Running',
  done: 'Done',
  blocked: 'Blocked'
}

export function StatusDot({
  ariaLabel,
  className,
  size = 14,
  status
}: StatusDotProps) {
  const label = ariaLabel ?? labelByStatus[status]

  if (status === 'running') {
    return (
      <span
        aria-label={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          colorByStatus.running,
          className
        )}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox='0 0 16 16'
          width={size}
          height={size}
        >
          <circle
            cx='8'
            cy='8'
            r='6.5'
            fill='none'
            stroke='currentColor'
            strokeWidth='1.4'
            strokeDasharray='3 2'
            className='animate-status-spin'
            style={{ transformOrigin: '8px 8px' }}
          />
          <circle
            cx='8'
            cy='8'
            r='2.5'
            fill='currentColor'
          />
        </svg>
      </span>
    )
  }

  if (status === 'done') {
    return (
      <span
        aria-label={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          colorByStatus.done,
          className
        )}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox='0 0 16 16'
          width={size}
          height={size}
        >
          <circle
            cx='8'
            cy='8'
            r='7'
            fill='currentColor'
          />
          <path
            d='m5 8 2.2 2.2L11 6'
            stroke='white'
            strokeWidth='1.6'
            fill='none'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      </span>
    )
  }

  if (status === 'blocked') {
    return (
      <span
        aria-label={label}
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          colorByStatus.blocked,
          className
        )}
        style={{ width: size, height: size }}
      >
        <svg
          viewBox='0 0 16 16'
          width={size}
          height={size}
        >
          <circle
            cx='8'
            cy='8'
            r='7'
            fill='currentColor'
          />
          <path
            d='M5 8h6'
            stroke='white'
            strokeWidth='1.6'
          />
        </svg>
      </span>
    )
  }

  return (
    <span
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        colorByStatus.idle,
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox='0 0 16 16'
        width={size}
        height={size}
      >
        <circle
          cx='8'
          cy='8'
          r='6.5'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.4'
        />
      </svg>
    </span>
  )
}

export function statusFromTaskStatus(status: TaskStatus): StatusKey {
  if (status === 'in_progress') {
    return 'running'
  }

  if (status === 'done') {
    return 'done'
  }

  return 'idle'
}

export function statusFromAgentState(state: AgentState): StatusKey {
  if (state === 'working') {
    return 'running'
  }

  if (state === 'done') {
    return 'done'
  }

  if (state === 'waiting_for_input') {
    return 'blocked'
  }

  return 'idle'
}

export function statusFromThreadStatus(status: ThreadStatus): StatusKey {
  if (status === 'running' || status === 'starting') {
    return 'running'
  }

  if (status === 'error') {
    return 'blocked'
  }

  if (status === 'done') {
    return 'done'
  }

  return 'idle'
}
