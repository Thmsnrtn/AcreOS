/**
 * Founder Autopilot — Hand registry entrypoint (Hands roadmap P0.1).
 *
 * Importing this module runs the registration side-effects for every hand. The
 * dispatch executor imports this once so that, by the time a tool call lands,
 * the registry is populated.
 *
 * Phase 0 registers NOTHING — the registry stays empty and the whole hand
 * surface is inert. Later phases add `import "./send-email";` lines here (each
 * hand module self-registers at import time).
 */
export {
  getHand,
  isHandName,
  listHandSpecs,
  listHandSchemas,
  registerHand,
} from "./registry";
export type { HandSpec, HandResult, HandContext, HandSchema, HandHandler } from "./types";

// ── Registered hands ────────────────────────────────────────────────────────
// (Phase 1+ append `import "./<hand>";` here; each self-registers.)
