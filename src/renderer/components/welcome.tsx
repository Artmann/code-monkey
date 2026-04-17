import { FolderPlus } from 'lucide-react'
import { Button } from './ui/button'

interface WelcomeProps {
  onCreateProject: () => void
}

export function Welcome({ onCreateProject }: WelcomeProps) {
  return (
    <div className='flex h-full flex-1 items-center justify-center p-8'>
      <div className='flex max-w-lg flex-col items-center gap-8 text-center'>
        <div className='relative'>
          <div className='absolute inset-0 -z-10 rounded-full bg-banana/20 blur-2xl' />
          <div className='text-7xl leading-none select-none'>🦍</div>
          <div className='absolute -right-3 -bottom-1 text-3xl animate-banana-pulse select-none'>
            🍌
          </div>
        </div>

        <div className='flex flex-col gap-3'>
          <h1 className='font-display text-5xl font-bold tracking-tight'>
            Welcome to <span className='text-banana'>Code Monkey</span>
          </h1>
          <p className='font-display text-lg font-medium text-foreground/80'>
            Point ape at repo. Give ape task. Ape ship code.
          </p>
          <p className='text-sm text-muted-foreground'>
            Apes together strong. 🦍🦍🦍
          </p>
        </div>

        <Button
          size='lg'
          onClick={onCreateProject}
          className='font-display font-semibold'
        >
          <FolderPlus />
          Create your first project
        </Button>

        <p className='font-mono text-xs text-muted-foreground'>
          press{' '}
          <kbd className='rounded border border-border bg-muted px-1.5 py-0.5 text-foreground'>
            C
          </kbd>{' '}
          to summon task. 🍌
        </p>
      </div>
    </div>
  )
}
