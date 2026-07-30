/**
 * Founder Readiness Ladder — the founder's OWN onboarding, derived from
 * measured state (founder ask, 2026-07-30).
 *
 * There is exactly ONE founder: the platform owner running AcreOS as a
 * business. (Customers running their own land/note/rental operations are never
 * "founders" here.) This module answers a different question from
 * stepAwayReadiness ("can I leave right now?") — it answers "what do I still
 * have to SET UP, in what order, and what does each thing buy me?"
 *
 * Four rules shape the whole design:
 *
 *   1. MEASURED, NEVER DECLARED. Every rung asks the system a real question:
 *      does this secret actually resolve (DB connection first, env second)? did
 *      Stripe actually return a sellable price? did a mail shipment actually
 *      reach status 'sent' while the live-send interlock was armed? does the
 *      GitHub Actions secret with that exact NAME actually exist? There is no
 *      hardcoded "done" anywhere in this file.
 *
 *   2. NOTHING IS DONE UNTIL IT IS DONE. A rung whose state cannot be
 *      determined reports `unverifiable` WITH THE REASON — never `done`, never
 *      a hopeful default. This is the same discipline as the dormant-watchdog
 *      pattern in Controls ("NOTHING is presented as armed until it actually
 *      is") and the refuse-not-fabricate rule.
 *
 *   3. EACH RUNG TEACHES. `unlocks` (what the autopilot starts doing),
 *      `costs` (what it costs), `ifItLapses` (what breaks). The founder should
 *      come out of this more capable, not merely compliant.
 *
 *   4. IT CONSUMES ITSELF. Done rungs DROP OUT of `rungs` (they survive as
 *      `completed`, collapsed). As trust is granted, `operating` fills with
 *      what the machine now does unattended and `nextHandover` names the next
 *      thing it could take over. A setup surface that persisted forever would
 *      contradict the four-door doctrine — the more the autopilot operates the
 *      business, the LESS of this should be left.
 *
 * Never throws. Every rung is independently fail-soft.
 */
