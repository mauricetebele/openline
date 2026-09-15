/**
 * Guard for reprinting a shipping label. Checks the Label Print History; if the
 * order's label was printed before, shows a confirm dialog with the last-printed
 * timestamp and returns the user's choice. Returns true (proceed) when there's no
 * prior print or the check fails (never block a first/legitimate print on error).
 *
 * Call at the top of any label-print handler:
 *   if (!(await confirmReprint(orderId))) return
 */
export async function confirmReprint(orderId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/label-print-info?id=${encodeURIComponent(orderId)}`)
    if (!res.ok) return true
    const info = await res.json() as { count?: number; lastPrintedAt?: string | null }
    if ((info.count ?? 0) > 0 && info.lastPrintedAt) {
      const ts = new Date(info.lastPrintedAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
      })
      return window.confirm(`This label was previously printed at:\n${ts}\n\nAre you sure you want to print it again?`)
    }
  } catch { /* check failed — don't block printing */ }
  return true
}
