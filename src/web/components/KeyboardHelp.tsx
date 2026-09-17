import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const SHORTCUTS: [keys: string[], what: string][] = [
  [['/'], 'Focus the filter'],
  [['Esc'], 'Clear the filter'],
  [['j', 'k'], 'Next / previous card'],
  [['↑', '↓'], 'Card above / below in the column'],
  [['←', '→'], 'Same row in the next column over'],
  [['Enter', 'o'], 'Open the selected card on GitHub'],
  [['r', 's', 'm', 'a', 'c'], 'Reviewers / Shazam / Merge / Approve / Close it'],
  [['?'], 'These shortcuts'],
]

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border bg-secondary px-1.5 py-0.5 font-mono text-xs text-secondary-foreground">
      {children}
    </kbd>
  )
}

/**
 * The `?` overlay. It owns its own key listener and open state: nothing else
 * on the board needs to know whether help is showing.
 */
export function KeyboardHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return
      // Same guard as the board keys: '?' in the filter box is a search for a
      // question mark, not a call for help.
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, [contenteditable="true"], .xterm')) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Keys work anywhere outside a text field.</DialogDescription>
        </DialogHeader>
        <dl className="flex flex-col gap-2.5">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={what} className="flex items-center justify-between gap-4">
              <dt className="text-sm">{what}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {keys.map((key) => (
                  <Key key={key}>{key}</Key>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
