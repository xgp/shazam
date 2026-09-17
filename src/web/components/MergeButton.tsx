import { Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  type BlockingMergeState,
  type MergeMethod,
  type PullRequestItem,
  mergeStateBlocks,
} from '../../shared/types.js'
import { api } from '../lib/api.js'
import { SplitActionButton } from './SplitActionButton.js'
import { useToast } from './Toaster.js'

const METHODS: { value: MergeMethod; label: string }[] = [
  { value: 'squash', label: 'Squash and merge' },
  { value: 'merge', label: 'Create a merge commit' },
  { value: 'rebase', label: 'Rebase and merge' },
]

const METHOD_LABEL: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Merge commit',
  rebase: 'Rebase and merge',
}

const MERGE_STATE_REASON: Record<BlockingMergeState, string> = {
  blocked: 'GitHub is blocking this merge - something a branch rule requires has not passed',
  behind: 'The branch is behind its base, which this branch requires it not to be',
  dirty: 'Has merge conflicts',
  draft: 'This pull request is still a draft',
}

/**
 * CI that is not green deliberately does not block. A run still in progress may
 * yet pass, and a red one that no branch rule requires is one GitHub merges
 * without complaint - which is the common case for a lint or preview job. What
 * decides is `mergeState`, GitHub's own answer to "would you take this merge",
 * so a check that genuinely stands in the way comes back as `blocked`. Short of
 * that the button stays live and warns.
 */
function blockedReason(pr: PullRequestItem): string | null {
  if (pr.isDraft) return 'This pull request is still a draft'
  // `none` passes: on a repo with no required-review rule GitHub merges
  // without an approval, and the button should match GitHub's answer.
  if (pr.reviewDecision === 'review_required') {
    return 'A review this repository requires has not happened yet'
  }
  if (pr.reviewDecision === 'changes_requested') return 'A reviewer has requested changes'
  if (pr.mergeable === 'conflicting') return 'Has merge conflicts'
  if (mergeStateBlocks(pr.mergeState)) return MERGE_STATE_REASON[pr.mergeState]
  if (pr.allowedMergeMethods.length === 0) {
    return 'This repository has every merge method disabled'
  }
  return null
}

/**
 * Repositories can switch individual merge methods off, and gh fails outright
 * when asked for one that is disabled ("squash merges aren't allowed on this
 * repository"). Honour the configured preference when the repo permits it and
 * otherwise fall back to whatever it does allow.
 */
function effectiveMethod(pr: PullRequestItem, preferred: MergeMethod): MergeMethod {
  if (pr.allowedMergeMethods.includes(preferred)) return preferred
  return pr.allowedMergeMethods[0] ?? preferred
}

export interface MergeButtonProps {
  pr: PullRequestItem
  /** From config; the primary click uses it without asking. */
  defaultMethod: MergeMethod
  onDone: () => void
}

export function MergeButton({ pr, defaultMethod, onDone }: MergeButtonProps) {
  const usableMethod = effectiveMethod(pr, defaultMethod)
  const [method, setMethod] = useState<MergeMethod>(usableMethod)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const toast = useToast()

  const merge = async (withMethod: MergeMethod, comment?: string) => {
    setBusy(true)
    try {
      const result = await api.merge(pr.url, withMethod, comment)
      toast(
        result.ok ? `Merged ${pr.repo.nameWithOwner}#${pr.number}` : result.message,
        result.ok ? 'success' : 'error',
      )
      if (result.ok) {
        setOpen(false)
        setBody('')
        onDone()
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  // Amber for anything CI has not signed off on - failing as well as running.
  // Neither blocks any more, so the button is what has to say so.
  const checksRunning = pr.checks === 'pending'
  const checksRed = pr.checks === 'failure'
  const warn = checksRunning || checksRed

  return (
    <>
      <SplitActionButton
        label="Merge"
        suffix={
          warn ? (
            <span className="font-bold" aria-hidden>
              {' !'}
            </span>
          ) : null
        }
        color={warn ? 'amber' : 'green'}
        primaryTooltip={
          warn
            ? `${checksRed ? 'Checks are failing' : 'Checks are still running'}, but no branch rule requires them - ${METHOD_LABEL[usableMethod].toLowerCase()} #${pr.number} anyway`
            : `${METHOD_LABEL[usableMethod]} #${pr.number} now`
        }
        busy={busy}
        blockedReason={blockedReason(pr)}
        onPrimary={() => void merge(usableMethod)}
        menu={[
          {
            label: 'Merge with comment…',
            onSelect: () => {
              setMethod(usableMethod)
              setOpen(true)
            },
          },
        ]}
      />

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-[480px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Merge {pr.repo.nameWithOwner}#{pr.number}
            </AlertDialogTitle>
            <AlertDialogDescription>{pr.title}</AlertDialogDescription>
          </AlertDialogHeader>

          {warn ? (
            <Alert className="border-warning/50 bg-warning/10 text-amber-700 dark:text-warning">
              <TriangleAlert />
              <AlertDescription className="text-amber-700 dark:text-warning">
                {checksRed
                  ? 'CI checks are failing on this pull request. No branch rule requires them, so GitHub will take the merge.'
                  : 'CI checks are still running on this pull request.'}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="mt-2 flex flex-col gap-2">
            <span className="text-sm font-medium">Method</span>
            <Select value={method} onValueChange={(v) => setMethod(v as MergeMethod)}>
              <SelectTrigger className="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.filter((m) => pr.allowedMergeMethods.includes(m.value)).map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-1 flex flex-col gap-2">
            <span className="text-sm font-medium">Commit message body</span>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Why this is going in"
              rows={3}
              autoFocus
            />
          </div>

          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              className="bg-success text-success-foreground hover:bg-success/90"
              disabled={busy}
              onClick={() => void merge(method, body)}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              Merge
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
