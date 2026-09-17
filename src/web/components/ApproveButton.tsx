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
import type { PullRequestItem } from '../../shared/types.js'
import { api } from '../lib/api.js'
import { SplitActionButton } from './SplitActionButton.js'
import { useToast } from './Toaster.js'

export function ApproveButton({ pr, onDone }: { pr: PullRequestItem; onDone: () => void }) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const toast = useToast()

  const approve = async (comment?: string) => {
    setBusy(true)
    try {
      const result = await api.approve(pr.url, comment)
      toast(
        result.ok ? `Approved ${pr.repo.nameWithOwner}#${pr.number}` : result.message,
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

  return (
    <>
      <SplitActionButton
        label="Approve"
        color="green"
        primaryTooltip={`Approve #${pr.number} now, no comment`}
        busy={busy}
        cardAction="approve"
        onPrimary={() => void approve()}
        menu={[{ label: 'Approve with comment…', onSelect: () => setOpen(true) }]}
      />

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-[480px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve {pr.repo.nameWithOwner}#{pr.number}
            </AlertDialogTitle>
            <AlertDialogDescription>{pr.title}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="mt-2 flex flex-col gap-2">
            <span className="text-sm font-medium">Comment</span>
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="LGTM"
              rows={3}
              autoFocus
            />
          </div>

          <AlertDialogFooter className="mt-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              className="bg-success text-success-foreground hover:bg-success/90"
              disabled={busy}
              onClick={() => void approve(body)}
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              Approve
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
