import { useCallback, useEffect, useState } from 'react'

import {
  applyTheme,
  getStoredTheme,
  setStoredTheme,
  type ThemePreference
} from '../lib/theme'

export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    getStoredTheme()
  )

  useEffect(() => {
    applyTheme(preference)
  }, [preference])

  useEffect(() => {
    if (preference !== 'system') return
    if (typeof window.matchMedia !== 'function') return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }

    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    setStoredTheme(next)
    setPreferenceState(next)
  }, [])

  return { preference, setPreference }
}
