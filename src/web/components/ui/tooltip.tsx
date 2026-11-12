import * as React from "react"
import { cn } from "@/lib/utils"
import { Tooltip as TooltipPrimitive } from "radix-ui"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

/**
 * Radix tooltips open on hover and focus only, so on a touch screen a status
 * chip whose meaning lives in its tooltip says nothing at all. A tap on a
 * trigger that does nothing else (a chip, not a button or link) toggles it.
 */
const TapToggle = React.createContext<(() => void) | null>(null)

function Tooltip({
  open,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [tapped, setTapped] = React.useState(false)
  const toggle = React.useCallback(() => setTapped((current) => !current), [])
  return (
    <TapToggle.Provider value={toggle}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        // Left uncontrolled (undefined) unless a tap opened it, so hover keeps
        // working exactly as before on a desktop.
        open={open ?? (tapped || undefined)}
        onOpenChange={(next) => {
          if (!next) setTapped(false)
          onOpenChange?.(next)
        }}
        {...props}
      />
    </TapToggle.Provider>
  )
}

function TooltipTrigger({
  onPointerDown,
  onClick,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const toggle = React.useContext(TapToggle)
  const touch = React.useRef(false)
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerDown={(event) => {
        touch.current = event.pointerType === "touch"
        onPointerDown?.(event)
      }}
      onClick={(event) => {
        onClick?.(event)
        const target = event.currentTarget as HTMLElement
        if (!touch.current || !toggle || target.closest("button, a, input, [role=button]")) return
        // preventDefault also stops Radix's own click handler, which would
        // close the tooltip straight after this opens it.
        event.preventDefault()
        // And keep the tap from reaching a clickable card underneath, which
        // would open GitHub instead of showing the explanation.
        event.stopPropagation()
        toggle()
      }}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
