// Stale-build self-heal. Belt-and-suspenders on top of the service-worker
// update path in main.tsx. The SW logic is correct but only takes effect
// once a user is past the v6→v7 transition; for any future deploy where
// the SW, Cloudflare edge, or browser HTTP cache misbehaves, this catches
// the user and refreshes them onto the new build without manual cache
// clearing.
//
// Mechanism:
//   1. On boot, capture the bundled VITE_GIT_SHA.
//   2. Poll GET /api/version every POLL_MS while the tab is visible.
//   3. Re-poll immediately on visibilitychange (catches users returning
//      to a tab they left open overnight).
//   4. When the server SHA differs from the bundled SHA on TWO consecutive
//      checks (≥CONFIRM_GAP_MS apart), hard-reload. Two checks prevents a
//      reload during the brief window when one Fly machine has rolled and
//      the other hasn't.
//
// Workstream C — day-365 reliability (2026-05-29): the bare
// `window.location.reload()` would fire mid-mutation. A 200ms-after-bid
// deploy reload in CourthouseMode could nuke the page before the bid
// POST flushed — the user just lost a parcel they spent the morning on.
// We now check `queryClient.isMutating()` before reloading; if any
// mutation is in flight, we show a non-modal toast and re-check in
// RECHECK_WHILE_BUSY_MS. The reload happens the moment the mutation
// settles.

import { clientLogger } from "./clientLogger";
import { queryClient } from "./queryClient";
import { toast } from "@/hooks/use-toast";

const POLL_MS = 60_000;
const CONFIRM_GAP_MS = 30_000;
// How often to re-check when a reload is deferred because of an
// in-flight mutation. 5s tracks the spec — short enough that the user
// doesn't sit on stale code once their action settles, long enough
// that we don't busy-loop.
const RECHECK_WHILE_BUSY_MS = 5_000;

function getBundledSha(): string | null {
  const fromVite = (import.meta.env.VITE_GIT_SHA as string | undefined);
  const fromRuntime = ((window as unknown as { __ENV__?: { VITE_GIT_SHA?: string } }).__ENV__?.VITE_GIT_SHA);
  return fromVite || fromRuntime || null;
}

async function fetchServerSha(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("/api/version", {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { sha?: string };
    return body?.sha ?? null;
  } catch {
    return null;
  }
}

export function installVersionCheck(): void {
  const bundledSha = getBundledSha();
  if (!bundledSha || bundledSha === "unknown") return;

  let firstMismatchAt: number | null = null;
  let reloading = false;
  // We surface the "new version available" toast at most once per
  // session of waiting — re-showing it every 5s would be noise.
  let toastShown = false;
  // The deferred-reload timer. We clear it before scheduling another so
  // we don't queue overlapping reload attempts.
  let pendingReloadTimer: ReturnType<typeof setTimeout> | null = null;

  const performReload = (serverSha: string) => {
    reloading = true;
    clientLogger.info("[version-check] new build detected, reloading", {
      bundled: bundledSha,
      server: serverSha,
    });
    window.location.reload();
  };

  const attemptReload = (serverSha: string) => {
    if (reloading) return;
    // If any mutation is in flight, defer. A CourthouseMode bid POST, a
    // lead-update PUT, a wire-transfer confirmation — any of them in
    // flight means a reload right now could nuke uncommitted work.
    const inFlight = queryClient.isMutating();
    if (inFlight > 0) {
      if (!toastShown) {
        toast({
          title: "New version available",
          description: "We'll reload after your current action.",
          // Non-modal: no destructive variant, no action button. The
          // toast is informational — the reload happens on its own.
          duration: RECHECK_WHILE_BUSY_MS,
        });
        toastShown = true;
      }
      clientLogger.info(
        "[version-check] reload deferred — mutation in flight",
        { inFlight, bundled: bundledSha, server: serverSha }
      );
      // Re-check in 5s. The next tick will either find the cache
      // quiesced (reload immediately) or still mutating (defer again).
      if (pendingReloadTimer) clearTimeout(pendingReloadTimer);
      pendingReloadTimer = setTimeout(
        () => attemptReload(serverSha),
        RECHECK_WHILE_BUSY_MS
      );
      return;
    }
    performReload(serverSha);
  };

  const check = async () => {
    if (reloading) return;
    if (document.hidden) return;
    const serverSha = await fetchServerSha();
    if (!serverSha || serverSha === "unknown") {
      firstMismatchAt = null;
      return;
    }
    if (serverSha === bundledSha) {
      firstMismatchAt = null;
      return;
    }
    const now = Date.now();
    if (firstMismatchAt === null) {
      firstMismatchAt = now;
      return;
    }
    if (now - firstMismatchAt < CONFIRM_GAP_MS) return;

    attemptReload(serverSha);
  };

  setInterval(check, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void check();
  });
  // First check shortly after boot so a user who lands on a stale shell
  // doesn't have to wait a full minute.
  setTimeout(check, 5_000);
}
