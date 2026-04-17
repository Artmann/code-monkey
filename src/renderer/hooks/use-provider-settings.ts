import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from '../lib/api-client'

export type ProviderSettingsSummary =
  | { mode: 'cli'; binaryPath: string | null }
  | { mode: 'api'; hasApiKey: true }

export type SaveProviderInput =
  | { mode: 'cli'; binaryPath?: string | null }
  | { mode: 'api'; apiKey: string }

type ProviderResponse = {
  provider: ProviderSettingsSummary | null
}

const providerKey = ['settings', 'provider'] as const

export function useProviderSettingsQuery() {
  return useQuery({
    queryKey: providerKey,
    queryFn: async () => {
      const data = await apiFetch<ProviderResponse>('/settings/provider')

      return data.provider
    }
  })
}

export function useSaveProviderMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: SaveProviderInput) => {
      const data = await apiFetch<ProviderResponse>('/settings/provider', {
        method: 'POST',
        body: JSON.stringify(input)
      })

      return data.provider
    },
    onSuccess: (provider) => {
      queryClient.setQueryData(providerKey, provider)
    }
  })
}

export function useClearProviderMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      await apiFetch<{ ok: boolean }>('/settings/provider', {
        method: 'DELETE'
      })
    },
    onSuccess: () => {
      queryClient.setQueryData(providerKey, null)
    }
  })
}
