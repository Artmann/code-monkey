import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api-client'

export interface Project {
  id: string
  name: string
  directoryPath: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

interface ProjectsResponse {
  projects: Project[]
}

interface ProjectResponse {
  project: Project
}

export interface CreateProjectInput {
  name: string
  directoryPath: string
}

const projectsKey = ['projects'] as const

export function useProjectsQuery() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: async () => {
      const data = await apiFetch<ProjectsResponse>('/projects')

      return data.projects
    }
  })
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      const data = await apiFetch<ProjectResponse>('/projects', {
        method: 'POST',
        body: JSON.stringify(input)
      })

      return data.project
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectsKey })
    }
  })
}
