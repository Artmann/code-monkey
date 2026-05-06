import { Route, Routes } from 'react-router-dom'

import { AgentView } from './components/agent-view'
import { EmptyState } from './components/empty-state'
import { TabBar } from './components/tab-bar'
import { useRoutePersistence } from './hooks/use-route-persistence'
import { SettingsRoute } from './routes/settings-route'

export function App() {
  useRoutePersistence()

  return (
    <div className='flex h-screen min-h-0 flex-col bg-background'>
      <TabBar />

      <div className='min-h-0 flex-1 overflow-hidden'>
        <Routes>
          <Route
            path='/'
            element={<EmptyState />}
          />
          <Route
            path='/threads/:threadId'
            element={<AgentView />}
          />
          <Route
            path='/settings'
            element={<SettingsRoute />}
          />
        </Routes>
      </div>
    </div>
  )
}
