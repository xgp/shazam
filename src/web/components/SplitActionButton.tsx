import { ChevronDown, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { BUTTON_SOFT } from './chips.js'

type ButtonColor = keyof typeof BUTTON_SOFT

export interface SplitActionButtonProps {
  label: string
  /** Rendered after the label, for a state marker like a pending-checks "!". */
  suffix?: ReactNode
  color: ButtonColor
  /** Shown on the primary half, which acts immediately with no confirmation. */
  primaryTooltip: string
  busy?: boolean
  /** When set the button is inert and the text explains why. */
  blockedReason?: string | null
  /**
   * Stamped on the primary half as data-card-action, so the board's single-key
   * shortcuts can find and click this button on the selected card. The caret
   * half stays untagged: a shortcut always means the primary action.
   */
  cardAction?: string
  onPrimary: () => void
  menu: { label: string; onSelect: () => void }[]
}

/**
 * The primary half commits straight away - these are all reversible on GitHub,
 * and a confirmation on every one made the common path slow. Anything that
 * wants a comment first lives behind the caret.
 */
export function SplitActionButton({
  label,
  suffix,
  color,
  primaryTooltip,
  busy,
  blockedReason,
  cardAction,
  onPrimary,
  menu,
}: SplitActionButtonProps) {
  if (blockedReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Tagged even though inert: the shortcut handler checks disabled
              itself, and finding a disabled button beats finding nothing. */}
          <Button size="xs" className={cn('text-sm', BUTTON_SOFT.gray)} disabled data-card-action={cardAction}>
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{blockedReason}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="xs"
            className={cn('rounded-r-none text-sm', BUTTON_SOFT[color])}
            disabled={busy}
            data-card-action={cardAction}
            onClick={onPrimary}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {label}
            {suffix}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{primaryTooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="xs"
            className={cn('ml-px rounded-l-none px-1', BUTTON_SOFT[color])}
            disabled={busy}
            aria-label={`More ${label.toLowerCase()} options`}
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {menu.map((item) => (
            <DropdownMenuItem key={item.label} onSelect={item.onSelect}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
