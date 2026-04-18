import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export const LAST_ROUTE_STORAGE_KEY = 'code-monkey:last-route'

export function useRoutePersistence() {
  const location = useLocation()

  useEffect(() => {
    const route = location.pathname + location.search

    try {
      window.localStorage.setItem(LAST_ROUTE_STORAGE_KEY, route)
    } catch {
      // Ignore storage failures (quota, private mode, etc.).
    }
  }, [location.pathname, location.search])
}
