/**
 * Zernio — unified social-media API wrapper.
 *
 * Zernio (https://zernio.com) provides a single REST API across 14+ social
 * platforms (LinkedIn, X, Threads, Bluesky, Mastodon, etc.) with OAuth-managed
 * accounts on their side and a clean POST body shape on ours. We use it as
 * the team's only social-posting surface — no Postiz, no Buffer, no
 * platform-specific clients to maintain.
 *
 * Auth: `Authorization: Bearer <ZERNIO_API_KEY>` per their docs. Set via
 * `fly secrets set ZERNIO_API_KEY=sk_... -a acreos`.
 *
 * IMPORTANT: This wrapper does NOT touch the Pax customer surface. Pax-only
 * branding is constitutional. Internal callers (Soren's runway publishing,
 * crisis-comms outbound) are the only paths that should reach this module.
 *
 * Soren signs the content (truth-engine pass), Beatrice reviews (compliance),
 * Solene approves (constitutional gate), THEN we call publishPost(). The
 * gate sequence is enforced at the call site, not here.
 */
import { logger } from "../../utils/logger";

const ZERNIO_BASE = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1";

function readToken(): string | null {
  return process.env.ZERNIO_API_KEY || process.env.ZERNIO_TOKEN || null;
}

export type SocialPlatform =
  | "linkedin"
  | "linkedin_company"
  | "x"
  | "threads"
  | "bluesky"
  | "mastodon"
  | "facebook"
  | "instagram"
  | "youtube"
  | "tiktok"
  | "pinterest"
  | "reddit"
  | "discord"
  | "telegram"
  | "whatsapp";

export interface ZernioPlatformTarget {
  platform: SocialPlatform;
  accountId: string;
}

export interface ZernioPublishOptions {
  content: string;
  platforms: ZernioPlatformTarget[];
  /** Publish immediately. Mutually exclusive with `scheduledFor`. */
  publishNow?: boolean;
  /** ISO-8601 timestamp for delayed publishing. Mutually exclusive with `publishNow`. */
  scheduledFor?: string;
  /** IANA timezone (e.g., "America/New_York"); required when scheduling. */
  timezone?: string;
  /** Optional URLs of images/video — Zernio handles per-platform constraints. */
  mediaUrls?: string[];
}

export interface ZernioPublishResult {
  postId: string;
  perPlatform: Array<{
    platform: SocialPlatform;
    accountId: string;
    status: "queued" | "published" | "failed";
    platformPostId?: string;
    error?: string;
  }>;
}

export interface ZernioAccount {
  accountId: string;
  platform: SocialPlatform;
  displayName: string;
  connected: boolean;
}

export class ZernioConfigError extends Error {}
export class ZernioAPIError extends Error {
  public readonly status: number;
  public readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function zfetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = readToken();
  if (!token) {
    throw new ZernioConfigError(
      "Zernio token missing. Set Fly secret ZERNIO_API_KEY (or ZERNIO_TOKEN).",
    );
  }
  const res = await fetch(`${ZERNIO_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text().catch(() => null);
  }
  if (!res.ok) {
    const msg =
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `${res.status} ${res.statusText}`;
    throw new ZernioAPIError(res.status, body, `Zernio ${init.method || "GET"} ${path}: ${msg}`);
  }
  return body;
}

/**
 * List the social accounts the user has connected on the Zernio side.
 * Tom OAuths each account once in the Zernio dashboard; this returns the
 * accountIds we need for publish targeting.
 */
export async function listConnectedAccounts(): Promise<ZernioAccount[]> {
  const body = (await zfetch("/accounts", { method: "GET" })) as
    | { accounts?: ZernioAccount[] }
    | ZernioAccount[];
  if (Array.isArray(body)) return body;
  return body.accounts || [];
}

/**
 * Publish (or schedule) a post across one or more connected accounts.
 *
 * The post MUST have cleared Soren's truth-engine + Beatrice's compliance
 * + Solene's constitutional review BEFORE this function is called. This
 * wrapper does not gate — the call site does.
 */
export async function publishPost(opts: ZernioPublishOptions): Promise<ZernioPublishResult> {
  if (opts.publishNow && opts.scheduledFor) {
    throw new ZernioConfigError("publishNow and scheduledFor are mutually exclusive");
  }
  if (!opts.publishNow && !opts.scheduledFor) {
    throw new ZernioConfigError("Must specify either publishNow:true or scheduledFor");
  }
  if (opts.scheduledFor && !opts.timezone) {
    throw new ZernioConfigError("timezone is required when scheduling");
  }
  if (!opts.platforms.length) {
    throw new ZernioConfigError("At least one platform target is required");
  }

  const payload = {
    content: opts.content,
    platforms: opts.platforms,
    publishNow: opts.publishNow,
    scheduledFor: opts.scheduledFor,
    timezone: opts.timezone,
    mediaUrls: opts.mediaUrls,
  };

  logger.info("zernio.publishPost", {
    metadata: {
      platforms: opts.platforms.map((p) => p.platform),
      scheduled: !!opts.scheduledFor,
    },
  });

  const result = (await zfetch("/posts", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as ZernioPublishResult;

  return result;
}

/**
 * Quick health probe — returns true if the token is valid and Zernio is reachable.
 * Used by the founder-cost surface and the daily pulse.
 */
export async function probe(): Promise<{ ok: boolean; accounts: number; error?: string }> {
  try {
    const accounts = await listConnectedAccounts();
    return { ok: true, accounts: accounts.length };
  } catch (e) {
    return { ok: false, accounts: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
