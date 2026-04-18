import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api-client'
import { taskThreadsKey } from './use-thread'

export const taskStatusValues = ['in_progress', 'todo', 'done'] as const
export type TaskStatus = (typeof taskStatusValues)[number]

export const agentStateValues = [
  'idle',
  'waiting_for_input',
  'working',
  'done'
] as const
export type AgentState = (typeof agentStateValues)[number]

export interface Task {
  id: string
  projectId: string
  title: string
  description: string | null
  status: TaskStatus
  agentState: AgentState
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface ReorderUpdate {
  id: string
  status: TaskStatus
  sortOrder: number
}

interface TasksResponse {
  tasks: Task[]
}

interface TaskResponse {
  task: Task
}

export interface CreateTaskInput {
  projectId: string
  title: string
  description?: string | null
  status?: TaskStatus
  agentState?: AgentState
}

export interface UpdateTaskInput {
  id: string
  title?: string
  description?: string | null
  status?: TaskStatus
  agentState?: AgentState
}

function tasksKey(projectId: string) {
  return ['tasks', projectId] as const
}

export function useTasksQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: tasksKey(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) {
        return []
      }

      const data = await apiFetch<TasksResponse>(
        `/tasks?projectId=${encodeURIComponent(projectId)}`
      )

      return data.tasks
    }
  })
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const data = await apiFetch<TaskResponse>('/tasks', {
        method: 'POST',
        body: JSON.stringify(input)
      })

      return data.task
    },
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: tasksKey(task.projectId) })
    }
  })
}

export function useUpdateTaskMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateTaskInput) => {
      const data = await apiFetch<TaskResponse>(`/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      })

      return data.task
    },
    onSuccess: (task, variables) => {
      void queryClient.invalidateQueries({ queryKey: tasksKey(task.projectId) })

      if (variables.status === 'in_progress') {
        void queryClient.invalidateQueries({
          queryKey: taskThreadsKey(task.id)
        })
      }
    }
  })
}

export function useReorderTasksMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      projectId: string
      updates: ReorderUpdate[]
    }) => {
      const data = await apiFetch<TasksResponse>('/tasks/reorder', {
        method: 'POST',
        body: JSON.stringify(input)
      })

      return data.tasks
    },
    onMutate: async ({ projectId, updates }) => {
      await queryClient.cancelQueries({ queryKey: tasksKey(projectId) })

      const previous = queryClient.getQueryData<Task[]>(tasksKey(projectId))

      if (previous) {
        const updateById = new Map(updates.map((update) => [update.id, update]))

        const next = previous.map((task) => {
          const patch = updateById.get(task.id)

          if (!patch) {
            return task
          }

          return { ...task, status: patch.status, sortOrder: patch.sortOrder }
        })

        queryClient.setQueryData(tasksKey(projectId), next)
      }

      return { previous }
    },
    onError: (_error, { projectId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tasksKey(projectId), context.previous)
      }
    },
    onSettled: (_data, _error, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: tasksKey(projectId) })
    }
  })
}
