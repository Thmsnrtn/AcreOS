/**
 * Acquisition UTM capture — pre-signup pickup, post-signup persist.
 *
 * Wave 3 Workstream E (distribution telemetry foundation).
 *
 * Flow:
 *   1. On FIRST app load (any URL — landing, /auth, deep-link), call
 *      capturePendingUtm(). It reads window.location.search and
 *      document.referrer. If any UTM param OR a non-empty cross-origin
 *      referrer is present, the snapshot is written to sessionStorage
 *      under PENDING_UTM_KEY. Idempotent — re-reading the same load is
 *      fine.
 *   2. When the AuthPage mounts in sign-up mode (?mode=register), it
 *      calls markSignupIntent() to remember "this browser is mid-signup."
 *   3. After the server confirms the authenticated user post-signup,
 *      App.tsx calls flushPendingUtm() which POSTs the snapshot to
 *      /api/me/acquisition-utm and clears sessionStorage. The server
 *      endpoint is idempotent (only writes if users.acquisition_utm
 *      IS NULL), so re-firing on a confused client is harmless.
 *
 * Why sessionStorage (not localStorage): a UTM-tagged landing should
 * attribute the signup that happens in the same tab session. A user who
 * comes back two weeks later through a different channel should get
 * the NEW attribution, not the old one. sessionStorage gives us that
 * window-scoped lifetime for free.
 */

const PENDING_UTM_KEY = "acreos-pending-utm";
const SIGNUP_INTENT_KEY = "acreos-pending-signup";

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

type UtmKey = (typeof UTM_KEYS)[number];

export interface PendingUtm {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer?: string;
  landedAt?: string;
  // Tier 2C — referral + tier context ride the same first-touch chain.
  ref?: string;
  plan?: string;
  billing?: string;
  // Tier 3A — the public parcel report ("ST/county-slug/APN") that brought
  // this visitor in. Captured from a /p/:state/:county/:apn landing so the
  // parcel rides the first-touch snapshot through signup, exactly like ?ref=.
  parcel?: string;
}

// Referral codes are 8-char base64url-uppercase from routes-referral
// generateCode(); accept a slightly wider [4,16] window so a future code
// format change doesn't silently drop attribution, but reject anything
// that isn't URL-token shaped (defends against junk/abuse params).
const REF_CODE_RE = /^[A-Za-z0-9_-]{4,16}$/;

// Pricing-CTA tier context. Closed vocabularies — these come from our own
// CTAs, so anything else is noise and gets dropped.
const PLAN_VALUES = new Set(["free", "starter", "pro", "scale"]);
const BILLING_VALUES = new Set(["monthly", "yearly"]);

// Tier 3A — public parcel report pathname. Mirrors the server route shape
// /p/:state/:county/:apn; segment bounds match normalizeReportKey's limits.
const PARCEL_PATH_RE = /^\/p\/([A-Za-z]{2})\/([a-z0-9-]{1,64})\/([^/?#]{2,64})$/;

/** Parse a /p/... pathname into the "ST/county-slug/APN" carry format. */
function parcelFromPathname(pathname: string): string | undefined {
  const m = PARCEL_PATH_RE.exec(pathname);
  if (!m) return undefined;
  let apn = m[3];
  try {
    apn = decodeURIComponent(apn);
  } catch {
    /* keep raw */
  }
  // Server-side validation accepts [A-Za-z0-9 ._-]{2,64} — pre-filter here
  // so a junk path never produces a snapshot field the server will reject.
  if (!/^[A-Za-z0-9 ._-]{2,64}$/.test(apn) || !/\d/.test(apn)) return undefined;
  return `${m[1].toUpperCase()}/${m[2].toLowerCase()}/${apn}`;
}

/**
 * Truthy when the referrer is from a different origin than the current
 * page. A same-origin referrer (e.g. the user navigated from /pricing
 * to /auth) is signal-free for acquisition attribution and we drop it
 * to keep the captured snapshot focused on first-touch attribution.
 */
function isCrossOriginReferrer(referrer: string): boolean {
  if (!referrer) return false;
  try {
    const refOrigin = new URL(referrer).origin;
    return refOrigin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Build the pending-UTM snapshot from the current location + referrer.
 * Returns null if nothing acquisition-relevant is present (no UTM
 * params and no cross-origin referrer).
 */
function buildSnapshot(): PendingUtm | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const snap: PendingUtm = {};

  let hasUtm = false;
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v && v.length > 0 && v.length <= 256) {
      snap[k as UtmKey] = v;
      hasUtm = true;
    }
  }

  const referrer = typeof document !== "undefined" ? document.referrer : "";
  const crossOrigin = isCrossOriginReferrer(referrer);
  if (crossOrigin) {
    snap.referrer = referrer.slice(0, 1024);
  }

  // Tier 2C — referral code + pricing-CTA tier context. Each is
  // acquisition-relevant on its own (a ?ref= link with no UTM params
  // must still produce a snapshot, or the referral is lost at signup).
  let hasGrowthContext = false;
  const ref = params.get("ref");
  if (ref && REF_CODE_RE.test(ref)) {
    snap.ref = ref.toUpperCase();
    hasGrowthContext = true;
  }
  const plan = params.get("plan")?.toLowerCase();
  if (plan && PLAN_VALUES.has(plan)) {
    snap.plan = plan;
    hasGrowthContext = true;
  }
  const billing = params.get("billing")?.toLowerCase();
  if (billing && BILLING_VALUES.has(billing)) {
    snap.billing = billing;
    hasGrowthContext = true;
  }

  // Tier 3A — landing directly on a shared public parcel report is
  // acquisition signal on its own (a shared /p link with no UTM params
  // must still produce a snapshot, or the parcel carry is lost at signup).
  const parcel = parcelFromPathname(window.location.pathname);
  if (parcel) {
    snap.parcel = parcel;
    hasGrowthContext = true;
  }

  if (!hasUtm && !crossOrigin && !hasGrowthContext) return null;

  snap.landedAt = new Date().toISOString();
  return snap;
}

/**
 * Capture the current load's UTM + referrer into sessionStorage if
 * anything acquisition-relevant is present and we haven't already
 * captured something this session. Idempotent.
 *
 * Call from a side-effect import or once-per-mount effect early in the
 * app's lifecycle — BEFORE the user signs in is fine; we only need it
 * captured by the time flushPendingUtm() runs post-signup.
 */
export function capturePendingUtm(): void {
  if (typeof window === "undefined") return;
  try {
    // Don't over-write an existing pending snapshot — the FIRST touch in
    // this session is the canonical one. A user who lands on
    // /?utm_source=meta and then clicks an in-app link to /auth would
    // otherwise lose the meta attribution.
    if (sessionStorage.getItem(PENDING_UTM_KEY)) return;
    const snap = buildSnapshot();
    if (!snap) return;
    sessionStorage.setItem(PENDING_UTM_KEY, JSON.stringify(snap));
  } catch {
    /* sessionStorage unavailable (private mode etc.) — silent no-op. */
  }
}

/**
 * Tier 3A — record the public parcel report the visitor viewed so it rides
 * the first-touch snapshot through signup. Unlike capturePendingUtm (which
 * never overwrites an existing snapshot), this MERGES the parcel into the
 * existing snapshot when one exists — a visitor who landed on /?utm_source=x
 * and then browsed to a /p report keeps BOTH the UTM attribution and the
 * parcel. First parcel wins; later report views don't overwrite it.
 *
 * Called from the public report page on mount (covers client-side
 * navigation, where buildSnapshot's pathname check at first load missed it).
 */
export function capturePendingParcel(
  state: string,
  countySlug: string,
  apn: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const parcel = parcelFromPathname(
      `/p/${state}/${countySlug}/${encodeURIComponent(apn)}`,
    );
    if (!parcel) return;
    const existing = readPendingUtm();
    if (existing?.parcel) return; // first parcel wins
    const snap: PendingUtm = existing ?? { landedAt: new Date().toISOString() };
    snap.parcel = parcel;
    sessionStorage.setItem(PENDING_UTM_KEY, JSON.stringify(snap));
  } catch {
    /* sessionStorage unavailable (private mode etc.) — silent no-op. */
  }
}

