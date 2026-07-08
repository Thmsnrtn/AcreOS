import crypto from "crypto";
import https from "https";
import { logger } from "../utils/logger";

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

const certCache = new Map<string, string>();

async function fetchSigningCert(certUrl: string): Promise<string> {
  const cached = certCache.get(certUrl);
  if (cached) return cached;

  const url = new URL(certUrl);
  if (url.protocol !== "https:") {
    throw new Error(`SNS SigningCertURL must use HTTPS: ${certUrl}`);
  }
  if (!SNS_HOST_RE.test(url.hostname)) {
    throw new Error(`SNS SigningCertURL host not allowed: ${url.hostname}`);
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

/** Confirm an SNS subscription by GETting the (host-validated) SubscribeURL. */
export async function confirmSubscription(subscribeUrl: string): Promise<void> {
  // The SubscribeURL is an sns.<region>.amazonaws.com URL; validate the host
  // before fetching so a forged envelope can't make us GET an arbitrary URL.
  const url = new URL(subscribeUrl);
  if (url.protocol !== "https:" || !SNS_HOST_RE.test(url.hostname)) {
    throw new Error(`SNS SubscribeURL host not allowed: ${url.hostname}`);
  }
  await subscribeConfirmer(subscribeUrl);
}

export async function verifySnsMessage(msg: SnsMessage): Promise<{ ok: boolean; reason?: string }> {
  if (!msg.Type || !msg.MessageId || !msg.Signature || !msg.SignatureVersion) {
    return { ok: false, reason: "missing required SNS fields" };
  }
  if (msg.SignatureVersion !== "1" && msg.SignatureVersion !== "2") {
    return { ok: false, reason: `unsupported SignatureVersion ${msg.SignatureVersion}` };
  }
  const certUrl = msg.SigningCertURL || (msg.SigningCertUrl as string | undefined);
  if (!certUrl) return { ok: false, reason: "missing SigningCertURL" };

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
