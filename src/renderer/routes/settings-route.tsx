import { Monitor, Moon, Sun } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  useClearProviderMutation,
  useProviderSettingsQuery,
  useSaveProviderMutation,
  type ProviderKind,
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

const providerKindOptions: Array<{
  value: ProviderKind
  label: string
  description: string
}> = [
  {
    value: 'codex',
    label: 'Codex',
    description: 'OpenAI Codex CLI or API'
  },
  {
    value: 'claude-code',
    label: 'Claude Code',
    description: 'Anthropic Claude Code CLI or API'
  }
]

const defaultKind = (summary: ProviderSettingsSummary | null): ProviderKind => {
  if (summary?.kind === 'claude-code') return 'claude-code'

  return 'codex'
}

const defaultMode = (
  summary: ProviderSettingsSummary | null,
  kind: ProviderKind
): Mode => {
  if (summary?.kind === kind && summary.mode === 'api') return 'api'

  return 'cli'
}

const defaultCodexBinaryPath = (
  summary: ProviderSettingsSummary | null
): string => {
  if (summary?.kind === 'codex' && summary.mode === 'cli') {
    return summary.binaryPath ?? ''
  }

  return ''
}

const defaultClaudeExecutablePath = (
  summary: ProviderSettingsSummary | null
): string => {
  if (summary?.kind === 'claude-code' && summary.mode === 'cli') {
    return summary.executablePath ?? ''
  }

  return ''
}

export function SettingsRoute() {
  const query = useProviderSettingsQuery()
  const save = useSaveProviderMutation()
  const clear = useClearProviderMutation()
  const theme = useTheme()

  const summary = query.data ?? null

  const [kindOverride, setKindOverride] = useState<ProviderKind | null>(null)
  const [modeOverride, setModeOverride] = useState<Mode | null>(null)
  const [codexBinaryPathOverride, setCodexBinaryPathOverride] = useState<
    string | null
  >(null)
  const [claudeExecutablePathOverride, setClaudeExecutablePathOverride] =
    useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const kind = kindOverride ?? defaultKind(summary)
  const mode = modeOverride ?? defaultMode(summary, kind)
  const codexBinaryPath =
    codexBinaryPathOverride ?? defaultCodexBinaryPath(summary)
  const claudeExecutablePath =
    claudeExecutablePathOverride ?? defaultClaudeExecutablePath(summary)

  const selectKind = (next: ProviderKind) => {
    setKindOverride(next)
    setModeOverride(null)
    setApiKey('')
    setErrorMessage(null)
  }

  const saving = save.isPending
  const hasApiKey =
    summary?.kind === kind && summary.mode === 'api' && summary.hasApiKey

  const apiKeyLabel =
    kind === 'codex' ? 'OpenAI API key' : 'Anthropic API key'

  const handleSave = async () => {
    setErrorMessage(null)

    try {
      if (kind === 'codex') {
        if (mode === 'cli') {
          await save.mutateAsync({
            kind: 'codex',
            mode: 'cli',
            binaryPath: codexBinaryPath.trim() || null
          })
        } else {
          await save.mutateAsync({
            kind: 'codex',
            mode: 'api',
            apiKey
          })
          setApiKey('')
        }
      } else if (mode === 'cli') {
        await save.mutateAsync({
          kind: 'claude-code',
          mode: 'cli',
          executablePath: claudeExecutablePath.trim() || null
        })
      } else {
        await save.mutateAsync({
          kind: 'claude-code',
          mode: 'api',
          apiKey
        })
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
          <h2 className='text-sm font-medium'>Agent provider</h2>
          {!summary && (
            <span className='text-xs text-[color:var(--ctp-yellow)]'>
              No provider configured
            </span>
          )}
          {summary && (
            <span className='text-xs text-[color:var(--ctp-green)]'>
              Configured
            </span>
          )}
        </header>

        <div
          role='radiogroup'
          aria-label='Provider'
          className='mb-4 grid grid-cols-2 gap-2'
        >
          {providerKindOptions.map((option) => {
            const selected = kind === option.value

            return (
              <button
                key={option.value}
                type='button'
                role='radio'
                aria-checked={selected}
                aria-label={option.label}
                onClick={() => selectKind(option.value)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
                  'hover:border-muted-foreground/50 hover:bg-accent/40',
                  selected &&
                    'border-banana bg-banana/10 hover:border-banana hover:bg-banana/10'
                )}
              >
                <span className='text-sm font-medium'>{option.label}</span>
                <span className='text-[11px] text-muted-foreground'>
                  {option.description}
                </span>
              </button>
            )
          })}
        </div>

        <fieldset className='space-y-4'>
          <legend className='sr-only'>Authentication mode</legend>

          <label className='flex items-start gap-3'>
            <input
              type='radio'
              name='provider-mode'
              value='cli'
              checked={mode === 'cli'}
              onChange={() => setModeOverride('cli')}
              className='mt-1 h-4 w-4'
              aria-label={
                kind === 'codex' ? 'Codex CLI' : 'Claude Code CLI'
              }
            />
            <span className='flex-1'>
              <span className='block text-sm font-medium'>
                {kind === 'codex'
                  ? 'Use installed Codex CLI'
                  : 'Use installed Claude Code CLI'}
              </span>
              <span className='block text-xs text-muted-foreground'>
                {kind === 'codex' ? (
                  <>
                    Reuses the `codex login` credentials from{' '}
                    <code className='font-mono'>~/.codex</code>. Optionally
                    override the binary path when codex is not on your PATH.
                  </>
                ) : (
                  <>
                    Reuses the `claude login` credentials from{' '}
                    <code className='font-mono'>~/.claude</code>. Optionally
                    override the executable path.
                  </>
                )}
              </span>
              {mode === 'cli' && kind === 'codex' && (
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
                    value={codexBinaryPath}
                    onChange={(event) =>
                      setCodexBinaryPathOverride(event.target.value)
                    }
                  />
                </div>
              )}
              {mode === 'cli' && kind === 'claude-code' && (
                <div className='mt-2 space-y-1'>
                  <Label
                    htmlFor='executable-path'
                    className='text-xs'
                  >
                    Executable path (optional)
                  </Label>
                  <Input
                    id='executable-path'
                    placeholder='/usr/local/bin/claude'
                    value={claudeExecutablePath}
                    onChange={(event) =>
                      setClaudeExecutablePathOverride(event.target.value)
                    }
                  />
                </div>
              )}
            </span>
          </label>

          <label className='flex items-start gap-3'>
            <input
              type='radio'
              name='provider-mode'
              value='api'
              checked={mode === 'api'}
              onChange={() => setModeOverride('api')}
              className='mt-1 h-4 w-4'
              aria-label={apiKeyLabel}
            />
            <span className='flex-1'>
              <span className='block text-sm font-medium'>
                Use {apiKeyLabel}
              </span>
              <span className='block text-xs text-muted-foreground'>
                Stored encrypted via your OS keychain (Electron safeStorage).
                The key never leaves the device.
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
                    placeholder={kind === 'codex' ? 'sk-...' : 'sk-ant-...'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete='off'
                  />
                  {hasApiKey && (
                    <p className='text-xs text-[color:var(--ctp-green)]'>
                      An API key is stored. Enter a new value to replace it.
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
