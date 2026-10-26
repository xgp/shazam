import { useCallback, useEffect, useState } from 'react'

export type Appearance = 'light' | 'dark'

/** What you chose; `system` follows the OS, live. */
export type AppearancePreference = 'system' | Appearance

const KEY = 'shazam.theme'
/**
 * The old key held a resolved light/dark, written on every load - so the OS
 * setting at first visit was pinned forever. Dropped, so everyone starts on
 * `system`.
 */
const LEGACY_KEY = 'shazam.appearance'

const QUERY = '(prefers-color-scheme: dark)'

const osAppearance = (): Appearance => (window.matchMedia(QUERY).matches ? 'dark' : 'light')

function loadPreference(): AppearancePreference {
  try {
    localStorage.removeItem(LEGACY_KEY)
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // storage disabled
  }
  return 'system'
}

/** The order the header button steps through. */
const NEXT: Record<AppearancePreference, AppearancePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

export function useAppearance(): {
  appearance: Appearance
  preference: AppearancePreference
  cycle: () => void
} {
  const [preference, setPreference] = useState<AppearancePreference>(loadPreference)
  const [os, setOs] = useState<Appearance>(osAppearance)

  // Follow the OS as it changes - a scheduled dark mode at sunset included -
  // not just at load.
  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = () => setOs(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const appearance = preference === 'system' ? os : preference

  useEffect(() => {
    // Tailwind's dark variant keys off this class; color-scheme keeps the
    // browser's own chrome (scrollbars, form controls) in step.
    document.documentElement.classList.toggle('dark', appearance === 'dark')
    document.documentElement.style.colorScheme = appearance
  }, [appearance])

  const cycle = useCallback(() => {
    setPreference((current) => {
      const next = NEXT[current]
      try {
        // Only an explicit choice is stored; `system` is the absence of one.
        if (next === 'system') localStorage.removeItem(KEY)
        else localStorage.setItem(KEY, next)
      } catch {
        // storage disabled
      }
      return next
    })
  }, [])

  return { appearance, preference, cycle }
}
