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

function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return /(^|;\s*)__session=/.test(document.cookie);
}

export function installClerkSessionRecovery(): void {
  if (typeof window === "undefined") return;

  let reloadingClient = false;
  // STR-011: when Clerk.client.sessions empties mid-navigation (or after
  // ticket sign-in) but the __session cookie is still on the domain, force
  // the SDK to refetch environment + client and update its in-memory state.
  // Clerk-JS 6.7.4 exposes this as Clerk.__internal_reloadInitialResources;
  // it is the only public-ish path in this SDK version that calls both
  // Environment.fetch() and Client.getOrCreateInstance().fetch() and then
  // propagates the result via Clerk.updateClient / updateEnvironment so
  // React subscribers see the new session. Client.fetch() alone does not
  // update Clerk's in-memory state and leaves Clerk.session null.
  const reloadClientIfCookieAlive = async (): Promise<void> => {
    if (reloadingClient) return;
    const Clerk = (window as any).Clerk;
    if (!Clerk?.loaded) return;
    const sessions: unknown[] = Clerk.client?.sessions ?? [];
    if (sessions.length > 0) return;
    if (!hasSessionCookie()) return;
    reloadingClient = true;
    try {
      if (typeof Clerk.__internal_reloadInitialResources === "function") {
        await Clerk.__internal_reloadInitialResources();
      } else if (typeof Clerk.client?.fetch === "function") {
        // Fallback: refetch client only. Won't re-hydrate Clerk.session but
        // will at least refill Clerk.client.sessions for the promote step.
        await Clerk.client.fetch({ fetchMaxTries: 1 });
      } else if (typeof Clerk.load === "function") {
        await Clerk.load();
      }
    } catch {
      // best-effort; next listener tick will try again if appropriate
    } finally {
      // allow a retry in ~1s — long enough to not spin, short enough
      // that a user-visible loading state resolves quickly
      setTimeout(() => {
        reloadingClient = false;
      }, 1000);
    }
  };

  const promoteActiveIfNeeded = async (): Promise<void> => {
    const Clerk = (window as any).Clerk;
    if (!Clerk?.loaded) return;
    if (Clerk.session) return;
    const sessions: Array<{ id: string; status: string }> = Clerk.client?.sessions ?? [];
    if (sessions.length === 0) {
      // No in-memory sessions — if the cookie is alive, recover them.
      await reloadClientIfCookieAlive();
      return;
    }
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

  // STR-011: SPA route changes are the trigger we actually care about.
  // The History API doesn't fire events by default, so we hook pushState
  // / replaceState and popstate and run a recovery sweep on each change.
  const origPush = window.history.pushState;
  const origReplace = window.history.replaceState;
  const fireRecovery = (): void => {
    // Defer so the new route has a chance to paint before we check state.
    setTimeout(() => {
      void promoteActiveIfNeeded();
    }, 0);
  };
  window.history.pushState = function (...args: Parameters<typeof origPush>) {
    const r = origPush.apply(this, args);
    fireRecovery();
    return r;
  };
  window.history.replaceState = function (...args: Parameters<typeof origReplace>) {
    const r = origReplace.apply(this, args);
    fireRecovery();
    return r;
  };
  window.addEventListener("popstate", fireRecovery);
  // When tab regains focus after being backgrounded we also want to
  // re-check — background tabs can have their Clerk in-memory state GC'd.
  window.addEventListener("focus", fireRecovery);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fireRecovery();
  });
}
