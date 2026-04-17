import { FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateProjectMutation } from '../hooks/use-projects'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface NewProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewProjectDialog({ open, onOpenChange }: NewProjectDialogProps) {
  const [name, setName] = useState('')
  const [directoryPath, setDirectoryPath] = useState('')
  const [pickerError, setPickerError] = useState<string | null>(null)

  const createProject = useCreateProjectMutation()
  const navigate = useNavigate()

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setName('')
      setDirectoryPath('')
      setPickerError(null)
      createProject.reset()
    }

    onOpenChange(nextOpen)
  }

  async function pickDirectory() {
    setPickerError(null)

    try {
      const result = await window.codeMonkey.selectFolder()

      if (result.canceled || !result.directoryPath) {
        return
      }

      setDirectoryPath(result.directoryPath)

      if (!name) {
        setName(result.suggestedName ?? '')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to open folder picker'
      setPickerError(message)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (!name.trim() || !directoryPath) {
      return
    }

    const project = await createProject.mutateAsync({
      name: name.trim(),
      directoryPath
    })

    handleOpenChange(false)
    navigate(`/projects/${project.id}`)
  }

  const canSubmit = Boolean(name.trim() && directoryPath)

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className='sm:max-w-md'>
        <form
          onSubmit={handleSubmit}
          className='flex flex-col gap-4'
        >
          <DialogHeader>
            <DialogTitle className='font-display text-xl font-bold tracking-tight'>
              New project 🦍
            </DialogTitle>
            <DialogDescription>
              Point ape at folder. Ape need name.
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='project-directory'>Folder</Label>
            <div className='flex gap-2'>
              <Input
                id='project-directory'
                value={directoryPath}
                readOnly
                placeholder='No folder selected'
              />
              <Button
                type='button'
                variant='secondary'
                onClick={pickDirectory}
              >
                <FolderOpen />
                Browse
              </Button>
            </div>
            {pickerError ? (
              <p className='text-sm text-destructive'>{pickerError}</p>
            ) : null}
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='project-name'>Name</Label>
            <Input
              id='project-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='My project'
              autoFocus
            />
          </div>

          {createProject.isError ? (
            <p className='text-sm text-destructive'>
              {createProject.error instanceof Error
                ? createProject.error.message
                : 'Failed to create project'}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type='submit'
              disabled={!canSubmit || createProject.isPending}
            >
              {createProject.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
