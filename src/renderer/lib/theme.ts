export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'cm:theme'
const PREFERENCES: readonly ThemePreference[] = [
  'light',
  'dark',
  'system'
] as const

function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === 'string' &&
    (PREFERENCES as readonly string[]).includes(value)
  )
}

export function getStoredTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)

    if (isThemePreference(value)) return value
  } catch {
    // localStorage unavailable — fall through.
  }

  return 'system'
}

export function setStoredTheme(value: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // noop
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function resolveMode(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') {
    return systemPrefersDark() ? 'dark' : 'light'
  }

  return preference
}

export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return

  const mode = resolveMode(preference)
  const root = document.documentElement

  if (mode === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }

  root.dataset.theme = mode
}
