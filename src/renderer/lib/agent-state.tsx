import {
  CheckCheck,
  CircleDot,
  Hourglass,
  Loader2,
  type LucideIcon
} from 'lucide-react'
import type { AgentState } from '../hooks/use-tasks'

export interface AgentStateMeta {
  value: AgentState
  label: string
  icon: LucideIcon
  iconClassName: string
  badgeClassName: string
  highlightRow: boolean
  animate: boolean
}

export const agentStateOrder: AgentState[] = [
  'idle',
  'working',
  'waiting_for_input',
  'done'
]

const agentStateTable: Record<AgentState, AgentStateMeta> = {
  idle: {
    value: 'idle',
    label: 'Idle',
    icon: CircleDot,
    iconClassName: 'text-muted-foreground',
    badgeClassName: 'bg-muted text-muted-foreground',
    highlightRow: false,
    animate: false
  },
  waiting_for_input: {
    value: 'waiting_for_input',
    label: 'Waiting for input',
    icon: Hourglass,
    iconClassName: 'text-amber-500',
    badgeClassName: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    highlightRow: true,
    animate: false
  },
  working: {
    value: 'working',
    label: 'Working',
    icon: Loader2,
    iconClassName: 'text-sky-500',
    badgeClassName: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    highlightRow: false,
    animate: true
  },
  done: {
    value: 'done',
    label: 'Done',
    icon: CheckCheck,
    iconClassName: 'text-emerald-500',
    badgeClassName: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    highlightRow: false,
    animate: false
  }
}

export function getAgentStateMeta(state: AgentState): AgentStateMeta {
  return agentStateTable[state]
}
