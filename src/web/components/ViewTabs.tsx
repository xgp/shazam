import { ChevronDown, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ALL_VIEW_ID, BUILT_IN_VIEWS, type SavedView } from '../hooks/useSavedViews.js'

export interface ViewTabsProps {
  views: SavedView[]
  activeId: string
  /** True when the live filter/owners have drifted from what the view saved. */
  modified: boolean
  onSelect: (id: string) => void
  /** Save the current filter and owner selection under a new name. */
  onSave: (name: string) => void
  /** Overwrite the active view with the current filter and owner selection. */
  onUpdate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

const tabClass = (active: boolean) =>
  cn(
    'flex h-7 shrink-0 select-none items-center gap-1.5 rounded-md px-2.5 text-sm',
    active
      ? 'bg-accent font-medium text-accent-foreground'
      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
  )

/**
 * The saved-view tab row. Tabs are bookmarks over the filter state, so the
 * component owns no filter logic: it reports clicks and edits upward and App
 * applies them. Only the active tab grows a menu - the actions in it (update,
 * rename, delete) are all things you do to the view you are looking at.
 */
export function ViewTabs({
  views,
  activeId,
  modified,
  onSelect,
  onSave,
  onUpdate,
  onRename,
  onDelete,
}: ViewTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')

  const commitRename = (view: SavedView, raw: string) => {
    const name = raw.trim()
    if (name && name !== view.name) onRename(view.id, name)
    setRenamingId(null)
  }

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
      <button type="button" className={tabClass(activeId === ALL_VIEW_ID)} onClick={() => onSelect(ALL_VIEW_ID)}>
        All
      </button>

      {BUILT_IN_VIEWS.map((view) => (
        // A little slower than the board's other tooltips: these sit on a row
        // the pointer crosses on the way to the filter box.
        <Tooltip key={view.id} delayDuration={600}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={tabClass(activeId === view.id)}
              onClick={() => onSelect(view.id)}
            >
              {view.name}
              {activeId === view.id && modified ? (
                <span className="size-1.5 shrink-0 rounded-full bg-primary" />
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            {view.description}
            <span className="mt-0.5 block font-mono opacity-70">{view.q}</span>
          </TooltipContent>
        </Tooltip>
      ))}

      {views.map((view) => {
        const active = view.id === activeId
        return (
          <div key={view.id} className={tabClass(active)}>
            {renamingId === view.id ? (
              <input
                // Bare input, not the shadcn one: it has to sit inside the tab
                // at text size, not look like a form field.
                autoFocus
                defaultValue={view.name}
                aria-label="View name"
                className="w-24 bg-transparent text-sm outline-none"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename(view, event.currentTarget.value)
                  if (event.key === 'Escape') {
                    // Reset before blurring so the blur commit is a no-op.
                    event.currentTarget.value = view.name
                    event.currentTarget.blur()
                  }
                }}
                onBlur={(event) => commitRename(view, event.currentTarget.value)}
              />
            ) : (
              <button type="button" className="max-w-40 truncate" onClick={() => onSelect(view.id)}>
                {view.name}
              </button>
            )}

            {active && modified ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-primary"
                title="Filter changed since this view was saved"
              />
            ) : null}

            {active && renamingId !== view.id ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={`Actions for view ${view.name}`}>
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem disabled={!modified} onSelect={onUpdate}>
                    Update with current filter
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setRenamingId(view.id)}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(view.id)}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        )
      })}

      <Popover
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open)
          if (!open) setSaveName('')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label="Save current filter as a view"
          >
            <Plus />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-3">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const name = saveName.trim()
              if (!name) return
              onSave(name)
              setSaveOpen(false)
              setSaveName('')
            }}
          >
            <span className="text-sm font-medium">Save current filter as a view</span>
            <Input
              autoFocus
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              placeholder="View name"
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" disabled={!saveName.trim()}>
              Save
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  )
}
