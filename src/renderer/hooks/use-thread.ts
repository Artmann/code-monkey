import {
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'
import { useEffect } from 'react'

import { apiFetch, getApiBaseUrl } from '../lib/api-client'

export type ThreadStatus =
  | 'starting'
  | 'running'
  | 'idle'
  | 'done'
  | 'error'

export type Thread = {
  id: string
  taskId: string | null
  projectId: string | null
  codexThreadId: string | null
  worktreePath: string | null
  branchName: string | null
  baseBranch: string | null
  status: ThreadStatus
  errorMessage: string | null
  createdAt: string
  lastActivityAt: string
}

export type ThreadEvent = {
  id: string
  threadId: string
  sequence: number
  type: string
  payload: unknown
  createdAt: string
}

export type ThreadResponse = {
  thread: Thread
  events: ThreadEvent[]
}

export const threadKey = (threadId: string) =>
  ['thread', threadId] as const

export const taskThreadsKey = (taskId: string) =>
  ['tasks', taskId, 'threads'] as const

export const projectThreadsKey = (projectId: string) =>
  ['projects', projectId, 'threads'] as const

const SUBSCRIBED_EVENT_TYPES = [
  'prep',
  'thread.started',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'item.started',
  'item.updated',
  'item.completed',
  'user_message',
  'error'
] as const

export function useTaskThreadsQuery(taskId: string | null | undefined) {
  return useQuery({
    queryKey: taskThreadsKey(taskId ?? ''),
    enabled: Boolean(taskId),
    queryFn: async () => {
      if (!taskId) return []

      const data = await apiFetch<{ threads: Thread[] }>(
        `/tasks/${taskId}/threads`
      )

      return data.threads
    }
  })
}

export function useProjectThreadsQuery(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectThreadsKey(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!projectId) return []

      const data = await apiFetch<{ threads: Thread[] }>(
        `/projects/${projectId}/threads`
      )

      return data.threads
    }
  })
}

export function useThreadQuery(threadId: string | null | undefined) {
  return useQuery({
    queryKey: threadKey(threadId ?? ''),
    enabled: Boolean(threadId),
    queryFn: async () => {
      if (!threadId) return null

      return apiFetch<ThreadResponse>(`/threads/${threadId}`)
    }
  })
}

const appendEvent = (
  previous: ThreadResponse | null | undefined,
  event: ThreadEvent
): ThreadResponse | null | undefined => {
  if (!previous) return previous

  if (previous.events.some((entry) => entry.sequence === event.sequence)) {
    return previous
  }

  return {
    ...previous,
    events: [...previous.events, event].sort(
      (a, b) => a.sequence - b.sequence
    )
  }
}

export function useThreadStream(threadId: string | null | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!threadId) return

    const source = new EventSource(
      `${getApiBaseUrl()}/threads/${threadId}/stream`
    )

    const handle = (rawData: string) => {
      try {
        const event = JSON.parse(rawData) as ThreadEvent

        queryClient.setQueryData<ThreadResponse | null>(
          threadKey(threadId),
          (previous) => appendEvent(previous, event)
        )
      } catch {
        // ignore malformed payload
      }
    }

    source.onmessage = (messageEvent) => handle(messageEvent.data)

    for (const eventType of SUBSCRIBED_EVENT_TYPES) {
      source.addEventListener(eventType, (messageEvent) => {
        handle((messageEvent as MessageEvent).data)
      })
    }

    source.onerror = () => {
      source.close()
      void queryClient.invalidateQueries({ queryKey: threadKey(threadId) })
    }

    return () => {
      source.close()
    }
  }, [threadId, queryClient])
}

type StartThreadResponse = { thread: Thread }

export function useStartThreadMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (taskId: string) => {
      const data = await apiFetch<StartThreadResponse>(
        `/tasks/${taskId}/threads`,
        { method: 'POST' }
      )

      return data.thread
    },
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadResponse | null>(threadKey(thread.id), {
        thread,
        events: []
      })

      if (thread.taskId) {
        void queryClient.invalidateQueries({
          queryKey: taskThreadsKey(thread.taskId)
        })
        void queryClient.invalidateQueries({
          queryKey: ['tasks', thread.taskId]
        })
      }
    }
  })
}

export function useRestartThreadMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (taskId: string) => {
      const data = await apiFetch<StartThreadResponse>(
        `/tasks/${taskId}/threads/restart`,
        { method: 'POST' }
      )

      return data.thread
    },
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadResponse | null>(threadKey(thread.id), {
        thread,
        events: []
      })

      if (thread.taskId) {
        void queryClient.invalidateQueries({
          queryKey: taskThreadsKey(thread.taskId)
        })
        void queryClient.invalidateQueries({
          queryKey: ['tasks', thread.taskId]
        })
      }
    }
  })
}

export function useStartProjectThreadMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      projectId,
      text
    }: {
      projectId: string
      text: string
    }) => {
      const data = await apiFetch<StartThreadResponse>(
        `/projects/${projectId}/threads`,
        {
          method: 'POST',
          body: JSON.stringify({ text })
        }
      )

      return data.thread
    },
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadResponse | null>(threadKey(thread.id), {
        thread,
        events: []
      })

      if (thread.projectId) {
        void queryClient.invalidateQueries({
          queryKey: projectThreadsKey(thread.projectId)
        })
      }
    }
  })
}

export function useSendMessageMutation() {
  return useMutation({
    mutationFn: async ({
      threadId,
      text
    }: {
      threadId: string
      text: string
    }) => {
      await apiFetch<{ ok: boolean }>(`/threads/${threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text })
      })
    }
  })
}

type MergeResponse = {
  merge: { mergeCommitSha: string | null; autoCommitted: boolean }
}

export function useMergeTaskMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (taskId: string) => {
      const data = await apiFetch<MergeResponse>(`/tasks/${taskId}/merge`, {
        method: 'POST'
      })

      return { taskId, ...data.merge }
    },
    onSuccess: ({ taskId }) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', taskId] })
      void queryClient.invalidateQueries({
        queryKey: taskThreadsKey(taskId)
      })
    }
  })
}
