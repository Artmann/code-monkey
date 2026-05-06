interface MarkProps {
  size?: number
}

export function Mark({ size = 22 }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      aria-hidden='true'
    >
      <rect
        width='24'
        height='24'
        rx='6'
        fill='var(--mark-bg)'
      />
      <path
        d='M8 9.5a3.5 3.5 0 0 1 6 -2.5M8 14.5a3.5 3.5 0 0 0 6 2.5'
        stroke='var(--mark-fg)'
        strokeWidth='1.6'
        strokeLinecap='round'
        fill='none'
      />
      <circle
        cx='16.5'
        cy='12'
        r='1'
        fill='var(--mark-fg)'
      />
    </svg>
  )
}
