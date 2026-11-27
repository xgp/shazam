import { useCallback, useState } from 'react'

/**
 * A saved view is a bookmark over the two filter mechanisms: the filter box
 * text and the owner-chip selection. It stores the query text verbatim rather
 * than a parsed form so what you saved is exactly what comes back.
 */
export interface SavedView {
  id: string
  name: string
  /** Filter box contents. */
  q: string
  /** Owner-chip selection. */
  owners: string[]
}

const VIEWS_KEY = 'shazam.views'
const ACTIVE_KEY = 'shazam.activeView'

/**
 * The built-in first tab: no filter, no owner selection. It is not stored,
 * so it can never be renamed, deleted, or drift out of shape.
 */
export const ALL_VIEW_ID = 'all'

/**
 * Built-in tabs after All, defined by filter terms (lib/filter.ts) and, like
 * All, never stored: they cannot be renamed, deleted or saved over.
 */
export const BUILT_IN_VIEWS: readonly (SavedView & { description: string })[] = [
  {
    id: 'builtin:needs-review',
    name: 'Needs review',
    q: 'is:needs-review',
    owners: [],
    description: 'Your open pull requests that nobody has approved yet (drafts left out)',
  },
  {
    id: 'builtin:approvable',
    name: 'Ready to approve',
    q: 'is:approvable',
    owners: [],
    description:
      "Others' pull requests you have not approved yet, with checks passing and no changes requested",
  },
  {
    id: 'builtin:mergeable',
    name: 'Ready to merge',
    q: 'is:mergeable',
    owners: [],
    description: 'Pull requests you can merge right now, with checks passing',
  },
]

const findView = (views: SavedView[], id: string | null) =>
  BUILT_IN_VIEWS.find((view) => view.id === id) ?? views.find((view) => view.id === id) ?? null

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(VIEWS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (v): v is SavedView =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as SavedView).id === 'string' &&
        typeof (v as SavedView).name === 'string' &&
        typeof (v as SavedView).q === 'string' &&
        Array.isArray((v as SavedView).owners),
    )
  } catch {
    return []
  }
}

/**
 * The active view's saved filter text, for App's initial query state: a fresh
 * load with no `?q=` in the URL resumes the view you had selected. Reads
 * storage directly because it runs before the hook has mounted.
 */
export function activeViewQuery(): string {
  try {
    const id = localStorage.getItem(ACTIVE_KEY)
    if (!id || id === ALL_VIEW_ID) return ''
    return findView(loadViews(), id)?.q ?? ''
  } catch {
    return ''
  }
}

export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(loadViews)
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY) ?? ALL_VIEW_ID
    } catch {
      return ALL_VIEW_ID
    }
  })

  const persist = useCallback((next: SavedView[]) => {
    setViews(next)
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(next))
    } catch {
      // storage disabled
    }
  }, [])

  const activate = useCallback((id: string) => {
    setActiveId(id)
    try {
      localStorage.setItem(ACTIVE_KEY, id)
    } catch {
      // storage disabled
    }
  }, [])

  // A stored id pointing at a deleted view falls back to All by lookup rather
  // than by validation, so a stale ACTIVE_KEY self-heals.
  const activeView = findView(views, activeId)

  const save = (name: string, q: string, owners: string[]) => {
    const view: SavedView = { id: crypto.randomUUID(), name, q, owners }
    persist([...views, view])
    activate(view.id)
  }

  const update = (id: string, q: string, owners: string[]) => {
    persist(views.map((view) => (view.id === id ? { ...view, q, owners } : view)))
  }

  const rename = (id: string, name: string) => {
    persist(views.map((view) => (view.id === id ? { ...view, name } : view)))
  }

  const remove = (id: string) => {
    persist(views.filter((view) => view.id !== id))
    if (id === activeId) activate(ALL_VIEW_ID)
  }

  return { views, activeId, activeView, activate, save, update, rename, remove }
}
