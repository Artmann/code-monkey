import {
  CircleCheck,
  CircleDashed,
  Circle,
  type LucideIcon
} from 'lucide-react'
import type { TaskStatus } from '../hooks/use-tasks'

export interface StatusMeta {
  value: TaskStatus
  label: string
  icon: LucideIcon
  iconClassName: string
}

export const statusOrder: TaskStatus[] = ['in_progress', 'todo', 'done']

const statusTable: Record<TaskStatus, StatusMeta> = {
  in_progress: {
    value: 'in_progress',
    label: 'In progress',
    icon: CircleDashed,
    iconClassName: 'text-[color:var(--ctp-peach)]'
  },
  todo: {
    value: 'todo',
    label: 'Todo',
    icon: Circle,
    iconClassName: 'text-muted-foreground'
  },
  done: {
    value: 'done',
    label: 'Done',
    icon: CircleCheck,
    iconClassName: 'text-[color:var(--ctp-green)]'
  }
}

export function getStatusMeta(status: TaskStatus): StatusMeta {
  return statusTable[status]
}
