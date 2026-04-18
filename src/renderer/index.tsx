import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import invariant from 'tiny-invariant'
import { App } from './App'
import { LAST_ROUTE_STORAGE_KEY } from './hooks/use-route-persistence'
import { queryClient } from './lib/query-client'
import { applyTheme, getStoredTheme } from './lib/theme'
import './styles/globals.css'

// Apply the saved theme before the first paint to avoid a flash.
applyTheme(getStoredTheme())

// Restore the last visited route before React mounts so HashRouter boots
// directly into it instead of flashing the home screen.
restoreLastRoute()

function restoreLastRoute() {
  const currentHash = window.location.hash

  if (currentHash && currentHash !== '#/' && currentHash !== '#') {
    return
  }

  let savedRoute: string | null = null

  try {
    savedRoute = window.localStorage.getItem(LAST_ROUTE_STORAGE_KEY)
  } catch {
    return
  }

  if (!savedRoute || !savedRoute.startsWith('/')) {
    return
  }

  window.location.hash = savedRoute
}

const rootElement = document.getElementById('root')
invariant(rootElement, '#root element not found in index.html')

const root = createRoot(rootElement)

void queryClient.prefetchQuery({
  queryKey: ['projects'],
  queryFn: async () => {
    const port = window.codeMonkey?.apiPort

    if (!port) {
      return []
    }

    const response = await fetch(`http://127.0.0.1:${port}/projects`)

    if (!response.ok) {
      return []
    }

    const data = (await response.json()) as { projects: unknown[] }

    return data.projects
  }
})

root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>
)
