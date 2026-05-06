import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { apiFetch, getApiBaseUrl } from '../lib/api-client'
import { clearDraftStorage } from './use-draft'

export type ThreadStatus = 'starting' | 'running' | 'idle' | 'done' | 'error'

export type Thread = {
  id: string
  name: string
  directoryPath: string
  provider: string | null
  externalThreadId: string | null
  status: ThreadStatus
  errorMessage: string | null
  tabOrder: number
  closedAt: string | null
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

export const threadsKey = ['threads'] as const

export const threadKey = (threadId: string) => ['thread', threadId] as const

const SUBSCRIBED_EVENT_TYPES = [
  'prep',
  'thread.started',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'turn.cancelled',
  'item.started',
  'item.updated',
  'item.completed',
  'item.approval_requested',
  'item.approval_resolved',
  'user_message',
  'error'
] as const

export type PendingApproval = {
  id: string
  tool: string
  input: unknown
  summary: string
}

export const derivePendingApproval = (
  events: ThreadEvent[]
): PendingApproval | null => {
  const resolvedIds = new Set<string>()

  for (const event of events) {
    if (event.type !== 'item.approval_resolved') {
      continue
    }

    const item = (event.payload as { item?: { id?: string } } | null)?.item

    if (item?.id) {
      resolvedIds.add(item.id)
    }
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]

    if (event?.type !== 'item.approval_requested') {
      continue
    }

    const item = (
      event.payload as {
        item?: {
          id?: string
          tool?: string
          input?: unknown
          summary?: string
        }
      } | null
    )?.item

    if (!item?.id || resolvedIds.has(item.id)) {
      continue
    }

    return {
      id: item.id,
      tool: item.tool ?? 'unknown',
      input: item.input ?? null,
      summary: item.summary ?? ''
    }
  }

  return null
}

export function useThreadsQuery() {
  return useQuery({
    queryKey: threadsKey,
    queryFn: async () => {
      const data = await apiFetch<{ threads: Thread[] }>('/threads')

      return data.threads
    }
  })
}

export function useThreadQuery(threadId: string | null | undefined) {
  return useQuery({
    queryKey: threadKey(threadId ?? ''),
    enabled: Boolean(threadId),
    queryFn: async () => {
      if (!threadId) {
        return null
      }

      return apiFetch<ThreadResponse>(`/threads/${threadId}`)
    }
  })
}

const extractEventMessage = (payload: unknown): string | null => {
  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const record = payload as {
    message?: unknown
    error?: { message?: unknown }
  }

  if (typeof record.message === 'string') {
    return record.message
  }

  if (
    record.error &&
    typeof record.error === 'object' &&
    typeof record.error.message === 'string'
  ) {
    return record.error.message
  }

  return null
}

// Mirror agent-runner's backend status transitions on terminal events. The
// backend updates the DB row, but the SSE stream only carries events — so
// without this the thread row in the React Query cache stays 'running'
// forever after the agent finishes.
export const applyStatusFromEvent = (
  thread: Thread,
  event: ThreadEvent
): Thread => {
  if (event.type === 'turn.completed' || event.type === 'turn.cancelled') {
    if (thread.status === 'running' || thread.status === 'starting') {
      return { ...thread, status: 'idle', errorMessage: null }
    }

    return thread
  }

  if (event.type === 'turn.failed' || event.type === 'error') {
    const message = extractEventMessage(event.payload) ?? 'Unknown agent error'

    return { ...thread, status: 'error', errorMessage: message }
  }

  return thread
}

const appendEvent = (
  previous: ThreadResponse | null | undefined,
  event: ThreadEvent
): ThreadResponse | null | undefined => {
  if (!previous) {
    return previous
  }

  if (previous.events.some((entry) => entry.sequence === event.sequence)) {
    return previous
  }

  return {
    ...previous,
    thread: applyStatusFromEvent(previous.thread, event),
    events: [...previous.events, event].sort((a, b) => a.sequence - b.sequence)
  }
}

