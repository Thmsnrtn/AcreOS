import crypto from "crypto";
import https from "https";
import { logger } from "../utils/logger";
import { BoundedMap } from "../utils/boundedMap";

/**
 * Shared AWS SNS message verification core.
 *
 * Both the inbound-email webhook (SES → SNS → HTTPS) and the SES
 * bounce/complaint webhook receive signed SNS envelopes. Rather than
 * duplicate the crypto (and risk the two copies drifting), the canonical
 * verification — cert-host allowlist, canonical-string construction,
 * SHA1/SHA256-with-RSA verify, subscription auto-confirm, and the replay
 * cache — lives here and is consumed by both routes.
 *
 * Verification follows the AWS spec:
 *   https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 *   - SigningCertURL host must match the SNS regional host pattern.
 *   - Canonical string is built field-by-field per message Type.
 *   - SignatureVersion 1 → SHA1withRSA, 2 → SHA256withRSA.
 */

// ────────────────────────────────────────────────────────────────────────
// Replay cache (shared across SNS-backed webhooks)
// ────────────────────────────────────────────────────────────────────────

const REPLAY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const replayCache = new Map<string, number>();

function pruneReplayCache(now: number): void {
  if (replayCache.size < 10_000) return;
  for (const [key, ts] of replayCache) {
    if (now - ts > REPLAY_TTL_MS) replayCache.delete(key);
  }
}

/** Returns true if message was already seen; otherwise records it. */
export function isReplay(messageId: string): boolean {
  const now = Date.now();
  const seen = replayCache.get(messageId);
  if (seen !== undefined && now - seen < REPLAY_TTL_MS) {
    return true;
  }
  replayCache.set(messageId, now);
  pruneReplayCache(now);
  return false;
}

/** Test-only helper to clear the replay cache. */
export function _resetReplayCache(): void {
  replayCache.clear();
}

// ────────────────────────────────────────────────────────────────────────
// SNS signature verification
// ────────────────────────────────────────────────────────────────────────

const SNS_HOST_RE = /^sns(?:\.|-fips\.|-fips-)[a-z0-9-]+\.amazonaws\.com$/i;
/** The path AWS serves SNS signing certificates at. */
const SNS_CERT_PATH_RE = /^\/SimpleNotificationService-[0-9a-f]+\.pem$/i;

/** An https URL on an SNS host, with no credentials, port override or fragment. */
function snsHostUrl(raw: unknown): URL | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  if (!SNS_HOST_RE.test(url.hostname)) return null;
  return url;
}

/**
 * One of OUR topics, as configured (never as the message states it): its ARN
 * and the SNS endpoint of its region, both derived from the configured ARN.
 */
export interface PinnedSnsTopic {
  topicArn: string;
  host: string;
}

const CONFIGURED_ARN_RE = /^arn:aws:sns:([a-z]{2}(?:-[a-z]+)+-\d+):\d+:[A-Za-z0-9_.-]+$/;

function pinnedFromConfiguredArn(arn: string): PinnedSnsTopic | null {
  const m = CONFIGURED_ARN_RE.exec(arn);
  return m ? { topicArn: arn, host: `sns.${m[1]}.amazonaws.com` } : null;
}

/**
 * The URL to fetch the signing certificate from: our topic's regional SNS
 * endpoint plus the SimpleNotificationService-<hex>.pem path the message
 * names — and only when the message names that same endpoint. Otherwise null.
 */
function canonicalSnsCertUrl(raw: unknown, pinned: PinnedSnsTopic): string | null {
  const url = snsHostUrl(raw);
  if (!url || url.search || url.hostname.toLowerCase() !== pinned.host) return null;
  if (!SNS_CERT_PATH_RE.test(url.pathname)) return null;
  return `https://${pinned.host}${url.pathname}`;
}

/**
 * The ConfirmSubscription call to make for a SubscribeURL: on our topic's
 * regional endpoint, for our topic, carrying only the message's token — and
 * only when the SubscribeURL is exactly that call. Otherwise null.
 */
function canonicalSnsSubscribeUrl(raw: unknown, pinned: PinnedSnsTopic): string | null {
  const url = snsHostUrl(raw);
  if (!url || url.hostname.toLowerCase() !== pinned.host || url.pathname !== "/") return null;
  const q = url.searchParams;
  const token = q.get("Token");
  if (q.get("Action") !== "ConfirmSubscription" || !token || q.get("TopicArn") !== pinned.topicArn) return null;
  return (
    `https://${pinned.host}/?Action=ConfirmSubscription` +
    `&TopicArn=${encodeURIComponent(pinned.topicArn)}&Token=${encodeURIComponent(token)}`
  );
}

/** Parse an SNS envelope (SNS posts it as text/plain; a parsed object is accepted too). */
export function parseSnsEnvelope(body: unknown): SnsMessage | null {
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as SnsMessage;
}

export interface SnsMessage {
  Type: string;
  MessageId: string;
  TopicArn?: string;
  Subject?: string;
  Message?: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  SigningCertUrl?: string; // some forwarders lowercase
  Token?: string;
  SubscribeURL?: string;
  // index signature for safety
  [k: string]: unknown;
}

