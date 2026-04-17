import { useState } from 'react'
import { useProjectsQuery } from '../hooks/use-projects'
import {
  useCreateTaskMutation,
  type TaskStatus
} from '../hooks/use-tasks'
import { getStatusMeta, statusOrder } from '../lib/task-status'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'
import { Switch } from './ui/switch'
import { Textarea } from './ui/textarea'

interface NewTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultProjectId: string | null
  defaultStatus?: TaskStatus
}

export function NewTaskDialog({
  open,
  onOpenChange,
  defaultProjectId,
  defaultStatus = 'todo'
}: NewTaskDialogProps) {
  const projectsQuery = useProjectsQuery()
  const projects = projectsQuery.data ?? []

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskStatus>(defaultStatus)
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId)
  const [createMore, setCreateMore] = useState(false)

  const createTask = useCreateTaskMutation()

  function resetForm() {
    setTitle('')
    setDescription('')
    setStatus(defaultStatus)
    setProjectId(defaultProjectId)
    createTask.reset()
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm()
    }

    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const trimmedTitle = title.trim()

    if (!trimmedTitle || !projectId) {
      return
    }

    await createTask.mutateAsync({
      projectId,
      title: trimmedTitle,
      description: description.trim() ? description.trim() : null,
      status
    })

    if (createMore) {
      setTitle('')
      setDescription('')
      createTask.reset()
    } else {
      handleOpenChange(false)
    }
  }

  const currentProject =
    projects.find((project) => project.id === projectId) ?? null
  const canSubmit = Boolean(title.trim() && projectId)

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className='sm:max-w-xl'>
        <form
          onSubmit={handleSubmit}
          className='flex flex-col gap-4'
        >
          <DialogHeader className='flex flex-row items-center gap-2'>
            <Select
              value={projectId ?? ''}
              onValueChange={(value) => setProjectId(value)}
            >
              <SelectTrigger
                size='sm'
                className='h-7 w-auto gap-2 border-0 bg-muted/40 text-xs hover:bg-muted'
              >
                <SelectValue placeholder='Select project'>
                  {currentProject?.name ?? 'Select project'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem
                    key={project.id}
                    value={project.id}
                  >
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogTitle className='sr-only'>New task</DialogTitle>
            <DialogDescription className='sr-only'>
              Create a new task in the selected project.
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-3'>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder='Task title'
              autoFocus
              className='border-0 px-0 font-display text-2xl font-bold tracking-tight shadow-none focus-visible:ring-0 md:text-2xl'
            />

            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder='Add description… what should ape do?'
              rows={3}
              className='resize-none border-0 px-0 shadow-none focus-visible:ring-0'
            />
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <Label
              htmlFor='task-status'
              className='sr-only'
            >
              Status
            </Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as TaskStatus)}
            >
              <SelectTrigger
                id='task-status'
                size='sm'
                className='h-7 w-auto gap-2 text-xs'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOrder.map((value) => {
                  const meta = getStatusMeta(value)
                  const Icon = meta.icon

                  return (
                    <SelectItem
                      key={value}
                      value={value}
                    >
                      <Icon className={meta.iconClassName} />
                      {meta.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {createTask.isError ? (
            <p className='text-sm text-destructive'>
              {createTask.error instanceof Error
                ? createTask.error.message
                : 'Failed to create task'}
            </p>
          ) : null}

          <DialogFooter className='flex items-center justify-between gap-4 sm:justify-between'>
            <Label
              htmlFor='create-more'
              className='flex items-center gap-2 text-sm font-normal text-muted-foreground'
            >
              <Switch
                id='create-more'
                checked={createMore}
                onCheckedChange={setCreateMore}
              />
              Create more
            </Label>

            <Button
              type='submit'
              disabled={!canSubmit || createTask.isPending}
            >
              {createTask.isPending ? 'Creating…' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
