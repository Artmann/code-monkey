import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface BranchChipProps {
  branch: string
  icon?: ReactNode
  className?: string
}

function GitBranchIcon() {
  return (
    <svg
      aria-hidden='true'
      width='12'
      height='12'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <circle cx='6' cy='5' r='2' />
      <circle cx='6' cy='19' r='2' />
      <circle cx='18' cy='7' r='2' />
      <path d='M6 7v10M18 9c0 4-6 4-6 8' />
    </svg>
  )
}

export function BranchChip({ branch, className, icon }: BranchChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border bg-[color:var(--bg-2)] px-1.5 py-[2px] font-mono text-[11px]',
        'border-[color:var(--line)] text-[color:var(--fg-3)]',
        className
      )}
    >
      <span className='inline-flex'>{icon ?? <GitBranchIcon />}</span>
      <span className='truncate'>{branch}</span>
    </span>
  )
}
