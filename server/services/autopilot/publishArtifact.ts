/**
 * Founder Autopilot — the publish service (close the last mile, Batch B).
 *
 * Turns a growth draft into a live, public, owned-surface artifact — but ONLY
 * through a hard publish gate. Reuses the existing, working community_letters →
 * /field-notes/:slug rail (no route refactor); records a marketing_artifacts row
 * as the stable id everything attributes against (Batch D).
 *
 * The publish gate composes three safety layers, in order:
 *   1. SANITIZE — DOMPurify with a tight tag/attr allowlist (strips script,
 *      styles, iframes, event handlers, javascript: URLs).
 *   2. LINK ALLOWLIST — outbound links may only point at AcreOS / relative /
 *      mailto; any external host is a violation.
 *   3. LAND CLAIMS — screenLandClaims() bans buildability/title/etc.
 *      determinations, investment language, fair-housing steering, missing
 *      disclosure.
 * `ok` only if all three pass. screenForPublish is synchronous + pure (given the
 * input) → exhaustively testable. Publishing itself is gated behind the DB
 * publish switch and is best-effort (it never throws into the dispatch loop).
 */
import DOMPurify from "isomorphic-dompurify";
import { and, gte, isNull } from "drizzle-orm";
import { db } from "../../db";
import { communityLetters, marketingArtifacts } from "@shared/schema";
import { logger } from "../../utils/logger";
import { screenLandClaims, type ClaimViolation, type ClaimsGateOptions } from "./claimsGate";

/** Hard cap on autopilot publishes per UTC day (lean + blast-radius bound). */
export const PUBLISH_MAX_PER_DAY = Number(process.env.AUTOPILOT_PUBLISH_MAX_PER_DAY ?? 1);

const ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "a", "hr"];
const ALLOWED_ATTR = ["href"];

/** Hosts an outbound link may point at. Relative + mailto are always allowed. */
export const ALLOWED_LINK_HOSTS = new Set(["acreos.com", "www.acreos.com", "app.acreos.com"]);

export interface PublishScreenResult {
  ok: boolean;
  sanitizedHtml: string;
  violations: ClaimViolation[];
}

function sanitize(html: string): string {
  return String(
    DOMPurify.sanitize(html ?? "", {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/)/i,
    }),
  );
}

function toText(html: string): string {
  return String(DOMPurify.sanitize(html ?? "", { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }));
}

/** Flag any outbound link whose host isn't on the allowlist. Pure. */
function screenLinks(sanitizedHtml: string): ClaimViolation[] {
  const violations: ClaimViolation[] = [];
  const hrefRe = /href\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(sanitizedHtml)) != null) {
    const href = m[1].trim();
    if (href.startsWith("/") || href.startsWith("mailto:") || href.startsWith("#")) continue;
    try {
      const host = new URL(href).hostname.toLowerCase();
      if (!ALLOWED_LINK_HOSTS.has(host)) {
        violations.push({ code: "external_link", severity: "critical", match: href, message: `Outbound link to a non-AcreOS host ("${host}") is not allowed in auto-published content.` });
      }
    } catch {
      violations.push({ code: "malformed_link", severity: "critical", match: href, message: `Malformed link ("${href}") in auto-published content.` });
    }
  }
  return violations;
}

/** Screen a draft for publication. Synchronous + deterministic. */
export function screenForPublish(input: { subject: string; htmlBody: string } & ClaimsGateOptions): PublishScreenResult {
  const sanitizedHtml = sanitize(input.htmlBody);
  const linkViolations = screenLinks(sanitizedHtml);
  const text = `${input.subject ?? ""} ${toText(sanitizedHtml)}`;
  const claims = screenLandClaims(text, { requireDisclosure: input.requireDisclosure, disclosureCues: input.disclosureCues });
  const violations = [...linkViolations, ...claims.violations];
  return { ok: violations.length === 0, sanitizedHtml, violations };
}

/**
 * Parse a publishable artifact from an agent's dispatch output. The growth
 * prompt asks the agent to emit its final article inside a fenced block:
 *   <<<PUBLISH
 *   SUBJECT: ...
 *   BODY:
 *   <p>...</p>
 *   >>>
 * Pure + tolerant: returns null when there's no well-formed block — so messy
 * reasoning output simply doesn't publish (the safe failure mode).
 */
export function parsePublishable(text: string): { subject: string; htmlBody: string } | null {
  if (!text) return null;
  const m = /<<<PUBLISH\s*([\s\S]*?)>>>/i.exec(text);
  if (!m) return null;
  const block = m[1].trim();
  const subjMatch = /^SUBJECT:\s*(.+)$/im.exec(block);
  if (!subjMatch) return null;
  const subject = subjMatch[1].trim();
  const bodyMatch = /BODY:\s*([\s\S]*)$/i.exec(block);
  const htmlBody = (bodyMatch ? bodyMatch[1] : block.slice(subjMatch.index + subjMatch[0].length)).trim();
  if (!subject || !htmlBody) return null;
  return { subject, htmlBody };
}

export interface PublishGrowthInput {
  dispatchId?: number | null;
  playId?: string | null;
  subject: string;
  htmlBody: string;
  county?: string | null;
  state?: string | null;
}

