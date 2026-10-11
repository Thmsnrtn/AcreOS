/**
 * Process-wide outbound guard. Imported FIRST by server/index.ts and
 * server/worker.ts, so it wraps globalThis.fetch before any module that could
 * fetch has loaded. Every fetch — fetchGeo, provider clients, ad-hoc calls —
 * passes through blockedOutboundSource() and a blocked URL is refused before
 * a socket opens (founder decision 2026-10-11; see
 * server/services/providers/blockedOutboundSources.ts).
 */
import { assertOutboundAllowed } from "./services/providers/blockedOutboundSources";

const GUARDED = Symbol.for("acreos.outboundGuard");

export function installOutboundGuard(target: { fetch: typeof fetch } = globalThis): void {
  const current = target.fetch as typeof fetch & { [GUARDED]?: true };
  if (!current || current[GUARDED]) return;
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assertOutboundAllowed(url);
    return current(input, init);
  }) as typeof fetch & { [GUARDED]?: true };
  guarded[GUARDED] = true;
  target.fetch = guarded;
}

installOutboundGuard();
