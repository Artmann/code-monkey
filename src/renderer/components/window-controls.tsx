import { Minus, X } from 'lucide-react'
import type { CSSProperties } from 'react'

import { useWindowState } from '../hooks/use-window-state'
import { cn } from '../lib/utils'

const noDrag: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

const baseButtonClass =
  'inline-flex h-9 w-11 items-center justify-center text-[color:var(--fg-3)] outline-none transition-colors hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)] focus-visible:bg-[color:var(--bg-3)] focus-visible:text-[color:var(--fg)]'

// Custom caption icons keep crisp 10×10 strokes that read well at small sizes —
// Lucide's icons are designed for body content and look heavy in caption slots.
function MaximizeGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className="size-2.5"
    >
      <rect
        x="0.5"
        y="0.5"
        width="9"
        height="9"
      />
    </svg>
  )
}

function RestoreGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className="size-2.5"
    >
      <rect
        x="0.5"
        y="2.5"
        width="7"
        height="7"
      />
      <path d="M2.5 2.5 V0.5 H9.5 V7.5 H7.5" />
    </svg>
  )
}

export function WindowControls() {
  const { isMaximized, isFullScreen } = useWindowState()

  // macOS uses the native traffic lights via `titleBarStyle: 'hiddenInset'`,
  // and in fullscreen the OS chrome is gone so our buttons would be redundant.
  if (window.codeMonkey.platform === 'darwin' || isFullScreen) {
    return null
  }

  return (
    <div
      className="flex items-stretch self-stretch"
      style={noDrag}
    >
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => {
          void window.codeMonkey.window.minimize()
        }}
        className={baseButtonClass}
      >
        <Minus
          aria-hidden="true"
          className="size-3.5"
        />
      </button>

      <button
        type="button"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        title={isMaximized ? 'Restore' : 'Maximize'}
        onClick={() => {
          void window.codeMonkey.window.maximizeToggle()
        }}
        className={baseButtonClass}
      >
        {isMaximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>

      <button
        type="button"
        aria-label="Close"
        title="Close"
        onClick={() => {
          void window.codeMonkey.window.close()
        }}
        className={cn(
          baseButtonClass,
          'hover:bg-[color:var(--destructive)] hover:text-white focus-visible:bg-[color:var(--destructive)] focus-visible:text-white'
        )}
      >
        <X
          aria-hidden="true"
          className="size-3.5"
        />
      </button>
    </div>
  )
}
