// ─── Page loading fallback ──────────────────────────────────────────────────
// Shown during route-level auth resolution and React.lazy() chunk loads, in
// BOTH builds (customer App.tsx and the founder FounderApp). It lives here so
// the two bundles render the identical shell instead of each carrying a copy.
// Intentionally branded (not a bare spinner) — users bouncing off a blank
// page with a tiny loader read the app as "is this still working?" A small
// AcreOS moment with a subtle pulse keeps them oriented.
// `data-testid="app-loading"` is load-bearing for the mobile E2E contracts.
// They settle on `networkidle` — a NETWORK signal — which on WebKit fires while
// this shell is still up; they then measured the shell (innerText of exactly 34
// characters, on every WebKit device and five routes) and reported it as a
// blank route. The testid is the RENDER signal they wait to detach before
// measuring anything. Keep it stable.
export function PageLoader() {
  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center bg-background px-4"
      role="status"
      aria-label="Loading AcreOS"
      data-testid="app-loading"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-md">
            <span className="text-white font-bold text-xl">A</span>
          </div>
          <div
            className="absolute -inset-1 rounded-xl border-2 border-primary/30 animate-ping"
            aria-hidden="true"
          />
        </div>
        <p className="text-sm text-muted-foreground">Loading AcreOS…</p>
      </div>
    </div>
  );
}
