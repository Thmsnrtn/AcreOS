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

import { clientLogger } from "./clientLogger";

const POLL_MS = 60_000;
const CONFIRM_GAP_MS = 30_000;

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

    reloading = true;
    clientLogger.info("[version-check] new build detected, reloading", {
      bundled: bundledSha,
      server: serverSha,
    });
    window.location.reload();
  };

  setInterval(check, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void check();
  });
  // First check shortly after boot so a user who lands on a stale shell
  // doesn't have to wait a full minute.
  setTimeout(check, 5_000);
}
