import { FolderPlus, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

import { useNewTab } from '../hooks/use-new-tab'
import { useProviderSettingsQuery } from '../hooks/use-provider-settings'
import { Button } from './ui/button'

export function EmptyState() {
  const startNewTab = useNewTab()
  const settingsQuery = useProviderSettingsQuery()
  const providerConfigured = Boolean(settingsQuery.data?.kind)

  return (
    <div className='relative flex h-full flex-col items-center justify-center overflow-hidden px-6'>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(60% 40% at 50% 30%, color-mix(in oklab, var(--accent) 14%, transparent) 0%, transparent 70%)'
        }}
      />

      <div className='relative flex w-full max-w-[460px] flex-col items-center gap-6 text-center'>
        <div className='flex size-14 items-center justify-center rounded-2xl border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--accent)] shadow-[var(--shadow-1)]'>
          <Sparkles
            aria-hidden='true'
            className='size-6'
          />
        </div>

        <div className='space-y-2'>
          <h1 className='text-[24px] font-semibold tracking-tight text-[color:var(--fg)]'>
            Welcome to code-monkey
          </h1>
          <p className='text-[14px] leading-relaxed text-[color:var(--fg-3)]'>
            Open an agent in any folder. Each tab is its own session — pick a
            directory, give it a goal, and let it work.
          </p>
        </div>

        <Button
          type='button'
          size='lg'
          onClick={() => {
            void startNewTab()
          }}
          className='h-11 gap-2 px-5 text-[13px]'
        >
          <FolderPlus
            aria-hidden='true'
            className='size-4'
          />
          Start a new thread
        </Button>

        <div className='flex items-center gap-2 text-[12px] text-[color:var(--fg-4)]'>
          <span>or press</span>
          <span className='inline-flex items-center gap-0.5 rounded-sm border border-[color:var(--line)] bg-[color:var(--bg-3)] px-1.5 py-0.5 font-mono text-[10.5px] text-[color:var(--fg-3)]'>
            ⌘T
          </span>
        </div>

        {!providerConfigured ? (
          <div className='mt-2 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 text-left'>
            <p className='text-[12.5px] text-[color:var(--fg-2)]'>
              You haven&apos;t configured an agent provider yet.{' '}
              <Link
                to='/settings'
                className='text-[color:var(--accent)] underline underline-offset-2'
              >
                Open settings
              </Link>{' '}
              to add an API key.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