export function useThreadStream(threadId: string | null | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!threadId) {
      return
    }

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

        // The threads list query feeds the TabBar's spinner. Mirror the
        // status transition here so the tab stops spinning the moment the
        // turn completes — without this it stays stuck on 'running' until
        // the next list refetch.
        queryClient.setQueryData<Thread[] | undefined>(
          threadsKey,
          (previous) => {
            if (!previous) {
              return previous
            }

            return previous.map((thread) =>
              thread.id === threadId
                ? applyStatusFromEvent(thread, event)
                : thread
            )
          }
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

type CreateThreadInput = {
  directoryPath: string
  name?: string
  initialMessage?: string
}

type ThreadResponseEnvelope = { thread: Thread }

export function useCreateThreadMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateThreadInput) => {
      const data = await apiFetch<ThreadResponseEnvelope>('/threads', {
        method: 'POST',
        body: JSON.stringify(input)
      })

      return data.thread
    },
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadResponse | null>(threadKey(thread.id), {
        thread,
        events: []
      })

      void queryClient.invalidateQueries({ queryKey: threadsKey })
    }
  })
}

export function useUpdateThreadMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      threadId,
      ...patch
    }: {
      threadId: string
      name?: string
      tabOrder?: number
    }) => {
      const data = await apiFetch<ThreadResponseEnvelope>(
        `/threads/${threadId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch)
        }
      )

      return data.thread
    },
    onSuccess: (thread) => {
      queryClient.setQueryData<ThreadResponse | null>(
        threadKey(thread.id),
        (previous) => (previous ? { ...previous, thread } : previous)
      )

      void queryClient.invalidateQueries({ queryKey: threadsKey })
    }
  })
}

export function useCloseThreadMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (threadId: string) => {
      await apiFetch<{ ok: boolean }>(`/threads/${threadId}`, {
        method: 'DELETE'
      })

      return threadId
    },
    onSuccess: (threadId) => {
      // Closed threads can never come back, so drop their persisted draft
      // to keep localStorage tidy.
      clearDraftStorage(threadId)

      void queryClient.invalidateQueries({ queryKey: threadsKey })
    }
  })
}

export function useCancelThreadMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (threadId: string) => {
      await apiFetch<{ ok: boolean }>(`/threads/${threadId}/cancel`, {
        method: 'POST'
      })

      return threadId
    },
    onMutate: async (threadId) => {
      await queryClient.cancelQueries({ queryKey: threadKey(threadId) })

      const previous = queryClient.getQueryData<ThreadResponse | null>(
        threadKey(threadId)
      )

      if (previous?.thread) {
        queryClient.setQueryData<ThreadResponse | null>(threadKey(threadId), {
          ...previous,
          thread: {
            ...previous.thread,
            status: 'idle',
            errorMessage: null
          }
        })
      }

      return { previous }
    },
    onError: (_error, threadId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(threadKey(threadId), context.previous)
      }
    }
  })
}

export type ComposerMode = 'code' | 'plan'

export function useSendMessageMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      threadId,
      text,
      mode
    }: {
      threadId: string
      text: string
      mode?: ComposerMode
    }) => {
      await apiFetch<{ ok: boolean }>(`/threads/${threadId}/messages`, {
        method: 'POST',
        body: JSON.stringify(mode ? { text, mode } : { text })
      })
    },
    onMutate: async ({ threadId }) => {
      await queryClient.cancelQueries({ queryKey: threadKey(threadId) })

      const previous = queryClient.getQueryData<ThreadResponse | null>(
        threadKey(threadId)
      )

      if (previous?.thread) {
        queryClient.setQueryData<ThreadResponse | null>(threadKey(threadId), {
          ...previous,
          thread: { ...previous.thread, status: 'running', errorMessage: null }
        })
      }

      return { previous }
    },
    onError: (_error, { threadId }, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(threadKey(threadId), context.previous)
      }
    }
  })
}
