import { cn } from '../../lib/utils'

export type TagColor = 'violet' | 'blue' | 'green' | 'amber' | 'red' | 'neutral'

interface TagProps {
  label: string
  color?: TagColor
  className?: string
}

const styleByColor: Record<TagColor, { bg: string; fg: string; dot: string }> = {
  violet: {
    bg: 'var(--tag-violet-bg)',
    fg: 'var(--tag-violet-fg)',
    dot: 'var(--tag-violet-dot)'
  },
  blue: {
    bg: 'var(--tag-blue-bg)',
    fg: 'var(--tag-blue-fg)',
    dot: 'var(--tag-blue-dot)'
  },
  green: {
    bg: 'var(--tag-green-bg)',
    fg: 'var(--tag-green-fg)',
    dot: 'var(--tag-green-dot)'
  },
  amber: {
    bg: 'var(--tag-amber-bg)',
    fg: 'var(--tag-amber-fg)',
    dot: 'var(--tag-amber-dot)'
  },
  red: {
    bg: 'var(--tag-red-bg)',
    fg: 'var(--tag-red-fg)',
    dot: 'var(--tag-red-dot)'
  },
  neutral: {
    bg: 'var(--tag-neutral-bg)',
    fg: 'var(--tag-neutral-fg)',
    dot: 'var(--tag-neutral-dot)'
  }
}

export function Tag({ className, color = 'neutral', label }: TagProps) {
  const style = styleByColor[color]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[2px] pl-1.5 text-[11px] font-medium',
        className
      )}
      style={{ backgroundColor: style.bg, color: style.fg }}
    >
      <span
        aria-hidden='true'
        className='size-1.5 rounded-full'
        style={{ backgroundColor: style.dot }}
      />
      <span>{label}</span>
    </span>
  )
}

const tagPalette: TagColor[] = ['violet', 'blue', 'green', 'amber', 'neutral']

export function tagColorFromString(value: string): TagColor {
  let hash = 0

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }

  const palette = tagPalette[hash % tagPalette.length]

  return palette ?? 'neutral'
}
