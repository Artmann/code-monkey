import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '../lib/api-client'

export type Workspace = {
  id: string
  name: string
  sortOrder: number
  lastActiveThreadId: string | null
  createdAt: string
}

export type WorkspacesResponse = {
  workspaces: Workspace[]
  activeWorkspaceId: string
}

export const workspacesKey = ['workspaces'] as const

export function useWorkspacesQuery() {
  return useQuery({
    queryKey: workspacesKey,
    queryFn: async () => apiFetch<WorkspacesResponse>('/workspaces')
  })
}

export function useActiveWorkspaceId(): string | null {
  const query = useWorkspacesQuery()

  return query.data?.activeWorkspaceId ?? null
}

export function useCreateWorkspaceMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { name: string }) => {
      const data = await apiFetch<{ workspace: Workspace }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify(input)
      })

      return data.workspace
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspacesKey })
    }
  })
}

type UpdateWorkspaceInput = {
  workspaceId: string
  name?: string
  sortOrder?: number
  lastActiveThreadId?: string | null
}

export function useUpdateWorkspaceMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...patch }: UpdateWorkspaceInput) => {
      const data = await apiFetch<{ workspace: Workspace }>(
        `/workspaces/${workspaceId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch)
        }
      )

      return data.workspace
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspacesKey })
    }
  })
}

export function useDeleteWorkspaceMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      await apiFetch<{ ok: boolean }>(`/workspaces/${workspaceId}`, {
        method: 'DELETE'
      })

      return workspaceId
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspacesKey })
    }
  })
}

export function useSetActiveWorkspaceMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const data = await apiFetch<{ activeWorkspaceId: string }>(
        '/workspaces/active',
        {
          method: 'POST',
          body: JSON.stringify({ workspaceId })
        }
      )

      return data.activeWorkspaceId
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspacesKey })
    }
  })
}
