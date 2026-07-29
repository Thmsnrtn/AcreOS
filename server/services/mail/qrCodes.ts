/**
 * Wave B — per-piece QR short codes for direct-mail attribution.
 *
 * THE PROBLEM THIS SOLVES: `mail_shipment_pieces.qr_scan_count` was read in
 * eight places (funnel, response timeline, template comparison, cohort
 * report, CSV export, In-Flight table) and written in ZERO. There was no QR
 * generation and no scan endpoint, so every attribution surface rendered a
 * permanent, un-measured zero as if it were a measurement. Under the
 * no-fabrication doctrine that could not ship.
 *
 * This module is the PURE half of the fix: minting, verifying and parsing
 * codes, plus the dedupe decision. It deliberately imports nothing from the
 * database or Express so it can be unit-tested without DATABASE_URL. The
 * persistence half lives in server/routes/public-qr-redirect.ts.
 *
 * ── Code scheme ──────────────────────────────────────────────────────────
 *
 *   code = base36(pieceId) + "-" + tag
 *   tag  = base36( HMAC-SHA256(secret, "mailqr:v1:" + pieceId) )[0..TAG_LEN]
 *
 * Properties we actually need from a code printed on a postcard:
 *
 *   - SHORT. 10-14 chars keeps the QR at a low error-correction version, so
 *     it survives being printed at 0.6" on a 4x6 postcard.
 *   - OPAQUE + UNGUESSABLE. Without the signing secret you cannot mint a
 *     valid code, so a scraper cannot walk `/r/1`, `/r/2`, … and manufacture
 *     scan counts for someone else's campaign.
 *   - SELF-DESCRIBING. The piece id is recoverable from the code itself, so
 *     the redirect is one indexed lookup and a forged code is rejected by
 *     arithmetic BEFORE it ever touches the database.
 *
 * The code is ALSO persisted on the piece row (`mail_shipment_pieces.qr_code`,
 * unique) — signature verification is the cheap gate, the stored column is
 * the authority. Both must agree.
 *
 * ── Secret ───────────────────────────────────────────────────────────────
 *
 * `MAIL_QR_SIGNING_SECRET` (declared in server/services/configManager.ts).
 * Falls back to FIELD_ENCRYPTION_KEY, then SESSION_SECRET — both are required
 * in production, so a real deploy always has signing material. If NONE is
 * present we refuse to mint codes rather than mint guessable ones: a QR that
 * anyone can forge would poison the funnel with fabricated scans, which is
 * strictly worse than no QR at all.
 */

import { createHmac, timingSafeEqual } from "crypto";

/** Wire-format version, so a future rotation can coexist with printed mail. */
const CODE_VERSION = "v1";
/** Characters of HMAC kept in the code. 8 base36 chars ≈ 41 bits. */
const TAG_LEN = 8;
/** Codes are lowercase alphanumeric plus one hyphen separator. */
const CODE_RE = /^[0-9a-z]{1,12}-[0-9a-z]{8}$/;

/**
 * Repeat-scan suppression window. A hit on the same code from the same
 * client fingerprint inside this window is RECORDED but not COUNTED.
 *
 * Why 30 minutes, and why fingerprint-scoped: the realistic double-count
 * sources for a postcard QR are (a) the scanning app fetching the URL to
 * render a preview and then the browser fetching it again a beat later, and
 * (b) a human tapping back and re-scanning while standing at the mailbox.
 * Both are the same person within a few minutes. A genuinely separate scan —
 * a spouse, a neighbour, the same person from a different device or a week
 * later — has a different fingerprint or falls outside the window, and
 * counts. This is deliberately cheap and honest rather than clever: it never
 * invents a scan, and the suppressed hits stay queryable in
 * mail_qr_scan_events so the arithmetic is auditable.
 */
export const SCAN_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

