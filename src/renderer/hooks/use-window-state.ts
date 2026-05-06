import { useEffect, useState } from 'react'

import type { WindowState } from '../../preload/preload'

// The window starts maximized in createMainWindow(), so seeding `isMaximized`
// to true here avoids a brief icon flicker before the first state event lands.
const INITIAL_STATE: WindowState = {
  isMaximized: true,
  isFullScreen: false
}

export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>(INITIAL_STATE)

  useEffect(() => {
    let cancelled = false

    void window.codeMonkey.window.isMaximized().then((isMaximized) => {
      if (cancelled) {
        return
      }

      setState((previous) => ({ ...previous, isMaximized }))
    })

    const dispose = window.codeMonkey.window.onStateChanged((next) => {
      setState(next)
    })

    return () => {
      cancelled = true
      dispose()
    }
  }, [])

  return state
}
