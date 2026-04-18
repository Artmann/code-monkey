import { Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  useClearProviderMutation,
  useProviderSettingsQuery,
  useSaveProviderMutation,
  type ProviderSettingsSummary
} from '../hooks/use-provider-settings'
import { useTheme } from '../hooks/use-theme'
import type { ThemePreference } from '../lib/theme'
import { cn } from '../lib/utils'

const themeOptions: Array<{
  value: ThemePreference
  label: string
  icon: typeof Sun
  description: string
}> = [
  {
    value: 'light',
    label: 'Light',
    icon: Sun,
    description: 'Catppuccin Latte'
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: Moon,
    description: 'Catppuccin Macchiato'
  },
  {
    value: 'system',
    label: 'System',
    icon: Monitor,
    description: 'Match your OS'
  }
]

type Mode = 'cli' | 'api'

const defaultBinaryPath = (summary: ProviderSettingsSummary | null) => {
  if (summary?.mode === 'cli') return summary.binaryPath ?? ''

  return ''
}

const defaultMode = (summary: ProviderSettingsSummary | null): Mode => {
  if (summary?.mode === 'api') return 'api'

  return 'cli'
}

export function SettingsRoute() {
  const query = useProviderSettingsQuery()
  const save = useSaveProviderMutation()
  const clear = useClearProviderMutation()
  const theme = useTheme()

  const summary = query.data ?? null

  const [modeOverride, setModeOverride] = useState<Mode | null>(null)
  const [binaryPathOverride, setBinaryPathOverride] = useState<string | null>(
    null
  )
  const [apiKey, setApiKey] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mode = modeOverride ?? defaultMode(summary)
  const binaryPath = binaryPathOverride ?? defaultBinaryPath(summary)
  const setMode = (next: Mode) => setModeOverride(next)
  const setBinaryPath = (next: string) => setBinaryPathOverride(next)

  const saving = save.isPending
  const hasApiKey = summary?.mode === 'api' && summary.hasApiKey === true

  const handleSave = async () => {
    setErrorMessage(null)

    try {
      if (mode === 'cli') {
        await save.mutateAsync({
          mode: 'cli',
          binaryPath: binaryPath.trim() || null
        })
      } else {
        await save.mutateAsync({ mode: 'api', apiKey })
        setApiKey('')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      setErrorMessage(message)
    }
  }

  const handleClear = async () => {
    setErrorMessage(null)
    await clear.mutateAsync()
    setApiKey('')
  }

  return (
    <div className='mx-auto max-w-2xl p-6'>
      <h1 className='mb-1 text-lg font-semibold'>Settings</h1>
      <p className='mb-6 text-sm text-muted-foreground'>
        Configure how code-monkey connects to an agent provider.
      </p>

      <section className='mb-6 rounded-md border p-4'>
        <header className='mb-3'>
          <h2 className='text-sm font-medium'>Appearance</h2>
          <p className='text-xs text-muted-foreground'>
            Choose a color theme. System follows your OS setting.
          </p>
        </header>

        <div
          role='radiogroup'
          aria-label='Theme'
          className='grid grid-cols-3 gap-2'
        >
          {themeOptions.map((option) => {
            const Icon = option.icon
            const selected = theme.preference === option.value

            return (
              <button
                key={option.value}
                type='button'
                role='radio'
                aria-checked={selected}
                onClick={() => theme.setPreference(option.value)}
                className={cn(
                  'flex flex-col items-start gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
                  'hover:border-muted-foreground/50 hover:bg-accent/40',
                  selected &&
                    'border-banana bg-banana/10 hover:border-banana hover:bg-banana/10'
                )}
              >
                <span className='flex items-center gap-2 text-sm font-medium'>
                  <Icon
                    aria-hidden='true'
                    className={cn(
                      'size-4',
                      selected ? 'text-banana' : 'text-muted-foreground'
                    )}
                  />
                  {option.label}
                </span>
                <span className='text-[11px] text-muted-foreground'>
                  {option.description}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <section className='rounded-md border p-4'>
        <header className='mb-4 flex items-baseline justify-between'>
          <h2 className='text-sm font-medium'>Provider: Codex</h2>
          {!summary && (
            <span className='text-xs text-[color:var(--ctp-yellow)]'>
              No provider configured
            </span>
          )}
          {summary && (
            <span className='text-xs text-[color:var(--ctp-green)]'>Configured</span>
          )}
        </header>

        <fieldset className='space-y-4'>
          <legend className='sr-only'>Codex authentication mode</legend>

          <label className='flex items-start gap-3'>
            <input
              type='radio'
              name='codex-mode'
              value='cli'
              checked={mode === 'cli'}
              onChange={() => setMode('cli')}
              className='mt-1 h-4 w-4'
              aria-label='Codex CLI'
            />
            <span className='flex-1'>
              <span className='block text-sm font-medium'>
                Use installed Codex CLI
              </span>
              <span className='block text-xs text-muted-foreground'>
                Reuses the `codex login` credentials from{' '}
                <code className='font-mono'>~/.codex</code>. Optionally
                override the binary path when codex is not on your PATH.
              </span>
              {mode === 'cli' && (
                <div className='mt-2 space-y-1'>
                  <Label
                    htmlFor='binary-path'
                    className='text-xs'
                  >
                    Binary path (optional)
                  </Label>
                  <Input
                    id='binary-path'
                    placeholder='/usr/local/bin/codex'
                    value={binaryPath}
                    onChange={(event) => setBinaryPath(event.target.value)}
                  />
                </div>
              )}
            </span>
          </label>

          <label className='flex items-start gap-3'>
            <input
              type='radio'
              name='codex-mode'
              value='api'
              checked={mode === 'api'}
              onChange={() => setMode('api')}
              className='mt-1 h-4 w-4'
              aria-label='OpenAI API key'
            />
            <span className='flex-1'>
              <span className='block text-sm font-medium'>
                Use OpenAI API key
              </span>
              <span className='block text-xs text-muted-foreground'>
                Stored encrypted via your OS keychain (Electron
                safeStorage). The key never leaves the device.
              </span>
              {mode === 'api' && (
                <div className='mt-2 space-y-1'>
                  <Label
                    htmlFor='api-key'
                    className='text-xs'
                  >
                    API key
                  </Label>
                  <Input
                    id='api-key'
                    type='password'
                    placeholder='sk-...'
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete='off'
                  />
                  {hasApiKey && (
                    <p className='text-xs text-[color:var(--ctp-green)]'>
                      An API key is stored. Enter a new value to replace
                      it.
                    </p>
                  )}
                </div>
              )}
            </span>
          </label>
        </fieldset>

        {errorMessage && (
          <p
            role='alert'
            className='mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive'
          >
            {errorMessage}
          </p>
        )}

        <div className='mt-6 flex items-center gap-2'>
          <Button
            type='button'
            onClick={handleSave}
            disabled={saving || (mode === 'api' && apiKey.length === 0)}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {summary && (
            <Button
              type='button'
              variant='ghost'
              onClick={handleClear}
              disabled={clear.isPending}
            >
              Clear
            </Button>
          )}
        </div>
      </section>
    </div>
  )
}
