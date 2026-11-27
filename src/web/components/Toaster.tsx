import { CircleCheck, CircleX, Info, X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

type Tone = 'success' | 'error' | 'info'

interface Toast {
  id: number
  tone: Tone
  message: string
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {})

export const useToast = () => useContext(ToastContext)

const ICONS: Record<Tone, ReactNode> = {
  success: <CircleCheck className="size-4" />,
  error: <CircleX className="size-4" />,
  info: <Info className="size-4" />,
}

const COLORS: Record<Tone, string> = {
  success: 'border-success/50 text-emerald-700 dark:text-success',
  error: 'border-destructive/50 text-red-700 dark:text-red-400',
  info: 'border-primary/50 text-primary',
}

let nextId = 1

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (message: string, tone: Tone = 'info') => {
      const id = nextId++
      // Capped: a burst (a poll's worth of alerts, a flurry of actions) shows
      // its newest four rather than wallpapering the corner. Dropped toasts'
      // timers fire on nothing.
      setToasts((current) => [...current, { id, tone, message }].slice(-4))
      // Errors tend to carry gh output worth reading, so they linger.
      setTimeout(() => dismiss(id), tone === 'error' ? 12_000 : 5_000)
    },
    [dismiss],
  )

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Top center: clear of the header's refresh on the right and of the
          terminal dock's corner; newest at the top. */}
      <div className="fixed top-4 left-1/2 z-50 flex w-max max-w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 flex-col-reverse gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'flex cursor-pointer items-start gap-2 whitespace-pre-wrap rounded-lg border bg-card px-3 py-2 text-sm shadow-md',
              COLORS[toast.tone],
            )}
            onClick={() => dismiss(toast.id)}
          >
            <span className="mt-0.5 shrink-0">{ICONS[toast.tone]}</span>
            <span className="flex-1">{toast.message}</span>
            <X className="size-3.5 shrink-0 self-center opacity-40" />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