/**
 * Mark the current session as mid-signup so flushPendingUtm() knows to
 * fire on the first authenticated render. Called from AuthPage when it
 * mounts in sign-up mode (?mode=register).
 */
export function markSignupIntent(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SIGNUP_INTENT_KEY, String(Date.now()));
  } catch {
    /* sessionStorage unavailable */
  }
}

/**
 * Return the captured pending UTM snapshot, or null if there is none.
 */
export function readPendingUtm(): PendingUtm | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_UTM_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingUtm;
  } catch {
    return null;
  }
}

/**
 * Truthy when AuthPage left a signup-intent flag — i.e. the
 * authenticated render that follows should treat this as a sign-up,
 * not a sign-in.
 */
export function hasSignupIntent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(SIGNUP_INTENT_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Clear any lingering signup-intent + pending-UTM flags. Idempotent.
 */
export function clearPendingUtm(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PENDING_UTM_KEY);
    sessionStorage.removeItem(SIGNUP_INTENT_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

/**
 * POST the captured UTM snapshot to /api/me/acquisition-utm. The server
 * is idempotent (writes only if users.acquisition_utm IS NULL), so
 * re-firing is safe. Always clears sessionStorage on completion (success
 * or failure) — a failed POST during a flaky network shouldn't lock the
 * user into retrying forever on every render.
 *
 * Returns the snapshot that was posted (or null if nothing to post), so
 * callers can fold the values into a companion analytics event.
 */
/**
 * Read the marketing_touch 1st-party anonymous-id cookie set by
 * lib/marketing-touch.getAnonymousId(). Read-only here (we never mint one in
 * this module — minting belongs to the emitter) to keep the dependency one-way
 * and avoid a circular import.
 */
function readMarketingAnonId(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = "acreos_anon_id=";
  for (const part of document.cookie.split(";")) {
    const c = part.trim();
    if (c.startsWith(prefix)) {
      const v = decodeURIComponent(c.slice(prefix.length));
      return v.length >= 8 ? v : undefined;
    }
  }
  return undefined;
}

export async function flushPendingUtm(): Promise<PendingUtm | null> {
  const snap = readPendingUtm();
  // The marketing_touch chain join key — always include it so the server
  // backfills user_id/org_id onto pre-signup touches even when no UTM was
  // captured (a visitor with touches but no UTM still wants their chain
  // joined to the new account). See routes-acquisition-utm.backfillTouchIdentity.
  // Read the cookie inline (not via lib/marketing-touch) to avoid a circular
  // import — marketing-touch imports readPendingUtm from this module.
  const anonymousId = readMarketingAnonId();

  // Nothing to persist (no UTM) AND no anon id to backfill → bail cheaply.
  if (!snap && !anonymousId) {
    clearPendingUtm();
    return null;
  }

  try {
    // unchecked-mutation: acquisition attribution beacon. Nothing in the UI claims it was recorded.
    await fetch("/api/me/acquisition-utm", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(snap ?? {}), anonymousId }),
    });
  } catch {
    /* best-effort — don't block the UI on a failed analytics POST */
  } finally {
    clearPendingUtm();
  }
  return snap;
}
