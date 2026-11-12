import { Smartphone, TriangleAlert } from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { readToken } from '../lib/token.js'

/** Addresses that mean "this computer", which a phone would read as itself. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * A QR code of this dashboard's address with the token on it, so a phone can
 * sign in by pointing its camera at the screen instead of someone typing a
 * 64-character secret on glass.
 */
export function PhoneLinkButton() {
  const [open, setOpen] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const token = readToken() ?? ''
  const url = `${window.location.origin}/?t=${encodeURIComponent(token)}`
  const loopback = LOOPBACK.has(window.location.hostname)

  useEffect(() => {
    if (!open || loopback) return
    let live = true
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then((data) => {
        if (live) setQr(data)
      })
      .catch(() => setQr(null))
    return () => {
      live = false
    }
  }, [open, url, loopback])

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label="Open on your phone"
            onClick={() => setOpen(true)}
          >
            <Smartphone />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open on your phone</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Open on your phone</DialogTitle>
            <DialogDescription>
              Scan with the phone's camera. The code carries your shazam token, so it signs the
              phone in; keep it off shared screens.
            </DialogDescription>
          </DialogHeader>
          {loopback ? (
            <div className="flex gap-2 rounded-md border border-warning/50 p-3 text-sm text-amber-700 dark:text-warning">
              <TriangleAlert className="size-4 shrink-0 translate-y-0.5" />
              <p>
                This page is open at {window.location.host}, which a phone cannot reach. Set{' '}
                <code>host</code> to <code>0.0.0.0</code> and list this machine's address in{' '}
                <code>allowedOrigins</code> in <code>~/.shazam/config.json</code>, then open shazam
                at that address and come back here.
              </p>
            </div>
          ) : qr ? (
            <img
              src={qr}
              alt={`QR code for ${window.location.origin}`}
              className="mx-auto size-60 rounded-md bg-white"
            />
          ) : (
            <div className="mx-auto size-60 animate-pulse rounded-md bg-secondary" />
          )}
          <p className="text-center text-xs break-all text-muted-foreground">{window.location.origin}</p>
        </DialogContent>
      </Dialog>
    </>
  )
}
