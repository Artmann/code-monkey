import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Welcome } from './welcome'

describe('Welcome', () => {
  it('renders the welcome heading and CTA', () => {
    render(<Welcome onCreateProject={() => undefined} />)

    expect(
      screen.getByRole('heading', { name: /welcome to code monkey/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /create your first project/i })
    ).toBeInTheDocument()
  })

  it('calls onCreateProject when the button is clicked', async () => {
    const user = userEvent.setup()
    const onCreateProject = vi.fn()

    render(<Welcome onCreateProject={onCreateProject} />)

    await user.click(
      screen.getByRole('button', { name: /create your first project/i })
    )

    expect(onCreateProject).toHaveBeenCalledOnce()
  })
})
