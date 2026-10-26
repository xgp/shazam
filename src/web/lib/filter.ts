import type { CheckState, DashboardItem, ReviewDecision } from '../../shared/types.js'

/**
 * The filter box's query language, GitHub-search style: space-separated terms
 * that all have to hold, each one either a bare word matched against the text
 * of a row or a `key:value` qualifier matched against a specific field, and
 * either kind negated with a leading `-`. Parsing and matching are pure
 * functions over strings and DTOs so they can be unit-tested without a DOM.
 */

const QUALIFIERS = ['repo', 'owner', 'author', 'label', 'is', 'checks', 'review', 'state'] as const

export type Qualifier = (typeof QUALIFIERS)[number]

export interface FilterTerm {
  /** `null` is a bare word, matched against the row's visible text. */
  key: Qualifier | null
  /** Lowercased; every match in this module is case-insensitive. */
  value: string
  negated: boolean
}

export interface FilterQuery {
  terms: FilterTerm[]
}

/** Friendlier spellings for the `checks:` qualifier than the DTO's states. */
const CHECK_VALUES: Record<string, CheckState> = {
  passing: 'success',
  failing: 'failure',
  pending: 'pending',
  none: 'none',
}

/** Same idea for `review:` - `changes` beats typing `changes_requested`. */
const REVIEW_VALUES: Record<string, ReviewDecision> = {
  approved: 'approved',
  changes: 'changes_requested',
  required: 'review_required',
  none: 'none',
}

/**
 * Split on whitespace, except inside double quotes, which group words into one
 * term and then disappear: `label:"needs triage"` and `"two words"` are each a
 * single token by the time term parsing sees them.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote
    } else if (!inQuote && /\s/.test(ch)) {
      if (current) tokens.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

function parseTerm(raw: string): FilterTerm | null {
  let negated = false
  let body = raw
  // A lone "-" is someone mid-keystroke, not a negation of nothing.
  if (body === '-') return null
  if (body.startsWith('-')) {
    negated = true
    body = body.slice(1)
  }
  const colon = body.indexOf(':')
  if (colon > 0) {
    const key = body.slice(0, colon).toLowerCase()
    if ((QUALIFIERS as readonly string[]).includes(key)) {
      const value = body.slice(colon + 1).toLowerCase()
      // "repo:" with nothing after it is a qualifier still being typed.
      // Dropping it keeps the board from blanking out on every keystroke.
      if (!value) return null
      return { key: key as Qualifier, value, negated }
    }
  }
  // Unknown keys fall through as free text of the whole token, so a title
  // that happens to contain a colon is still findable by pasting it in.
  return { key: null, value: body.toLowerCase(), negated }
}

export function parseFilter(input: string): FilterQuery {
  const terms: FilterTerm[] = []
  for (const token of tokenize(input)) {
    const term = parseTerm(token)
    if (term) terms.push(term)
  }
  return { terms }
}

/** Whether one term holds for one row, before negation is applied. */
function termMatches(item: DashboardItem, term: FilterTerm): boolean {
  const pr = item.kind === 'pull_request' ? item : null
  const value = term.value
  switch (term.key) {
    case null:
      return (
        item.title.toLowerCase().includes(value) ||
        item.repo.nameWithOwner.toLowerCase().includes(value) ||
        `#${item.number}`.includes(value)
      )
    case 'repo':
      return (
        item.repo.name.toLowerCase().includes(value) ||
        item.repo.nameWithOwner.toLowerCase().includes(value)
      )
    case 'owner':
      return item.repo.owner.toLowerCase() === value
    case 'author':
      return (item.author ?? '').toLowerCase() === value
    case 'label':
      // PRs carry no labels in the DTO, so a label qualifier never picks one.
      return item.kind === 'issue' && item.labels.some((l) => l.name.toLowerCase().includes(value))
    case 'is':
      if (value === 'pr') return item.kind === 'pull_request'
      if (value === 'issue') return item.kind === 'issue'
      if (value === 'draft') return pr !== null && pr.isDraft
      if (value === 'merged') return pr !== null && pr.mergedAt !== null
      // Everything else on the board is open; accepted so a pasted GitHub query works.
      if (value === 'open') return pr === null || pr.mergedAt === null
      return false
    case 'checks':
      return pr !== null && pr.checks === CHECK_VALUES[value]
    case 'review':
      return pr !== null && pr.reviewDecision === REVIEW_VALUES[value]
    case 'state':
      return pr !== null && pr.mergeState === value
  }
}

/** True when the row survives the filter. An empty query keeps everything. */
export function matchesFilter(item: DashboardItem, query: FilterQuery): boolean {
  return query.terms.every((term) => termMatches(item, term) !== term.negated)
}
