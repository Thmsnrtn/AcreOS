/**
 * Clerk session-recovery safety net.
 *
 * Two failure modes this handles:
 *
 * 1) Post-ticket hydration gap: after a ticket-based sign-in (OAuth
 *    callback, magic link, E2E signin-token), Clerk ends up with an
 *    active session in `Clerk.client.sessions` but `Clerk.session`
 *    itself is null. ProtectedRoute hangs on a loading spinner forever.
 *
 * 2) Navigation-time session loss (STR-011): on SPA navigations within
 *    the authenticated shell, `Clerk.client.sessions` occasionally
 *    empties even though the `__session` cookie is still on the domain
 *    and the server accepts it. We observe `Clerk.client.sessions`
 *    going from `[{id, active}]` → `[]` on route change, then refilling
 *    a moment later. Without intervention the SPA freezes on "Loading
 *    page" during the gap.
 *
 * Strategy: run a one-shot init sweep, then subscribe to `Clerk.addListener`
 * so every subsequent change to `client.sessions` re-checks and promotes
 * the first active session if no `session` is selected. No-op in the
 * happy path. Safe because we only promote sessions Clerk itself
 * already decided are valid.
 */

export function installClerkSessionRecovery(): void {
  if (typeof window === "undefined") return;

  const promoteActiveIfNeeded = async (): Promise<void> => {
    const Clerk = (window as any).Clerk;
    if (!Clerk?.loaded) return;
    if (Clerk.session) return;
    const sessions: Array<{ id: string; status: string }> = Clerk.client?.sessions ?? [];
    const active = sessions.find((s) => s.status === "active") ?? sessions[0];
    if (!active) return;
    try {
      await Clerk.setActive({ session: active.id });
    } catch {
      // best-effort
    }
  };

  let listenerInstalled = false;
  const installListener = (): void => {
    if (listenerInstalled) return;
    const Clerk = (window as any).Clerk;
    if (!Clerk?.addListener) return;
    Clerk.addListener(() => {
      void promoteActiveIfNeeded();
    });
    listenerInstalled = true;
  };

  // Initial sweep: poll while Clerk bootstraps, try to recover + install
  // the listener as soon as Clerk is loaded. Stop after 10s.
  const started = Date.now();
  const tick = async (): Promise<void> => {
    const Clerk = (window as any).Clerk;
    if (Clerk?.loaded) {
      await promoteActiveIfNeeded();
      installListener();
    }
    if (!listenerInstalled && Date.now() - started < 10_000) {
      setTimeout(tick, 200);
    }
  };
  void tick();
}
