/**
 * Clerk session-recovery safety net.
 *
 * After a ticket-based sign-in (OAuth callback, magic link, or E2E
 * signin-token flow) Clerk sometimes ends up with a session in
 * Clerk.client.sessions whose status is "active" but Clerk.session is
 * still null — the session is known but not selected as the active one.
 * In that state the SPA's ProtectedRoute shows an infinite "Loading
 * page" spinner because useAuth's isSignedIn stays false.
 *
 * This recovery watches Clerk.loaded. Once Clerk is loaded, if there's
 * an inactive active session and no selected session, we call setActive
 * to promote it. No-op in the happy path. Safe because we only promote
 * sessions Clerk itself already decided are valid.
 */

export function installClerkSessionRecovery(): void {
  if (typeof window === "undefined") return;

  const tryRecover = async (): Promise<boolean> => {
    const Clerk = (window as any).Clerk;
    if (!Clerk?.loaded) return false;
    if (Clerk.session) return true; // already active
    const sessions = Clerk.client?.sessions ?? [];
    const active = sessions.find((s: any) => s.status === "active");
    if (!active) return true; // nothing to recover
    try {
      await Clerk.setActive({ session: active.id });
    } catch {
      // best-effort — don't throw
    }
    return true;
  };

  // Poll briefly while Clerk is initializing. Stop after 20 * 250ms = 5s
  // or when we either promote a session or confirm there's nothing to do.
  let attempts = 0;
  const MAX_ATTEMPTS = 20;
  const tick = async () => {
    if (attempts++ >= MAX_ATTEMPTS) return;
    const done = await tryRecover();
    if (!done) setTimeout(tick, 250);
  };
  tick();
}
