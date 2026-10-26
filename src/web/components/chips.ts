/**
 * Chip and small-button color recipes, shared so every green/amber/red surface
 * on the dashboard says the same thing. Soft fills are a pastel wash of the
 * theme's success/warning/destructive tokens with a strong foreground; light
 * mode borrows darker Tailwind foregrounds where the token itself is too light
 * for small text, and dark mode uses the tokens directly, which are tuned for
 * dark backgrounds.
 */

export type ChipColor = 'green' | 'blue' | 'red' | 'amber' | 'orange' | 'violet' | 'gray'

/** Colors that exist only as soft chips, not as solid fills or buttons. */
type ChipOnlyColor = 'orange' | 'blue' | 'violet'

export const CHIP_SOFT: Record<ChipColor, string> = {
  green: 'bg-success/15 text-emerald-700 dark:bg-success/15 dark:text-success',
  blue: 'bg-primary/15 text-blue-700 dark:bg-primary/15 dark:text-primary',
  red: 'bg-destructive/10 text-red-700 dark:bg-destructive/15 dark:text-red-400',
  amber: 'bg-warning/15 text-amber-700 dark:bg-warning/15 dark:text-warning',
  orange: 'bg-orange-500/15 text-orange-700 dark:bg-orange-400/15 dark:text-orange-400',
  violet: 'bg-violet-500/15 text-violet-700 dark:bg-violet-400/15 dark:text-violet-400',
  gray: 'bg-secondary text-muted-foreground',
}

/** Solid fills, for the dock's session-status badges. */
export const CHIP_SOLID: Record<Exclude<ChipColor, ChipOnlyColor>, string> = {
  green: 'bg-success text-success-foreground',
  red: 'bg-destructive text-white',
  amber: 'bg-warning text-warning-foreground',
  gray: 'bg-muted-foreground text-background',
}

/** Soft action buttons (Radix's variant="soft"), hover a shade deeper. */
export const BUTTON_SOFT: Record<Exclude<ChipColor, ChipOnlyColor>, string> = {
  green:
    'bg-success/15 text-emerald-700 hover:bg-success/25 hover:text-emerald-700 dark:bg-success/15 dark:text-success dark:hover:bg-success/25 dark:hover:text-success',
  red: 'bg-destructive/10 text-red-700 hover:bg-destructive/20 hover:text-red-700 dark:bg-destructive/15 dark:text-red-400 dark:hover:bg-destructive/25 dark:hover:text-red-400',
  amber:
    'bg-warning/15 text-amber-700 hover:bg-warning/25 hover:text-amber-700 dark:bg-warning/15 dark:text-warning dark:hover:bg-warning/25 dark:hover:text-warning',
  gray: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:text-secondary-foreground',
}
