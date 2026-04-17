import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import invariant from 'tiny-invariant'
import { App } from './App'
import { queryClient } from './lib/query-client'
import './styles/globals.css'

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
