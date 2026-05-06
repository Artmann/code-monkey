import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Per-thread caches are kept fresh by the SSE stream (see useThreadStream),
      // so background refetches just produce work without changing data. Treat
      // results as fresh for 5 minutes; cache stays warm for an hour even after
      // a query has no observers, so navigating away and back doesn't refetch.
      staleTime: 5 * 60_000,
      gcTime: 60 * 60_000,
      refetchOnWindowFocus: false
    }
  }
})
