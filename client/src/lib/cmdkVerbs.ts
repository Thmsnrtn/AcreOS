/**
 * ⌘K v2 verb registry — types, loaded-shape guard and loading hook.
 *
 * The 30 PALETTE_VERBS data records themselves live in
 * client/src/data/cmdk-verbs-data.ts (the source of truth) and ship to
 * the browser as the served asset /palette-verbs.json instead of
 * riding inside the bundle as JS (the BD-6 / legal-docs / #680
 * pattern). This module stays bundled: it carries only the record
 * types, the boundary guard and the hook the command palette consumes.
 * Client code must not value-import the data module — that would pull
 * the records back into the bundle (tests/unit/
 * staticDataServedAsData.test.ts pins both the asset==module equality
 * and the no-rebundle rule).
 *
 * Shape guard (the #716 D-2 mandate, landing-copy precedent): the
 * loaded value is validated here before the palette ranks it. A
 * wrong-shape 200 — a truncated deploy, a stale asset, a hand-edited
 * JSON — flows into the same visible load-error path as a failed
 * fetch, never into the matcher as a malformed record that would
 * crash or silently mis-rank.
 */

import { useEffect, useState } from "react";
import {
  loadStaticData,
  PALETTE_VERBS_URL,
  type StaticDataState,
} from "@/lib/static-data";

export type VerbScope = "leads" | "deals" | "properties" | "inbox" | "settings" | "global";

export interface PaletteVerb {
  id: string;
  label: string;
  /** Optional one-liner shown under the label. */
  hint?: string;
  path: string;
  keywords: readonly string[];
  scope: VerbScope;
  /** lucide-react icon name. */
  iconKey:
    | "UserPlus"
    | "Home"
    | "FileText"
    | "ListTodo"
    | "Mail"
    | "Sparkles"
    | "MessageSquare"
    | "Send"
    | "TrendingUp"
    | "Search"
    | "Phone"
    | "CheckCircle"
    | "DollarSign"
    | "Archive"
    | "Trash2"
    | "Upload"
    | "Download"
    | "Settings"
    | "RefreshCw"
    | "Building2"
    | "Handshake"
    | "Tag"
    | "ClipboardList"
    | "Filter"
    | "Users";
}

const VERB_SCOPES: readonly string[] = [
  "leads",
  "deals",
  "properties",
  "inbox",
  "settings",
  "global",
];

const VERB_ICON_KEYS: readonly string[] = [
  "UserPlus",
  "Home",
  "FileText",
  "ListTodo",
  "Mail",
  "Sparkles",
  "MessageSquare",
  "Send",
  "TrendingUp",
  "Search",
  "Phone",
  "CheckCircle",
  "DollarSign",
  "Archive",
  "Trash2",
  "Upload",
  "Download",
  "Settings",
  "RefreshCw",
  "Building2",
  "Handshake",
  "Tag",
  "ClipboardList",
  "Filter",
  "Users",
];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isStr);

/**
 * The boundary check for the served verb registry: a non-empty array
 * of well-formed records (every field the palette reads is the right
 * type; scope and iconKey name known values). Anything else is a load
 * error.
 */
export function isPaletteVerbs(v: unknown): v is PaletteVerb[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (verb) =>
        isRecord(verb) &&
        isStr(verb.id) &&
        isStr(verb.label) &&
        (verb.hint === undefined || isStr(verb.hint)) &&
        isStr(verb.path) &&
        isStrArray(verb.keywords) &&
        isStr(verb.scope) &&
        VERB_SCOPES.includes(verb.scope) &&
        isStr(verb.iconKey) &&
        VERB_ICON_KEYS.includes(verb.iconKey),
    )
  );
}

/**
 * The palette verbs for the command palette: `data` is null while the
 * asset is in flight; `error` is true on a failed fetch OR a
 * wrong-shape asset — the palette renders its shell plus a visible
 * error line, never a silently verb-less palette (the static-data
 * discipline).
 */
export function usePaletteVerbs(): StaticDataState<readonly PaletteVerb[]> {
  const [state, setState] = useState<StaticDataState<readonly PaletteVerb[]>>({
    data: null,
    error: false,
  });
  useEffect(() => {
    let live = true;
    loadStaticData<unknown>(PALETTE_VERBS_URL).then(
      (raw) => {
        if (!live) return;
        if (isPaletteVerbs(raw)) {
          setState({ data: raw, error: false });
        } else {
          setState({ data: null, error: true });
        }
      },
      () => {
        if (live) setState({ data: null, error: true });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