/** Resolve signing material. Returns null when nothing is configured. */
function signingSecret(): string | null {
  const secret =
    process.env.MAIL_QR_SIGNING_SECRET ||
    process.env.FIELD_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

/** True when this deployment can mint/verify QR codes at all. */
export function qrSigningConfigured(): boolean {
  return signingSecret() !== null;
}

function tagFor(pieceId: number, secret: string): string {
  const mac = createHmac("sha256", secret)
    .update(`mailqr:${CODE_VERSION}:${pieceId}`)
    .digest();
  // Fold the first 8 bytes into a base36 string, then take a fixed slice so
  // every tag is exactly TAG_LEN characters (left-padded when small).
  const n = mac.readBigUInt64BE(0);
  return n.toString(36).padStart(TAG_LEN, "0").slice(0, TAG_LEN);
}

/**
 * Mint the code printed on the piece with this id.
 * Returns null when no signing secret is configured (caller must degrade to
 * "QR not instrumented" — never to an unsigned code).
 */
export function mintQrCode(pieceId: number): string | null {
  if (!Number.isInteger(pieceId) || pieceId <= 0) return null;
  const secret = signingSecret();
  if (!secret) return null;
  return `${pieceId.toString(36)}-${tagFor(pieceId, secret)}`;
}

/**
 * Parse + verify a code. Returns the piece id it claims, or null if the code
 * is malformed, unsigned, or carries a bad signature. Constant-time tag
 * comparison so the endpoint is not an oracle for guessing tags.
 */
export function parseQrCode(code: string): { pieceId: number } | null {
  if (typeof code !== "string") return null;
  const lower = code.toLowerCase();
  if (!CODE_RE.test(lower)) return null;

  const secret = signingSecret();
  if (!secret) return null;

  const [idPart, tag] = lower.split("-");
  const pieceId = Number.parseInt(idPart, 36);
  if (!Number.isSafeInteger(pieceId) || pieceId <= 0) return null;

  const expected = Buffer.from(tagFor(pieceId, secret));
  const actual = Buffer.from(tag);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  return { pieceId };
}

/** Absolute URL a piece's QR points at. */
export function qrRedirectUrl(code: string): string {
  const base = (process.env.APP_URL || "https://app.acreos.io").replace(/\/$/, "");
  return `${base}/r/${code}`;
}

/**
 * Where a scan lands. Deliberately a CONSTANT destination, identical for
 * every code: the redirect must not become a side channel that tells an
 * unauthenticated scanner which organization mailed the piece, who the lead
 * is, or that a given code is even valid. An invalid code lands in exactly
 * the same place as a valid one.
 *
 * `MAIL_QR_LANDING_URL` overrides the default for deployments that host
 * their own respond-to-offer page.
 */
export function qrLandingUrl(): string {
  const configured = process.env.MAIL_QR_LANDING_URL;
  if (configured && /^https?:\/\//i.test(configured)) return configured;
  const base = (process.env.APP_URL || "https://app.acreos.io").replace(/\/$/, "");
  return `${base}/tools/parcel-check`;
}

/**
 * Non-reversible client fingerprint for dedupe. HMAC'd with the same signing
 * secret and truncated: enough to recognise "same client, same code, moments
 * apart", not enough to recover an IP address.
 */
export function scanFingerprint(ip: string | undefined, userAgent: string | undefined): string | null {
  const secret = signingSecret();
  if (!secret) return null;
  const material = `${ip ?? ""}|${userAgent ?? ""}`;
  if (material === "|") return null;
  return createHmac("sha256", secret).update(`scanfp:${material}`).digest("hex").slice(0, 32);
}

/** Request signals that mark a hit as machine traffic rather than a human. */
export interface ScanRequestSignals {
  userAgent?: string;
  /** `Purpose` / `X-Purpose` / `Sec-Purpose` header, when present. */
  purpose?: string;
  method?: string;
}

const BOT_UA_RE =
  /(bot|crawler|spider|slurp|preview|facebookexternalhit|whatsapp|telegrambot|slackbot|discordbot|twitterbot|linkedinbot|embedly|curl\/|wget\/|headlesschrome|python-requests|go-http-client|okhttp|monitoring|uptime)/i;

const PREFETCH_RE = /(prefetch|preview|prerender)/i;

export type ScanSuppression = "prefetch" | "bot" | "duplicate_window";

/**
 * The dedupe decision. Pure — the caller supplies the timestamp of the most
 * recent COUNTED scan for (piece, fingerprint), or null if there is none.
 *
 * Returns the reason the hit is not counted, or null when it counts.
 */
export function scanSuppressionReason(args: {
  signals: ScanRequestSignals;
  lastCountedScanAt: Date | null;
  now?: Date;
}): ScanSuppression | null {
  const { signals, lastCountedScanAt } = args;
  const now = args.now ?? new Date();

  // A HEAD probe is never a human reading a postcard.
  if (signals.method && signals.method.toUpperCase() === "HEAD") return "prefetch";
  if (signals.purpose && PREFETCH_RE.test(signals.purpose)) return "prefetch";
  if (signals.userAgent && BOT_UA_RE.test(signals.userAgent)) return "bot";

  if (lastCountedScanAt) {
    const delta = now.getTime() - lastCountedScanAt.getTime();
    if (delta >= 0 && delta < SCAN_DEDUPE_WINDOW_MS) return "duplicate_window";
  }
  return null;
}