export interface PublishGrowthResult {
  published: boolean;
  reason: string;
  slug?: string;
  artifactId?: number;
  violations: ClaimViolation[];
}

function slugify(subject: string, dispatchId?: number | null): string {
  const base = (subject || "field-note")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "field-note";
  const suffix = dispatchId != null ? String(dispatchId) : Math.abs(hash(subject)).toString(36).slice(0, 6);
  return `${base}-${suffix}`.slice(0, 118);
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Publish a growth artifact: screen → (if publish enabled) insert a field-notes
 * draft + mark it public + record the marketing_artifacts anchor. Never throws.
 * Returns what happened (blocked / disabled / published) + any gate violations.
 *
 * `isEnabled` is injectable for tests; defaults to the DB publish switch.
 */
export async function publishGrowthArtifact(
  input: PublishGrowthInput,
  deps?: { isEnabled?: () => Promise<boolean> },
): Promise<PublishGrowthResult> {
  const screen = screenForPublish({ subject: input.subject, htmlBody: input.htmlBody });
  if (!screen.ok) {
    logger.warn("[autopilot/publish] BLOCKED by publish gate", { violations: screen.violations.map((v) => v.code) });
    return { published: false, reason: "blocked by publish gate", violations: screen.violations };
  }

  const enabled = deps?.isEnabled ? await deps.isEnabled() : await defaultIsEnabled();
  if (!enabled) {
    return { published: false, reason: "publishing disabled", violations: [] };
  }

  // Daily rate cap — bounds the blast radius on a permanent public surface.
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const todays = await db
      .select({ id: marketingArtifacts.id })
      .from(marketingArtifacts)
      .where(and(gte(marketingArtifacts.publishedAt, startOfDay), isNull(marketingArtifacts.unpublishedAt)))
      .limit(PUBLISH_MAX_PER_DAY + 1);
    if (todays.length >= PUBLISH_MAX_PER_DAY) {
      return { published: false, reason: "daily publish cap reached", violations: [] };
    }
  } catch {
    /* if the cap check fails, fall through — the gate already passed */
  }

  try {
    const slug = slugify(input.subject, input.dispatchId);
    const now = new Date();
    await db.insert(communityLetters).values({
      slug,
      subject: input.subject,
      htmlBody: screen.sanitizedHtml,
      publishedAt: now,
      senderUserId: "autopilot",
    });
    const [artifact] = await db
      .insert(marketingArtifacts)
      .values({
        dispatchId: input.dispatchId ?? null,
        playId: input.playId ?? null,
        slug,
        surface: "field_note",
        county: input.county ?? null,
        state: input.state ?? null,
        publishedAt: now,
      })
      .returning({ id: marketingArtifacts.id });
    logger.info("[autopilot/publish] published artifact", { slug, artifactId: artifact?.id });
    // Accelerate discovery: ping IndexNow so Bing/Yandex crawl the new public
    // surface within hours. Fire-and-forget + safe-by-absence (no-op without a
    // key) — must never block or fail the publish.
    void import("./searchEngineSubmit")
      .then(({ submitToIndexNow }) => submitToIndexNow([`/field-notes/${slug}`]))
      .catch(() => {});
    return { published: true, reason: "published", slug, artifactId: artifact?.id, violations: [] };
  } catch (err) {
    logger.warn("[autopilot/publish] publish write failed", err instanceof Error ? err : undefined);
    return { published: false, reason: "publish write failed", violations: [] };
  }
}

async function defaultIsEnabled(): Promise<boolean> {
  const { isPublishEnabled } = await import("./settings");
  return isPublishEnabled();
}

/**
 * The structural last-mile link: after an autopilot GROWTH dispatch completes,
 * if it emitted a publishable artifact, route it through the publish gate. Only
 * fires for successful autopilot growth dispatches; returns null otherwise.
 * Gated + screened + rate-capped inside publishGrowthArtifact, so a flip of the
 * publish switch is all it takes — and nothing unsafe gets through.
 */
export async function maybePublishFromDispatch(d: {
  sourceType: string;
  sourceId: string;
  success: boolean;
  finalText: string;
  dispatchId: number;
}): Promise<PublishGrowthResult | null> {
  if (!d.success) return null;
  if (d.sourceType !== "auto_dispatch" || !d.sourceId.startsWith("autopilot:grow_owned_channels")) return null;
  const parsed = parsePublishable(d.finalText);
  if (!parsed) return null;
  return publishGrowthArtifact({
    dispatchId: d.dispatchId,
    playId: "grow_owned_channels",
    subject: parsed.subject,
    htmlBody: parsed.htmlBody,
  });
}

/** Unpublish an artifact: hide it from /field-notes + stamp the marketing row. */
export async function unpublishArtifact(slug: string): Promise<{ ok: boolean }> {
  try {
    const { eq } = await import("drizzle-orm");
    await db.update(communityLetters).set({ publishedAt: null, updatedAt: new Date() }).where(eq(communityLetters.slug, slug));
    await db.update(marketingArtifacts).set({ unpublishedAt: new Date() }).where(eq(marketingArtifacts.slug, slug));
    logger.warn("[autopilot/publish] unpublished artifact", { slug });
    return { ok: true };
  } catch (err) {
    logger.warn("[autopilot/publish] unpublish failed", err instanceof Error ? err : undefined);
    return { ok: false };
  }
}