export function buildSnsCanonicalString(msg: SnsMessage): string {
  if (msg.Type === "Notification") {
    const lines = [
      "Message",
      String(msg.Message ?? ""),
      "MessageId",
      String(msg.MessageId),
    ];
    if (msg.Subject !== undefined && msg.Subject !== null) {
      lines.push("Subject", String(msg.Subject));
    }
    lines.push(
      "Timestamp",
      String(msg.Timestamp),
      "TopicArn",
      String(msg.TopicArn ?? ""),
      "Type",
      String(msg.Type),
    );
    return lines.join("\n") + "\n";
  }
  if (msg.Type === "SubscriptionConfirmation" || msg.Type === "UnsubscribeConfirmation") {
    return [
      "Message",
      String(msg.Message ?? ""),
      "MessageId",
      String(msg.MessageId),
      "SubscribeURL",
      String(msg.SubscribeURL ?? ""),
      "Timestamp",
      String(msg.Timestamp),
      "Token",
      String(msg.Token ?? ""),
      "TopicArn",
      String(msg.TopicArn ?? ""),
      "Type",
      String(msg.Type),
    ].join("\n") + "\n";
  }
  throw new Error(`Unknown SNS message type: ${msg.Type}`);
}

const certCache = new BoundedMap<string, string>(100);

async function fetchSigningCert(certUrl: string): Promise<string> {
  const cached = certCache.get(certUrl);
  if (cached) return cached;

  // verifySnsMessage passes only a canonical URL (canonicalSnsCertUrl);
  // re-check the shape here so this fetcher is never a general one.
  if (!snsHostUrl(certUrl)) {
    throw new Error("SNS SigningCertURL not allowed");
  }

  const pem: string = await new Promise((resolve, reject) => {
    const req = https.get(certUrl, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SNS cert fetch returned ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("SNS cert fetch timeout"));
    });
  });

  certCache.set(certUrl, pem);
  return pem;
}

const defaultSubscribeConfirmer = async (url: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      res.resume();
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`SubscribeURL returned ${res.statusCode}`));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("SubscribeURL timeout")));
  });
};

// Allow tests / DI to override cert + URL fetch.
let certFetcher: (url: string) => Promise<string> = fetchSigningCert;
let subscribeConfirmer: (url: string) => Promise<void> = defaultSubscribeConfirmer;

export function _setCertFetcherForTests(fn: typeof certFetcher): void {
  certFetcher = fn;
}
export function _setSubscribeConfirmerForTests(fn: typeof subscribeConfirmer): void {
  subscribeConfirmer = fn;
}
export function _resetTestOverrides(): void {
  certFetcher = fetchSigningCert;
  subscribeConfirmer = defaultSubscribeConfirmer;
}

/**
 * Confirm an SNS subscription — only ever the ConfirmSubscription call for our
 * own (pinned) topic on its regional endpoint (canonicalSnsSubscribeUrl).
 * Anything else is refused without a request.
 */
export async function confirmSubscription(subscribeUrl: unknown, pinned: PinnedSnsTopic): Promise<void> {
  const safeUrl = canonicalSnsSubscribeUrl(subscribeUrl, pinned);
  if (!safeUrl) {
    throw new Error("SNS SubscribeURL not allowed");
  }
  await subscribeConfirmer(safeUrl);
}

/**
 * Is this SNS message from one of OUR topics?
 *
 * A valid SNS signature identifies Amazon SNS as the sender, not which topic
 * the message belongs to. Each SNS-backed webhook therefore also accepts only
 * the topic ARNs configured for it, read from its own env var
 * (comma-separated). Fail closed: no list configured means no topic is
 * accepted.
 */
export function snsTopicAllowed(
  topicArn: unknown,
  allowListEnvVar: string,
): { ok: true; pinned: PinnedSnsTopic } | { ok: false; reason: string } {
  const allowed = String(process.env[allowListEnvVar] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return { ok: false, reason: `${allowListEnvVar} not set` };
  const configured = allowed.find((a) => a === topicArn);
  if (configured === undefined) return { ok: false, reason: "TopicArn not in allowlist" };
  // Everything downstream (the certificate host, the confirmation call) is
  // derived from the CONFIGURED ARN, never from the message.
  const pinned = pinnedFromConfiguredArn(configured);
  if (!pinned) return { ok: false, reason: `${allowListEnvVar} entry is not an SNS topic ARN` };
  return { ok: true, pinned };
}

export async function verifySnsMessage(
  msg: SnsMessage,
  pinned: PinnedSnsTopic,
): Promise<{ ok: boolean; reason?: string }> {
  if (!msg.Type || !msg.MessageId || !msg.Signature || !msg.SignatureVersion) {
    return { ok: false, reason: "missing required SNS fields" };
  }
  if (msg.TopicArn !== pinned.topicArn) {
    return { ok: false, reason: "TopicArn does not match the pinned topic" };
  }
  if (msg.SignatureVersion !== "1" && msg.SignatureVersion !== "2") {
    return { ok: false, reason: `unsupported SignatureVersion ${msg.SignatureVersion}` };
  }
  const rawCertUrl = msg.SigningCertURL || (msg.SigningCertUrl as string | undefined);
  if (!rawCertUrl) return { ok: false, reason: "missing SigningCertURL" };
  const certUrl = canonicalSnsCertUrl(rawCertUrl, pinned);
  if (!certUrl) return { ok: false, reason: "SigningCertURL not allowed" };

  let pem: string;
  try {
    pem = await certFetcher(certUrl);
  } catch (err) {
    return { ok: false, reason: `cert fetch failed: ${(err as Error).message}` };
  }

  let canonical: string;
  try {
    canonical = buildSnsCanonicalString(msg);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  // SignatureVersion 1 = SHA1withRSA, 2 = SHA256withRSA
  const algo = msg.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  const sig = Buffer.from(msg.Signature, "base64");

  try {
    const verifier = crypto.createVerify(algo);
    verifier.update(canonical, "utf8");
    const ok = verifier.verify(pem, sig);
    return ok ? { ok: true } : { ok: false, reason: "signature mismatch" };
  } catch (err) {
    return { ok: false, reason: `verify error: ${(err as Error).message}` };
  }
}

export { logger as _snsLogger };
