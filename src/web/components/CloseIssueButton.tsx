import { Loader2 } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { IssueItem } from '../../shared/types.js'
import { api } from '../lib/api.js'
import { SplitActionButton } from './SplitActionButton.js'
import { useToast } from './Toaster.js'

export function CloseIssueButton({ issue, onDone }: { issue: IssueItem; onDone: () => void }) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const toast = useToast()

  const close = async (withComment?: string) => {
    setBusy(true)
    try {
      const result = await api.closeIssue(issue.url, withComment)
      toast(
        result.ok ? `Closed ${issue.repo.nameWithOwner}#${issue.number}` : result.message,
        result.ok ? 'success' : 'error',
      )
      if (result.ok) {
        setOpen(false)
        setComment('')
        onDone()
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SplitActionButton
        label="Close"
        color="gray"
        primaryTooltip={`Close #${issue.number} now, no comment`}
        busy={busy}
        cardAction="close"
        onPrimary={() => void close()}
        menu={[{ label: 'Close with comment…', onSelect: () => setOpen(true) }]}
      />

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-[480px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Close {issue.repo.nameWithOwner}#{issue.number}
            </AlertDialogTitle>
            <AlertDialogDescription>{issue.title}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-2 flex flex-col gap-2">
            <span className="text-sm font-medium">Closing comment</span>
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Fixed in #123"
              rows={3}
              autoFocus
            />
          </div>

          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={busy} onClick={() => void close(comment)}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              Close issue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
