import { Check, ChevronDown, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from 'react'

import {
  useCreateWorkspaceMutation,
  useDeleteWorkspaceMutation,
  useSetActiveWorkspaceMutation,
  useUpdateWorkspaceMutation,
  useWorkspacesQuery,
  type Workspace
} from '../hooks/use-workspace'
import { cn } from '../lib/utils'

type WorkspaceSwitcherProps = {
  onSwitchWorkspace: (workspace: Workspace) => void
  noDragRegion: CSSProperties
}

export function WorkspaceSwitcher({
  onSwitchWorkspace,
  noDragRegion
}: WorkspaceSwitcherProps) {
  const workspacesQuery = useWorkspacesQuery()
  const createWorkspace = useCreateWorkspaceMutation()
  const updateWorkspace = useUpdateWorkspaceMutation()
  const deleteWorkspace = useDeleteWorkspaceMutation()
  const setActiveWorkspace = useSetActiveWorkspaceMutation()

  const [isOpen, setOpen] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const createInputRef = useRef<HTMLInputElement | null>(null)

  const closeMenu = () => {
    setOpen(false)
    setRenameId(null)
    setRenameDraft('')
    setCreating(false)
    setCreateDraft('')
    setError(null)
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        closeMenu()
      }
    }

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (renameId) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [renameId])

  useEffect(() => {
    if (creating) {
      createInputRef.current?.focus()
    }
  }, [creating])

  const data = workspacesQuery.data
  const workspaces = data?.workspaces ?? []
  const activeWorkspaceId = data?.activeWorkspaceId ?? null
  const activeWorkspace =
    workspaces.find((entry) => entry.id === activeWorkspaceId) ?? null

  const onSwitch = async (workspace: Workspace) => {
    if (workspace.id === activeWorkspaceId) {
      closeMenu()

      return
    }

    try {
      await setActiveWorkspace.mutateAsync(workspace.id)

      onSwitchWorkspace(workspace)
      closeMenu()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const startRename = (workspace: Workspace) => {
    setRenameId(workspace.id)
    setRenameDraft(workspace.name)
    setError(null)
  }

  const commitRename = async () => {
    if (!renameId) {
      return
    }

    const next = renameDraft.trim()
    const target = workspaces.find((entry) => entry.id === renameId)

    setRenameId(null)
    setRenameDraft('')

    if (!target || next.length === 0 || next === target.name) {
      return
    }

    try {
      await updateWorkspace.mutateAsync({
        workspaceId: target.id,
        name: next
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitRename()

      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setRenameId(null)
      setRenameDraft('')
    }
  }

  const onDelete = async (workspace: Workspace) => {
    setError(null)

    try {
      await deleteWorkspace.mutateAsync(workspace.id)
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause)
      // apiFetch wraps server errors as `API /path failed (409): {"error":"..."}`.
      // Pull the inner JSON message out so the popover can show a clean string.
      const match = raw.match(/\{.*\}$/)

      if (match) {
        try {
          const parsed = JSON.parse(match[0]) as { error?: string }

          setError(parsed.error ?? raw)

          return
        } catch {
          // fall through
        }
      }

      setError(raw)
    }
  }

  const startCreate = () => {
    setCreating(true)
    setCreateDraft('')
    setError(null)
  }

  const commitCreate = async () => {
    const next = createDraft.trim()

    if (next.length === 0) {
      setCreating(false)

      return
    }

    setCreating(false)
    setCreateDraft('')

    try {
      await createWorkspace.mutateAsync({ name: next })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onCreateKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitCreate()

      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setCreating(false)
      setCreateDraft('')
    }
  }

  return (
    <div
      ref={containerRef}
      style={noDragRegion}
      className="relative flex items-center self-center"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-7 max-w-[10rem] items-center gap-1 rounded-md border border-[color:var(--line)] px-2 text-[12px] text-[color:var(--fg)] hover:bg-[color:var(--bg-3)]',
          isOpen && 'bg-[color:var(--bg-3)]'
        )}
        title="Switch workspace"
      >
        <span className="truncate">{activeWorkspace?.name ?? '…'}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3 shrink-0 text-[color:var(--fg-3)]"
        />
      </button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 w-60 rounded-md border border-[color:var(--line)] bg-[color:var(--bg-2)] py-1 shadow-lg"
        >
          {workspaces.map((workspace) => {
            const isActive = workspace.id === activeWorkspaceId
            const isRenaming = workspace.id === renameId

            return (
              <div
                key={workspace.id}
                role="menuitem"
                className={cn(
                  'group flex items-center gap-1 px-2 py-1.5 text-[12px]',
                  isActive
                    ? 'text-[color:var(--fg)]'
                    : 'text-[color:var(--fg-2)] hover:bg-[color:var(--bg-3)]'
                )}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {isActive ? (
                    <Check
                      aria-hidden="true"
                      className="size-3 text-[color:var(--fg)]"
                    />
                  ) : null}
                </span>

                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={onRenameKeyDown}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-[color:var(--fg)] outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSwitch(workspace)}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {workspace.name}
                  </button>
                )}

                {!isRenaming ? (
                  <div className="ml-auto flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label="Rename workspace"
                      onClick={(event) => {
                        event.stopPropagation()
                        startRename(workspace)
                      }}
                      className="inline-flex size-5 items-center justify-center rounded-sm text-[color:var(--fg-4)] hover:bg-[color:var(--bg)] hover:text-[color:var(--fg)]"
                    >
                      <Pencil
                        aria-hidden="true"
                        className="size-3"
                      />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete workspace"
                      onClick={(event) => {
                        event.stopPropagation()
                        void onDelete(workspace)
                      }}
                      className="inline-flex size-5 items-center justify-center rounded-sm text-[color:var(--fg-4)] hover:bg-[color:var(--bg)] hover:text-[color:var(--destructive)]"
                    >
                      <Trash2
                        aria-hidden="true"
                        className="size-3"
                      />
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}

          <div className="my-1 h-px bg-[color:var(--line)]" />

          {creating ? (
            <div className="flex items-center gap-1 px-2 py-1.5 text-[12px]">
              <Plus
                aria-hidden="true"
                className="size-3 shrink-0 text-[color:var(--fg-3)]"
              />
              <input
                ref={createInputRef}
                value={createDraft}
                onChange={(event) => setCreateDraft(event.target.value)}
                onBlur={() => void commitCreate()}
                onKeyDown={onCreateKeyDown}
                placeholder="Workspace name"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-[color:var(--fg)] outline-none placeholder:text-[color:var(--fg-4)]"
              />
              <button
                type="button"
                aria-label="Cancel new workspace"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setCreating(false)
                  setCreateDraft('')
                }}
                className="inline-flex size-5 items-center justify-center rounded-sm text-[color:var(--fg-4)] hover:bg-[color:var(--bg)] hover:text-[color:var(--fg)]"
              >
                <X
                  aria-hidden="true"
                  className="size-3"
                />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startCreate}
              className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-[12px] text-[color:var(--fg-2)] hover:bg-[color:var(--bg-3)] hover:text-[color:var(--fg)]"
            >
              <span className="flex w-4 shrink-0 justify-center">
                <Plus
                  aria-hidden="true"
                  className="size-3"
                />
              </span>
              New workspace
            </button>
          )}

          {error ? (
            <div className="border-t border-[color:var(--line)] px-2 py-1.5 text-[11px] text-[color:var(--destructive)]">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