import { logger } from "../../utils/logger";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * `done`         — measured true.
 * `not_done`     — measured false (we know it isn't set up).
 * `blocked`      — measured false AND a prerequisite rung isn't done yet.
 * `unverifiable` — could not be determined. NEVER rendered as done.
 */
export type RungState = "done" | "not_done" | "blocked" | "unverifiable";

export type RungStage = "foundation" | "rails" | "safety" | "handover";

export const RUNG_STAGES: readonly RungStage[] = ["foundation", "rails", "safety", "handover"] as const;

export const STAGE_TITLE: Record<RungStage, string> = {
  foundation: "Foundation — it can think, and it can reach you",
  rails: "Rails — it can charge, write, mail and look things up",
  safety: "Safety net — it is watched from outside, and bounded",
  handover: "Handover — what you let it do without you",
};

/** Static teaching + dependency shape of a rung. Never carries state. */
export interface RungSpec {
  key: string;
  stage: RungStage;
  /** CEO-plain title. */
  title: string;
  /** What the autopilot starts DOING once this is real. */
  unlocks: string;
  /** What it costs, in plain words. null = costs nothing. */
  costs: string | null;
  /** What breaks if it lapses (key revoked, card declines, trial ends). */
  ifItLapses: string;
  /** Rungs that must be done first. Empty = independent. */
  dependsOn: string[];
  /** Critical rungs gate the ladder verdict. */
  critical: boolean;
  /** Where the fix lives. */
  href: string;
}

export interface FounderRung extends RungSpec {
  state: RungState;
  /** What was actually measured, or exactly why it couldn't be. */
  evidence: string;
  /** The concrete next action. Absent when done. */
  action?: string;
  /** Prerequisite keys not yet done (populated for `blocked`). */
  waitingOn: string[];
}

export interface FounderReadinessLadder {
  /** Rungs still to do, dependency-ordered. Done rungs are NOT here. */
  rungs: FounderRung[];
  /** Rungs already done — kept so nothing is lost, but out of the way. */
  completed: Array<{ key: string; title: string; evidence: string }>;
  doneCount: number;
  totalCount: number;
  /** Rungs whose state could not be determined. */
  unverifiableCount: number;
  /** Critical rungs not yet done. */
  criticalOpenCount: number;
  /** The single highest-value next action. null when nothing is left. */
  nextStep: { key: string; title: string; action: string; href: string } | null;
  /** ONE line for The Letter. Always safe to render verbatim. */
  letterLine: string;
  /** What the machine now does unattended, from the real Trust Ledger. */
  operating: string[];
  /** The next autonomy the founder could grant, with its real evidence. */
  nextHandover: { domain: string; from: string; to: string; evidence: string } | null;
  /** True when every rung is done — the ladder has consumed itself. */
  complete: boolean;
}

// ── Rung catalogue (teaching + dependencies only — never state) ───────────────

const CONTROLS = "/founder/autopilot/control";

export const RUNG_SPECS: readonly RungSpec[] = [
  // ── Foundation ────────────────────────────────────────────────────────────
  {
    key: "brain",
    stage: "foundation",
    title: "Give it a brain",
    unlocks:
      "Every autopilot cycle: reading the business, writing the daily letter, drafting outreach, grading its own decisions. Without a model key it cannot think at all — the loop runs and produces nothing.",
    costs: "Metered per token. Bounded by the monthly agent budget on this page — the cap fails CLOSED, so it cannot overspend even if a prompt misbehaves.",
    ifItLapses:
      "Every dispatch refuses. The letter goes silent, drafts stop being produced, and the Story shows refusals instead of actions.",
    dependsOn: [],
    critical: true,
    href: CONTROLS,
  },
  {
    key: "reach_you",
    stage: "foundation",
    title: "Give it a way to reach you",
    unlocks:
      "Incident pages to your phone with automatic email fallback. This is the rung that makes every LATER rung safe: autonomy you cannot be paged about is autonomy you cannot supervise.",
    costs: "Free (ntfy is a public push topic; email rides the system mail lane).",
    ifItLapses:
      "Incidents become invisible until you next open the app. A stalled loop, a blown budget or a failed deploy would wait for you to notice.",
    dependsOn: [],
    critical: true,
    href: CONTROLS,
  },
  {
    key: "public_address",
    stage: "foundation",
    title: "Tell it its own public address",
    unlocks:
      "Working links in every outbound thing: Stripe webhooks, e-mail links, the QR code printed on mail, ad landing pages. It is a prerequisite for billing and mail, not cosmetic.",
    costs: null,
    ifItLapses:
      "Webhooks land nowhere, mail QR codes point at localhost, and signup links in outreach are dead.",
    dependsOn: [],
    critical: true,
    href: CONTROLS,
  },

  // ── Rails ─────────────────────────────────────────────────────────────────
  {
    key: "billing",
    stage: "rails",
    title: "Let it get paid",
    unlocks:
      "Subscription checkout, dunning recovery, refunds — the only money AcreOS is ever a party to. (Customer-managed money movement never touches this account: that runs on the customer's OWN connected processor, by standing decision.)",
    costs: "Stripe's per-charge fee on real revenue. Nothing until a customer actually pays.",
    ifItLapses:
      "No one can subscribe and renewals fail silently. A missing webhook secret is the quiet version: payments succeed at Stripe but the app never learns, so entitlements drift.",
    dependsOn: ["public_address"],
    critical: true,
    href: CONTROLS,
  },
  {
    key: "system_mail",
    stage: "rails",
    title: "Let it send system mail",
    unlocks:
      "Receipts, the daily letter by email, and the email half of paging. System mail only — counterparty mail always rides the org's OWN connected identity, by standing decision.",
    costs: "Fractions of a cent per message.",
    ifItLapses:
      "Receipts stop, the letter can only be read in-app, and paging loses its fallback channel — leaving push as a single point of failure.",
    dependsOn: [],
    critical: true,
    href: CONTROLS,
  },
  {
    key: "mail_rail",
    stage: "rails",
    title: "Put real mail in the post",
    unlocks:
      "Physical letters and postcards to landowners, with per-piece delivery tracking and a QR code that attributes replies back to the piece that earned them.",
    costs: "Roughly $0.60–$1.30 per piece, drawn against the monthly outreach stop-loss line.",
    ifItLapses:
      "Queued shipments refuse rather than print. If the LIVE arm switch is off, mail is rendered and validated but nothing is ever printed — which is deliberate, and is why this rung needs a real send to count.",
    dependsOn: ["public_address"],
    critical: false,
    href: CONTROLS,
  },
  {
    key: "data_plane",
    stage: "rails",
    title: "Let it look parcels up",
    unlocks:
      "Owner, valuation and parcel-geometry lookups behind the provider registry — the inputs to scoring, offers and parcel reports. Free federal sources already work; these are the paid tiers above them.",
    costs: "Metered per lookup, deducted as credits and cached where the license permits re-serving.",
    ifItLapses:
      "The registry falls back to free sources and refuses the enriched fields rather than guessing them — nothing fabricates, but coverage narrows.",
    dependsOn: [],
    critical: false,
    href: CONTROLS,
  },

  // ── Safety net ────────────────────────────────────────────────────────────
  {
    key: "github",
    stage: "safety",
    title: "Connect the code host",
    unlocks:
      "Two things at once: the immune system can open patch-only security pull requests for your review, and this app can verify the live site is actually running the newest code instead of trusting a deploy log.",
    costs: null,
    ifItLapses:
      "Security advisories are still watched, but fixes wait for you by hand, and release freshness becomes unverifiable from inside the product.",
    dependsOn: [],
    critical: false,
    href: CONTROLS,
  },
  {
    key: "watchdogs",
    stage: "safety",
    title: "Arm the watchdogs outside the app",
    unlocks:
      "Three checks that run on the code host's computers, NOT on AcreOS: a morning pulse text, an outside-in uptime probe, and an hourly stale-release alarm. They keep working when AcreOS itself is dark — which is exactly when you need them.",
    costs: null,
    ifItLapses:
      "You lose the only monitoring that survives an AcreOS outage. An app that is down cannot tell you it is down.",
    dependsOn: ["github"],
    critical: false,
    href: CONTROLS,
  },
  {
    key: "spend_line",
    stage: "safety",
    title: "Draw the spending line",
    unlocks:
      "A monthly mail+data stop-loss and a monthly agent budget, both of which fail CLOSED: when spend can't be read, outreach pauses rather than continuing blind.",
    costs: null,
    ifItLapses:
      "Nothing overspends — the gates refuse instead — but the machine parks itself, so a broken ledger reads as a silent slowdown.",
    dependsOn: [],
    critical: true,
    href: CONTROLS,
  },

  // ── Handover ──────────────────────────────────────────────────────────────
  {
    key: "first_trust",
    stage: "handover",
    title: "Let one part act",
    unlocks:
      "The first real handover. Every part of the company starts at watching-only; lifting one to drafting or acting is what turns the autopilot from an observer into an operator. Safety gates stay on at every level, and hard-stops always ask you.",
    costs: null,
    ifItLapses:
      "You pull it back to watching-only in one tap and it stops acting immediately — this rung is fully reversible, which is why it is safe to try early.",
    dependsOn: ["brain", "reach_you"],
    critical: false,
    href: CONTROLS,
  },
  {
    key: "delegation",
    stage: "handover",
    title: "Let it tap for you, inside bounds",
    unlocks:
      "Outward actions normally freeze waiting for your tap. A bounded, expiring, revocable grant lets the machine tap FOR you inside explicit limits — so work continues while you're away instead of queueing up.",
    costs: "Whatever the grant's own cost and action limits allow, and not a cent more.",
    ifItLapses:
      "Actions go back to freezing until you return. Nothing is lost, it just waits. Money and broadcasts stay yours unless a grant explicitly opts in.",
    dependsOn: ["first_trust"],
    critical: false,
    href: CONTROLS,
  },
  {
    key: "unattended",
    stage: "handover",
    title: "Let it run the whole business",
    unlocks:
      "Every part of the company acting end-to-end through its safety gates. This is the last rung: once it's done, this whole ladder disappears and Controls goes back to being switches.",
    costs: null,
    ifItLapses:
      "One tap on the emergency stop returns everything to watching-only, with a receipt.",
    dependsOn: ["delegation"],
    critical: false,
    href: CONTROLS,
  },
] as const;

// ── Measurement helpers ──────────────────────────────────────────────────────

interface Measurement {
  /** true = done, false = not done, null = could not determine. */
  ok: boolean | null;
  evidence: string;
  action?: string;
}

function cannotVerify(why: string): Measurement {
  return {
    ok: null,
    evidence: `Can't verify: ${why}. Nothing is shown as done on a hope.`,
    action: "Resolve the reason above, then re-check — this rung will not go green until it can actually be read.",
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Probe modules ────────────────────────────────────────────────────────────
//
// The ladder reads eight different subsystems. They are pulled in DYNAMICALLY
// rather than with static imports for one hard reason: `server/db.ts` throws at
// import time when DATABASE_URL is unset, and `RUNG_SPECS` must stay importable
// without a database (the placement ratchet reads the catalogue, and the rung
// catalogue is pure data).
//
// They are also resolved ONE AT A TIME, up front, instead of inside each
// measurement. Module resolution is serialized; the MEASUREMENTS still run
// concurrently. Three reasons:
//
//   1. Each module is imported exactly once per build, so no rung pays a second
//      module-init cost and no two imports of the same module are ever in
//      flight at once (concurrent dynamic imports of one module are exactly the
//      kind of nondeterminism that makes a "measured" surface unreproducible).
//   2. A module that cannot be loaded at all is attributed to precisely the
//      rungs that read it — they report `unverifiable` with the loader's real
//      error, and every other rung is untouched.
//   3. The load order is fixed, so the same world always produces the same
//      ladder.

/** A probe module resolved once, or the exact reason it could not be. */
type Loaded<T> = { readonly mod: T; readonly error: null } | { readonly mod: null; readonly error: string };

async function loadProbe<T>(what: string, importer: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { mod: await importer(), error: null };
  } catch (err) {
    logger.warn(
      `[founderReadinessLadder] ${what} could not be loaded; the rungs that read it will report unverifiable`,
      err instanceof Error ? err : undefined,
    );
    return { mod: null, error: errText(err) };
  }
}

/** A rung whose own probe module never loaded cannot be measured at all. */
function loaderFailed(what: string, error: string): Measurement {
  return cannotVerify(`${what} couldn't be loaded (${error})`);
}

type ConnectionsProbe = Loaded<
  Pick<typeof import("../connections/platformConnections"), "resolveConnection" | "resolveGithubCredentials">
>;
type StripeProbe = Loaded<Pick<typeof import("../../stripeService"), "stripeService">>;
type InterlockProbe = Loaded<Pick<typeof import("../mail/liveSendInterlock"), "isLiveSendArmed">>;
type MailLedgerProbe = Loaded<{
  db: (typeof import("../../db"))["db"];
  mailShipments: (typeof import("@shared/schema/finance"))["mailShipments"];
  sql: (typeof import("drizzle-orm"))["sql"];
}>;
type StopLossProbe = Loaded<Pick<typeof import("../outreachStopLoss"), "getOutreachStopLossStatus">>;
type CapProbe = Loaded<Pick<typeof import("../solene/capitalTracker"), "getEnsembleCapStatus">>;
type GrantsProbe = Loaded<Pick<typeof import("../autopilot/witnessGrantStore"), "liveGrantsFor">>;
type AutonomyProbe = Loaded<Pick<typeof import("../autopilot/domainAutonomy"), "getTrustLedger">>;

interface Probes {
  connections: ConnectionsProbe;
  stripe: StripeProbe;
  interlock: InterlockProbe;
  mailLedger: MailLedgerProbe;
  stopLoss: StopLossProbe;
  cap: CapProbe;
  grants: GrantsProbe;
  autonomy: AutonomyProbe;
}

async function loadProbes(): Promise<Probes> {
  const connections = await loadProbe("the connections hub", () => import("../connections/platformConnections"));
  const stripe = await loadProbe("the Stripe client", () => import("../../stripeService"));
  const interlock = await loadProbe("the live-send interlock", () => import("../mail/liveSendInterlock"));
  const mailLedger = await loadProbe("the mail ledger", async () => {
    const { db } = await import("../../db");
    const { mailShipments } = await import("@shared/schema/finance");
    const { sql } = await import("drizzle-orm");
    return { db, mailShipments, sql };
  });
  const stopLoss = await loadProbe("the outreach stop-loss", () => import("../outreachStopLoss"));
  const cap = await loadProbe("the agent budget", () => import("../solene/capitalTracker"));
  const grants = await loadProbe("the delegation store", () => import("../autopilot/witnessGrantStore"));
  const autonomy = await loadProbe("the trust ledger", () => import("../autopilot/domainAutonomy"));
  return { connections, stripe, interlock, mailLedger, stopLoss, cap, grants, autonomy };
}

/**
 * Resolve a connections-hub field, DB-first with env fallback, WITHOUT ever
 * returning the value. Throws on failure so the caller can report
 * `unverifiable` instead of guessing "missing".
 */
async function fieldSource(
  hub: Pick<typeof import("../connections/platformConnections"), "resolveConnection">,
  provider: string,
  field: string,
): Promise<"db" | "env" | "missing"> {
  return (await hub.resolveConnection(provider, field)).source;
}

function envSet(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function sourceWord(source: "db" | "env" | "missing"): string {
  return source === "db" ? "connected in-app" : source === "env" ? "set as a server secret" : "not set";
}

// ── Per-rung measurements ────────────────────────────────────────────────────

async function measureBrain(c: ConnectionsProbe): Promise<Measurement> {
  if (c.error !== null) return loaderFailed("the connections hub", c.error);
  try {
    const openrouter = await fieldSource(c.mod, "openrouter", "api_key");
    const anthropic = await fieldSource(c.mod, "anthropic", "api_key");
    if (openrouter === "missing" && anthropic === "missing") {
      return {
        ok: false,
        evidence: "No model key resolves — neither the routed layer nor the direct model is connected, so no dispatch can run.",
        action: "Open Connections below and paste an OpenRouter key (one key covers the routed layer). It's live immediately — no redeploy.",
      };
    }
    const which = [
      openrouter !== "missing" ? `routed layer ${sourceWord(openrouter)}` : null,
      anthropic !== "missing" ? `direct model ${sourceWord(anthropic)}` : null,
    ].filter(Boolean).join("; ");
    return { ok: true, evidence: `A model key resolves (${which}).` };
  } catch (err) {
    return cannotVerify(`the connections layer wouldn't answer (${errText(err)})`);
  }
}

async function measureReachYou(c: ConnectionsProbe): Promise<Measurement> {
  if (c.error !== null) return loaderFailed("the connections hub", c.error);
  try {
    const topic = await fieldSource(c.mod, "paging", "topic");
    const email = await fieldSource(c.mod, "paging", "founder_email");
    if (topic === "missing" && email === "missing") {
      return {
        ok: false,
        evidence: "NO page channel resolves. An incident right now would be invisible until you next opened the app.",
        action: "Connections → Paging: a long private push topic plus your email. Two independent channels, two minutes.",
      };
    }
    if (topic === "missing") {
      return {
        ok: false,
        evidence: `Email fallback resolves (${sourceWord(email)}) but push does not — pages would arrive by email only.`,
        action: "Add the private push topic under Connections → Paging so critical pages hit your phone.",
      };
    }
    if (email === "missing") {
      return {
        ok: false,
        evidence: `Push resolves (${sourceWord(topic)}) but there is no email fallback — a single push outage could silence a critical page.`,
        action: "Add your email under Connections → Paging so every failed push falls back to your inbox.",
      };
    }
    return { ok: true, evidence: `Two independent channels resolve: push (${sourceWord(topic)}) with email fallback (${sourceWord(email)}).` };
  } catch (err) {
    return cannotVerify(`the connections layer wouldn't answer (${errText(err)})`);
  }
}

function measurePublicAddress(): Measurement {
  const raw = process.env.APP_URL?.trim() ?? "";
  if (!raw) {
    return {
      ok: false,
      evidence: "APP_URL is not set, so every generated link falls back to a guess.",
      action: "Set APP_URL to the production origin (fly secrets set APP_URL=\"https://acreos.io\").",
    };
  }
  if (/localhost|127\.0\.0\.1/.test(raw)) {
    return {
      ok: false,
      evidence: "APP_URL still points at localhost — outbound links would be unreachable to anyone but you.",
      action: "Point APP_URL at the production origin.",
    };
  }
  if (!/^https:\/\//.test(raw)) {
    return {
      ok: false,
      evidence: "APP_URL is set but is not https — Stripe will refuse the webhook endpoint and mail QR links would be insecure.",
      action: "Use the https origin for APP_URL.",
    };
  }
  return { ok: true, evidence: `APP_URL is an https production origin (${raw}).` };
}

async function measureBilling(c: ConnectionsProbe, s: StripeProbe): Promise<Measurement> {
  if (c.error !== null) return loaderFailed("the connections hub", c.error);
  let keySource: "db" | "env" | "missing";
  try {
    keySource = await fieldSource(c.mod, "stripe", "secret_key");
  } catch (err) {
    return cannotVerify(`the connections layer wouldn't answer (${errText(err)})`);
  }
  if (keySource === "missing") {
    return {
      ok: false,
      evidence: "No Stripe secret key resolves — nobody can subscribe.",
      action: "Connections → Stripe: paste the secret key, then Verify (the check calls Stripe's balance endpoint for real).",
    };
  }
  const webhook = envSet("STRIPE_WEBHOOK_SECRET");
  // A sellable price is the only proof the account is actually set up for
  // business. Ask Stripe; if Stripe won't answer, say so rather than guess.
  if (s.error !== null) return loaderFailed("the Stripe client", s.error);
  let priceCount: number | null = null;
  try {
    const products = await s.mod.stripeService.listProductsWithPrices();
    priceCount = products.reduce((n, p) => n + (p.prices?.length ?? 0), 0);
  } catch (err) {
    return cannotVerify(
      `the Stripe key ${sourceWord(keySource)}, but Stripe wouldn't list products (${errText(err)}) — a key that can't be used is not a working billing rail`,
    );
  }
  if (priceCount === 0) {
    return {
      ok: false,
      evidence: `Stripe answered with the key ${sourceWord(keySource)}, but there are ZERO active prices — checkout has nothing to sell.`,
      action: "Create a subscription product with at least one active price in the Stripe dashboard.",
    };
  }
  if (!webhook) {
    return {
      ok: false,
      evidence: `Stripe works (${priceCount} active price${priceCount === 1 ? "" : "s"}) but STRIPE_WEBHOOK_SECRET is not set — payments would succeed at Stripe while this app never learns, so entitlements drift silently.`,
      action: "Set STRIPE_WEBHOOK_SECRET from the Stripe dashboard's webhook endpoint (this is the quiet failure worth fixing before launch).",
    };
  }
  return {
    ok: true,
    evidence: `Stripe answered with the key ${sourceWord(keySource)}: ${priceCount} active price${priceCount === 1 ? "" : "s"}, and the webhook signing secret is set.`,
  };
}

function measureSystemMail(): Measurement {
  const id = envSet("AWS_ACCESS_KEY_ID");
  const secret = envSet("AWS_SECRET_ACCESS_KEY");
  const from = envSet("AWS_SES_FROM_EMAIL");
  const missing = [!id ? "AWS_ACCESS_KEY_ID" : null, !secret ? "AWS_SECRET_ACCESS_KEY" : null, !from ? "AWS_SES_FROM_EMAIL" : null].filter(
    (x): x is string => x !== null,
  );
  if (missing.length > 0) {
    return {
      ok: false,
      evidence: `The system mail lane is incomplete — ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`,
      action: `Set ${missing.join(" + ")} as server secrets, then send yourself the break-glass card from this page to prove the lane end-to-end.`,
    };
  }
  return { ok: true, evidence: "Credentials and a verified from-address are set for the system mail lane." };
}

async function measureMailRail(c: ConnectionsProbe, i: InterlockProbe, m: MailLedgerProbe): Promise<Measurement> {
  if (c.error !== null) return loaderFailed("the connections hub", c.error);
  let live: "db" | "env" | "missing";
  let test: "db" | "env" | "missing";
  try {
    live = await fieldSource(c.mod, "lob", "live_key");
    test = await fieldSource(c.mod, "lob", "test_key");
  } catch (err) {
    return cannotVerify(`the connections layer wouldn't answer (${errText(err)})`);
  }
  if (live === "missing" && test === "missing") {
    return {
      ok: false,
      evidence: "No mail-provider key resolves — a queued shipment would refuse instead of printing.",
      action: "Connections → Lob: paste the test key first (it renders and validates without printing), then the live key when you're ready.",
    };
  }

  if (i.error !== null) return loaderFailed("the live-send interlock", i.error);
  let armed: boolean;
  try {
    armed = i.mod.isLiveSendArmed();
  } catch (err) {
    return cannotVerify(`the live-send interlock wouldn't report its state (${errText(err)})`);
  }

  // Has a piece ACTUALLY shipped? Rendering in test mode prints nothing, so a
  // sent shipment only counts as real mail while the interlock is armed.
  if (m.error !== null) {
    return cannotVerify(`the mail ledger couldn't be loaded, so I can't tell whether a piece ever actually shipped (${m.error})`);
  }
  let sentShipments: number;
  try {
    const { db, mailShipments, sql } = m.mod;
    const rows = await db.select({ id: mailShipments.id }).from(mailShipments).where(sql`${mailShipments.status} = 'sent'`);
    sentShipments = rows.length;
  } catch (err) {
    return cannotVerify(`the mail ledger wouldn't answer, so I can't tell whether a piece ever actually shipped (${errText(err)})`);
  }

  if (!armed) {
    return {
      ok: false,
      evidence:
        sentShipments > 0
          ? `A key resolves and ${sentShipments} shipment${sentShipments === 1 ? " has" : "s have"} reached 'sent', but the live arm switch is OFF — those were rendered and validated, NOT printed. Nothing has physically mailed.`
          : "A key resolves, but the live arm switch is OFF: mail is rendered and validated and nothing is ever printed. No piece has shipped.",
      action:
        "This is deliberate — the app cannot arm itself. Set LOB_LIVE_SEND_ENABLED=true as a server secret in production when you're ready for real postage.",
    };
  }
  if (sentShipments === 0) {
    return {
      ok: false,
      evidence: "The rail is armed and a live key resolves, but no shipment has reached 'sent' yet — the path is untested end-to-end.",
      action: "Send one real piece to yourself. A rail that has never carried anything is a hypothesis.",
    };
  }
  return {
    ok: true,
    evidence: `Armed, live key ${sourceWord(live !== "missing" ? live : test)}, and ${sentShipments} shipment${sentShipments === 1 ? " has" : "s have"} actually shipped.`,
  };
}

async function measureDataPlane(): Promise<Measurement> {
  // Deliberately env-only: these are platform data keys, not connections-hub
  // providers, so there is no in-app path to set them.
  const attom = envSet("ATTOM_API_KEY");
  const regrid = envSet("REGRID_API_KEY");
  if (!attom && !regrid) {
    return {
      ok: false,
      evidence: "Neither paid parcel source has a key — the registry runs on free federal sources only and refuses the enriched fields rather than guessing them.",
      action: "Set ATTOM_API_KEY and/or REGRID_API_KEY as server secrets. Start with one; the registry picks by category and priority.",
    };
  }
  if (!attom || !regrid) {
    return {
      ok: false,
      evidence: `Only one paid source is keyed (${attom ? "valuation/owner" : "parcel geometry"}); the other is not set, so that category falls back to free sources.`,
      action: `Set ${attom ? "REGRID_API_KEY" : "ATTOM_API_KEY"} to close the remaining gap — or leave it deliberately and accept the narrower coverage.`,
    };
  }
  // HONEST GAP: nothing in this codebase records a trial start or expiry for
  // either vendor, and neither API exposes one on a free endpoint. Presence is
  // knowable; remaining trial life is NOT — so say so instead of implying the
  // key will keep working.
  return {
    ok: true,
    evidence:
      "Both paid parcel sources are keyed. Note: no trial or expiry date is recorded anywhere in this system and neither vendor exposes one, so a lapse will first show up as lookups failing — not as a warning here.",
  };
}

async function measureGithub(c: ConnectionsProbe): Promise<Measurement> {
  if (c.error !== null) return loaderFailed("the connections hub", c.error);
  try {
    const { token, repository } = await c.mod.resolveGithubCredentials();
    if (!token && !repository) {
      return {
        ok: false,
        evidence: "No code-host credentials resolve — self-patching can't open a pull request and release freshness can't be verified from in here.",
        action: "Connections → GitHub: a personal access token plus owner/name.",
      };
    }
    if (!token || !repository) {
      return {
        ok: false,
        evidence: `Half-connected: ${token ? "the token resolves but the repository is not set" : "the repository is set but no token resolves"}.`,
        action: `Add the missing half under Connections → GitHub (${token ? "repository, as owner/name" : "a personal access token"}).`,
      };
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
      return {
        ok: false,
        evidence: `The repository value isn't in owner/name form, so every code-host call would fail.`,
        action: "Fix the repository field under Connections → GitHub — it must read owner/name.",
      };
    }
    return { ok: true, evidence: `Token and repository both resolve (${repository}).` };
  } catch (err) {
    return cannotVerify(`the connections layer wouldn't answer (${errText(err)})`);
  }
}

/**
 * The four secret NAMES the external watchdog workflows read. Names only —
 * this never reads, logs or transmits a secret value.
 */
export const WATCHDOG_SECRET_NAMES = [
  "NTFY_TOPIC",
  "UPTIME_PROBE_URL",
  "UPTIME_PROBE_TOKEN",
  "DEPLOY_ALERT_WEBHOOK",
] as const;

async function measureWatchdogs(c: ConnectionsProbe): Promise<Measurement> {
  if (c.error !== null) return loaderFailed("the connections hub", c.error);
  let token: string | null = null;
  let repository: string | null = null;
  try {
    const creds = await c.mod.resolveGithubCredentials();
    token = creds.token;
    repository = creds.repository;
  } catch (err) {
    return cannotVerify(`the connections layer wouldn't answer (${errText(err)})`);
  }
  if (!token || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    return cannotVerify(
      "the watchdogs run on the code host's computers and this app has no way to read their secrets without a connected code host",
    );
  }
  let names: string[];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(`https://api.github.com/repos/${repository}/actions/secrets?per_page=100`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return cannotVerify(
        `the code host refused to list the workflow secret NAMES (HTTP ${res.status}) — the token likely lacks repository-administration scope`,
      );
    }
    const body = (await res.json()) as { secrets?: Array<{ name?: string }> };
    names = (body.secrets ?? []).map((s) => s.name ?? "").filter(Boolean);
  } catch (err) {
    return cannotVerify(`the code host wouldn't answer (${errText(err)})`);
  }
  const present = new Set(names);
  const missing = WATCHDOG_SECRET_NAMES.filter((n) => !present.has(n));
  if (missing.length === 0) {
    return {
      ok: true,
      evidence: `All four workflow secrets exist by name (${WATCHDOG_SECRET_NAMES.join(", ")}). Names verified, values never read. The final proof is still your phone: this morning's pulse line should have arrived.`,
    };
  }
  return {
    ok: false,
    evidence: `${missing.length} of ${WATCHDOG_SECRET_NAMES.length} workflow secrets are MISSING (${missing.join(", ")}), so the watchdogs that depend on them are dormant — not armed.`,
    action: `Set them on the repository (gh secret set ${missing[0]} --body "…"), then run the workflow once by hand so it proves itself.`,
  };
}

async function measureSpendLine(sl: StopLossProbe, cp: CapProbe): Promise<Measurement> {
  if (sl.error !== null) return loaderFailed("the outreach stop-loss", sl.error);
  if (cp.error !== null) return loaderFailed("the agent budget", cp.error);
  let stopLoss: { lineCents: number; mtdSpendCents: number | null; paused: boolean; reason: string };
  try {
    stopLoss = await sl.mod.getOutreachStopLossStatus();
  } catch (err) {
    return cannotVerify(`the outreach stop-loss wouldn't report its state (${errText(err)})`);
  }
  let cap: { monthToDateUsd: number; capUsd: number; readFailed: boolean };
  try {
    cap = await cp.mod.getEnsembleCapStatus();
  } catch (err) {
    return cannotVerify(`the agent budget wouldn't report its state (${errText(err)})`);
  }
  if (stopLoss.mtdSpendCents === null || cap.readFailed) {
    return {
      ok: false,
      evidence: `Spend is UNREADABLE, so the gates have failed CLOSED: ${stopLoss.reason}. Nothing can overspend, but the machine is parked.`,
      action: "Check database health — the gates reopen on their own the moment spend is readable again.",
    };
  }
  const lineUsd = Math.round(stopLoss.lineCents / 100);
  const mtdUsd = (stopLoss.mtdSpendCents / 100).toFixed(2);
  if (stopLoss.paused) {
    return {
      ok: false,
      evidence: `Both lines are drawn ($${lineUsd}/mo mail+data, $${cap.capUsd}/mo agent) but outreach is PAUSED right now: ${stopLoss.reason}`,
      action: "Look at the month's charges in Costs, then tap “I've looked — resume” to release the pause for this month.",
    };
  }
  // Both lines READ cleanly. That is not the same as both lines METERING.
  // A meter sitting at exactly $0.00 is the one reading this rung must refuse
  // to treat as proof: at zero, a meter that is counting correctly and a meter
  // that is silently recording nothing are indistinguishable — capitalTracker
  // deliberately DISPLAYS an unreadable agent meter as $0 for exactly that
  // reason. Both lines also start every month at zero, so "drawn" and "proven"
  // are genuinely different claims, and only the second one earns a green rung.
  const unproven = [
    stopLoss.mtdSpendCents === 0 ? "the mail+data line" : null,
    cap.monthToDateUsd === 0 ? "the agent budget" : null,
  ].filter((x): x is string => x !== null);
  if (unproven.length > 0) {
    return {
      ok: false,
      evidence:
        `Both lines read cleanly ($${lineUsd}/mo mail+data, $${cap.capUsd}/mo agent), but ${unproven.join(" and ")} ` +
        `${unproven.length === 1 ? "has" : "have"} metered $0.00 this month — and at $0.00 a meter that is counting and a ` +
        `meter that is recording nothing look identical, so there is no evidence yet that this gate would ever fire. ` +
        `Nothing records whether those two numbers are yours or the shipped defaults either, so I can't claim you chose them.`,
      action:
        "There is nothing to paste here — both lines already exist and already fail closed. Change the numbers if the defaults aren't yours: the mail+data line is the OUTREACH_STOPLOSS_MONTHLY_CENTS founder setting ($500/mo by default), and the agent cap is the ENSEMBLE_MONTHLY_CAP_USD server secret, raisable above its charter default only by an approved growth-budget ramp. Then let the loop run: this rung proves itself the first time real spend is metered against each line — it is the meter, not the number, that has to be real.",
    };
  }
  return {
    ok: true,
    evidence: `Two readable lines, both actively metering and both failing closed: mail+data $${mtdUsd} of $${lineUsd} this month; agent budget $${cap.monthToDateUsd.toFixed(2)} of $${cap.capUsd}.`,
  };
}

interface LedgerRead {
  entries: Array<{ domain: string; level: string; cleanCycleCount: number; threshold: number }>;
}

async function readLedger(a: AutonomyProbe): Promise<LedgerRead | { error: string }> {
  if (a.error !== null) return { error: a.error };
  try {
    const ledger = await a.mod.getTrustLedger();
    return { entries: ledger.map((e) => ({ domain: e.domain, level: e.level, cleanCycleCount: e.cleanCycleCount, threshold: e.threshold })) };
  } catch (err) {
    return { error: errText(err) };
  }
}

const LEVEL_WORD: Record<string, string> = {
  observe: "watching only",
  draft: "drafting for your approval",
  execute_gated: "acting end-to-end through its safety gates",
  autonomous_gated: "operating independently through its safety gates",
};

function pretty(domain: string): string {
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

function measureFirstTrust(ledger: LedgerRead | { error: string }): Measurement {
  if ("error" in ledger) return cannotVerify(`the trust ledger wouldn't answer (${ledger.error})`);
  if (ledger.entries.length === 0) {
    return cannotVerify("the trust ledger is empty — no domain has been seeded yet, so there is nothing to grant");
  }
  const acting = ledger.entries.filter((e) => e.level !== "observe");
  if (acting.length === 0) {
    return {
      ok: false,
      evidence: `All ${ledger.entries.length} parts of the company are at watching-only. The autopilot is an observer, not an operator.`,
      action: "Pick the lowest-stakes part (support is the usual first) and tap Grant once in the Trust section below. It's one tap to reverse.",
    };
  }
  return {
    ok: true,
    evidence: `${acting.length} of ${ledger.entries.length} parts are above watching-only: ${acting.map((e) => `${pretty(e.domain)} is ${LEVEL_WORD[e.level] ?? e.level}`).join("; ")}.`,
  };
}

async function measureDelegation(g: GrantsProbe): Promise<Measurement> {
  if (g.error !== null) return loaderFailed("the delegation store", g.error);
  try {
    const grants = await g.mod.liveGrantsFor("solene");
    if (grants.length === 0) {
      return {
        ok: false,
        evidence: "No live delegation grant — every outward action freezes and waits for your tap, however long you're away.",
        action: "Issue one narrow grant below: support only, a few dollars, a handful of actions, a short expiry. Revocation is instant.",
      };
    }
    const remaining = grants.reduce((sum, g) => sum + Math.max(0, g.maxActions - g.usedCount), 0);
    const soonest = grants.reduce((min, g) => Math.min(min, g.expiresAt.getTime()), Infinity);
    const days = Math.max(0, Math.floor((soonest - Date.now()) / 86_400_000));
    return {
      ok: true,
      evidence: `${grants.length} live grant${grants.length === 1 ? "" : "s"}, ${remaining} delegated action${remaining === 1 ? "" : "s"} left, earliest expiry in about ${days} day${days === 1 ? "" : "s"}.`,
    };
  } catch (err) {
    return cannotVerify(`the delegation store wouldn't answer (${errText(err)})`);
  }
}

function measureUnattended(ledger: LedgerRead | { error: string }): Measurement {
  if ("error" in ledger) return cannotVerify(`the trust ledger wouldn't answer (${ledger.error})`);
  if (ledger.entries.length === 0) {
    return cannotVerify("the trust ledger is empty — no domain has been seeded yet");
  }
  const notActing = ledger.entries.filter((e) => e.level !== "execute_gated" && e.level !== "autonomous_gated");
  if (notActing.length > 0) {
    return {
      ok: false,
      evidence: `${notActing.length} part${notActing.length === 1 ? "" : "s"} still can't act on their own: ${notActing.map((e) => `${pretty(e.domain)} (${LEVEL_WORD[e.level] ?? e.level})`).join(", ")}.`,
      action: "Grant each remaining part when its record justifies it — the Trust section shows the real evidence per part.",
    };
  }
  return { ok: true, evidence: `All ${ledger.entries.length} parts act end-to-end through their safety gates. Hard-stops still always ask you.` };
}

// ── Ordering ─────────────────────────────────────────────────────────────────

/**
 * Dependency-respecting order: stage first (foundation → handover), then a
 * stable topological sort inside the whole set so a rung never appears before
 * something it needs. Pure + total; a cycle (there are none) degrades to spec
 * order rather than looping.
 */
export function orderRungs<T extends { key: string; stage: RungStage; dependsOn: string[] }>(rungs: T[]): T[] {
  const byKey = new Map(rungs.map((r) => [r.key, r]));
  const out: T[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();

  const visit = (r: T) => {
    if (placed.has(r.key) || visiting.has(r.key)) return;
    visiting.add(r.key);
    for (const dep of r.dependsOn) {
      const d = byKey.get(dep);
      if (d) visit(d);
    }
    visiting.delete(r.key);
    if (!placed.has(r.key)) {
      placed.add(r.key);
      out.push(r);
    }
  };

  for (const stage of RUNG_STAGES) {
    for (const r of rungs) {
      if (r.stage === stage) visit(r);
    }
  }
  // Anything with an unknown stage still ships (never silently dropped).
  for (const r of rungs) visit(r);
  return out;
}

// ── Build ────────────────────────────────────────────────────────────────────

/** Build the full ladder from measured state. Never throws. */
export async function buildFounderReadinessLadder(): Promise<FounderReadinessLadder> {
  const probes = await loadProbes();
  const ledger = await readLedger(probes.autonomy);

  const measured = new Map<string, Measurement>();
  const run = async (key: string, fn: () => Promise<Measurement> | Measurement) => {
    try {
      measured.set(key, await fn());
    } catch (err) {
      // A measurement that itself explodes is unverifiable, never done.
      measured.set(key, cannotVerify(`the check errored (${errText(err)})`));
    }
  };

  // Measurements run concurrently — every probe MODULE is already resolved, so
  // this is only the concurrent reading of already-loaded subsystems.
  await Promise.all([
    run("brain", () => measureBrain(probes.connections)),
    run("reach_you", () => measureReachYou(probes.connections)),
    run("public_address", measurePublicAddress),
    run("billing", () => measureBilling(probes.connections, probes.stripe)),
    run("system_mail", measureSystemMail),
    run("mail_rail", () => measureMailRail(probes.connections, probes.interlock, probes.mailLedger)),
    run("data_plane", measureDataPlane),
    run("github", () => measureGithub(probes.connections)),
    run("watchdogs", () => measureWatchdogs(probes.connections)),
    run("spend_line", () => measureSpendLine(probes.stopLoss, probes.cap)),
    run("first_trust", () => measureFirstTrust(ledger)),
    run("delegation", () => measureDelegation(probes.grants)),
    run("unattended", () => measureUnattended(ledger)),
  ]);

  const ordered = orderRungs([...RUNG_SPECS]);
  const doneKeys = new Set(ordered.filter((s) => measured.get(s.key)?.ok === true).map((s) => s.key));

  const all: FounderRung[] = ordered.map((spec) => {
    const m = measured.get(spec.key) ?? cannotVerify("this rung was never measured");
    const waitingOn = spec.dependsOn.filter((d) => !doneKeys.has(d));
    let state: RungState;
    if (m.ok === true) state = "done";
    else if (m.ok === null) state = "unverifiable";
    else state = waitingOn.length > 0 ? "blocked" : "not_done";
    return { ...spec, state, evidence: m.evidence, action: m.action, waitingOn };
  });

  const open = all.filter((r) => r.state !== "done");
  const completed = all
    .filter((r) => r.state === "done")
    .map((r) => ({ key: r.key, title: r.title, evidence: r.evidence }));

  // The single next step: the first OPEN rung, in dependency order, that is
  // actually actionable right now (not blocked behind an undone prerequisite),
  // preferring critical rungs. Unverifiable rungs can still be acted on — the
  // action explains what to unblock — so they qualify.
  const actionable = open.filter((r) => r.state !== "blocked" && r.action);
  const pick = actionable.find((r) => r.critical) ?? actionable[0] ?? open.find((r) => r.action);
  const nextStep = pick && pick.action ? { key: pick.key, title: pick.title, action: pick.action, href: pick.href } : null;

  // What it now does unattended — read from the real ledger, never asserted.
  const operating: string[] = [];
  let nextHandover: FounderReadinessLadder["nextHandover"] = null;
  if (!("error" in ledger)) {
    for (const e of ledger.entries) {
      if (e.level !== "observe") operating.push(`${pretty(e.domain)} is ${LEVEL_WORD[e.level] ?? e.level}.`);
    }
    const promotable = ledger.entries
      .filter((e) => e.level !== "autonomous_gated")
      .sort((a, b) => b.cleanCycleCount - a.cleanCycleCount)[0];
    if (promotable) {
      const nextWord =
        promotable.level === "observe" ? "draft" : promotable.level === "draft" ? "execute_gated" : "autonomous_gated";
      nextHandover = {
        domain: promotable.domain,
        from: LEVEL_WORD[promotable.level] ?? promotable.level,
        to: LEVEL_WORD[nextWord] ?? nextWord,
        evidence: `${promotable.cleanCycleCount} clean cycle${promotable.cleanCycleCount === 1 ? "" : "s"} recorded of the ${promotable.threshold} it needs to earn this on its own — you can grant it sooner.`,
      };
    }
  }

  const unverifiableCount = all.filter((r) => r.state === "unverifiable").length;
  const criticalOpenCount = open.filter((r) => r.critical).length;
  const complete = open.length === 0;

  let letterLine: string;
  if (complete) {
    letterLine = `Setup is finished — all ${all.length} rungs verified. Nothing here needs you.`;
  } else if (nextStep) {
    letterLine = `Next in Controls: ${nextStep.title.toLowerCase()} — ${nextStep.action}`;
  } else if (unverifiableCount > 0) {
    letterLine = `${unverifiableCount} setup ${unverifiableCount === 1 ? "rung" : "rungs"} can't be verified right now, so ${unverifiableCount === 1 ? "it isn't" : "they aren't"} counted as done. Controls says why.`;
  } else {
    letterLine = `${open.length} setup ${open.length === 1 ? "rung" : "rungs"} left, each waiting on an earlier one. Controls shows the order.`;
  }

  logger.info(
    `[founderReadinessLadder] ${doneKeys.size}/${all.length} rungs done, ${unverifiableCount} unverifiable, ${criticalOpenCount} critical open`,
  );

  return {
    rungs: open,
    completed,
    doneCount: doneKeys.size,
    totalCount: all.length,
    unverifiableCount,
    criticalOpenCount,
    nextStep,
    letterLine,
    operating,
    nextHandover,
    complete,
  };
}
