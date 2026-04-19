import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { ApprovalCard } from './approval-card'

describe('ApprovalCard', () => {
  test('pending state shows approve and reject actions', () => {
    const onDecide = vi.fn()

    render(
      <ApprovalCard
        state='pending'
        tool='Bash'
        summary='git commit -m "wip"'
        onDecide={onDecide}
      />
    )

    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('git commit -m "wip"')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    expect(onDecide).toHaveBeenCalledWith({ decision: 'approve' })
  })

  test('reject reveals reason textarea and submits with reason', () => {
    const onDecide = vi.fn()

    render(
      <ApprovalCard
        state='pending'
        tool='Bash'
        summary='rm -rf /'
        onDecide={onDecide}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }))
    fireEvent.change(screen.getByPlaceholderText(/why/i), {
      target: { value: 'absolutely not' }
    })
    fireEvent.click(screen.getByRole('button', { name: /send rejection/i }))

    expect(onDecide).toHaveBeenCalledWith({
      decision: 'reject',
      reason: 'absolutely not'
    })
  })

  test('reject with empty reason sends undefined reason', () => {
    const onDecide = vi.fn()

    render(
      <ApprovalCard
        state='pending'
        tool='Bash'
        summary='rm -rf /'
        onDecide={onDecide}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^reject$/i }))
    fireEvent.click(screen.getByRole('button', { name: /send rejection/i }))

    expect(onDecide).toHaveBeenCalledWith({
      decision: 'reject',
      reason: undefined
    })
  })

  test('resolved approved state renders a one-liner summary', () => {
    render(
      <ApprovalCard
        state='resolved'
        tool='Bash'
        summary='git commit'
        decision='approve'
      />
    )

    expect(screen.getByText(/approved/i)).toBeInTheDocument()
    expect(screen.getByText(/git commit/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^approve$/i })
    ).not.toBeInTheDocument()
  })

  test('resolved rejected state shows the reason', () => {
    render(
      <ApprovalCard
        state='resolved'
        tool='Bash'
        summary='git commit'
        decision='reject'
        reason='let me do this myself'
      />
    )

    expect(screen.getByText(/rejected/i)).toBeInTheDocument()
    expect(screen.getByText(/let me do this myself/)).toBeInTheDocument()
  })
})
