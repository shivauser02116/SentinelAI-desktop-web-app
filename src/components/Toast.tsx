import { useSession } from '../state/useSession'

export function Toast() {
  const { toast, dismissToast } = useSession()
  if (!toast) return null
  return (
    <div
      role="status"
      className="fixed bottom-6 left-6 z-50 flex items-center gap-4 rounded-lg bg-brand px-4 py-3 text-sm text-white shadow-dialog"
    >
      <span>{toast.message}</span>
      {toast.href && (
        <a href={toast.href} onClick={dismissToast} className="font-semibold underline underline-offset-2">
          {toast.linkLabel}
        </a>
      )}
    </div>
  )
}
