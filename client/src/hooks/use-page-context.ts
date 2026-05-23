/**
 * usePageContext — resolves the current wouter location + URL params
 * to the `pageContext` shape the founder-chat stream understands.
 *
 * The shape mirrors the server-side `BuildContextOpts` in
 * server/services/founder-chat/context-resolver.ts so Atlas can answer
 * "what are you looking at?" without the user spelling out the entity.
 *
 * Patterns handled (kept in sync with PATH_RESOLVERS on the server):
 *   /founder/inspector/org/:id           → { currentOrgId }
 *   /founder/inspector/cost-event/:id    → { currentLedgerEventId }
 *   /founder/inspector/provider/:name    → { currentProviderName }
 *   /founder/studio/:tab?                → { currentDialCategory }
 *   /outreach/mail/shipment/:id          → { currentShipmentId }
 *
 * The hook also accepts an optional manual override so the Dock can be
 * forced into a particular context (e.g. a "Discuss with Atlas" affordance
 * that pre-supplies the entity).
 */
import { useMemo } from "react";
import { useLocation } from "wouter";

export interface PageContext {
  currentPath?: string;
  currentOrgId?: number;
  currentShipmentId?: number;
  currentLedgerEventId?: number;
  currentProviderName?: string;
  currentDialCategory?: string;
}

interface PathResolver {
  pattern: RegExp;
  resolve: (match: RegExpMatchArray) => Partial<PageContext>;
}

// Keep the regex set in lockstep with server/services/founder-chat/context-resolver.ts.
// The server is authoritative — the client just sends hints; if these
// patterns diverge, the worst case is a missing hint, not a wrong one.
const PATH_RESOLVERS: readonly PathResolver[] = [
  {
    pattern: /^\/founder\/inspector\/org\/(\d+)/,
    resolve: (m) => ({ currentOrgId: Number(m[1]) }),
  },
  {
    pattern: /^\/founder\/inspector\/cost-event\/(\d+)/,
    resolve: (m) => ({ currentLedgerEventId: Number(m[1]) }),
  },
  {
    pattern: /^\/founder\/inspector\/provider\/([a-zA-Z0-9_-]+)/,
    resolve: (m) => ({ currentProviderName: m[1].toLowerCase() }),
  },
  {
    pattern: /^\/founder\/studio\/?([a-zA-Z0-9_-]*)/,
    resolve: (m) => (m[1] ? { currentDialCategory: m[1] } : {}),
  },
  {
    pattern: /^\/outreach\/mail\/shipment\/(\d+)/,
    resolve: (m) => ({ currentShipmentId: Number(m[1]) }),
  },
];

/**
 * Pure helper — exported separately so tests can exercise it without
 * mounting React. Mirror of the server-side resolvePathHints.
 */
export function resolvePageContext(currentPath: string | undefined): PageContext {
  if (!currentPath) return {};
  const ctx: PageContext = { currentPath };
  for (const r of PATH_RESOLVERS) {
    const m = currentPath.match(r.pattern);
    if (m) {
      Object.assign(ctx, r.resolve(m));
      break;
    }
  }
  return ctx;
}

export function usePageContext(override?: Partial<PageContext>): PageContext {
  const [location] = useLocation();
  return useMemo(() => {
    const resolved = resolvePageContext(location);
    return { ...resolved, ...override };
  }, [location, override]);
}
