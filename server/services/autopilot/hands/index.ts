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
  executeHandWitnessed,
} from "./registry";
export type { HandSpec, HandResult, HandContext, HandSchema, HandHandler } from "./types";

// ── Registered hands ────────────────────────────────────────────────────────
// Each module self-registers at import time. Importing this index runs them all.
import "./send-email";
import "./send-sms";
import "./send-push";
import "./send-letter";
import "./dunning-action";
import "./apply-refund";
import "./run-ad-campaign";

// ── Registered ad providers (step-away gap #7) ──────────────────────────────
// The Meta adapter self-registers into the adProvider seam. Without a linked
// Meta connection it degrades to the same honest draft-only result as before;
// with one, witnessed executions create REAL campaigns — always PAUSED, the
// founder activates in Ads Manager.
import "../adProviders/metaAdProvider";
