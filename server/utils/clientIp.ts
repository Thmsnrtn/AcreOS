/**
 * getClientIp — resolve the real client IP behind Cloudflare → Fly → Express.
 *
 * Hop topology (Tier 1G verification, 2026-06-10):
 *
 *   client → Cloudflare edge (acreos.io is proxied/orange-cloud DNS)
 *          → Fly edge proxy
 *          → app machine (Express)
 *
 * Cloudflare sets `X-Forwarded-For: <client>` and `CF-Connecting-IP:
 * <client>`. The Fly proxy then APPENDS the peer it accepted the TCP
 * connection from — the Cloudflare EDGE IP — so the app receives
 * `XFF = "<client>, <cf-edge>"`. server/index.ts sets
 * `app.set("trust proxy", 1)`, which trusts exactly one hop (the Fly proxy,
 * our only direct peer) and therefore resolves `req.ip` to the RIGHTMOST
 * untrusted XFF entry — the Cloudflare edge IP, NOT the client. Any limiter
 * keying its IP component on `req.ip` was bucketing the whole internet into
 * a few hundred CF edge addresses.
 *
 * Why not `trust proxy = 2`: that fixes CF-routed traffic but opens a
 * spoofing hole for traffic that reaches Fly WITHOUT Cloudflare (the
 * acreos.fly.dev hostname, health probes, direct-IP hits): the client
 * controls every pre-Fly XFF entry, so with depth 2 an attacker simply
 * chooses their own `req.ip`.
 *
 * DECISION: prefer `CF-Connecting-IP` when present, else fall back to
 * `req.ip`. Trusted-hop reasoning: the canonical host acreos.io is only
 * reachable through Cloudflare (proxied DNS), and server/index.ts 301s
 * acreos.fly.dev → acreos.io before any limiter runs, so in practice the
 * header is stamped by Cloudflare itself. An attacker hitting the Fly edge
 * directly with a forged CF-Connecting-IP can only relabel THEIR OWN
 * traffic's IP component — and per memory/feedback_rate_limit_ip_keying.md
 * no hot-path limiter keys purely on IP (email/user/org composite keys are
 * the primary lanes), so the residual risk is dilution of a last-resort
 * floor, never a lockout of legitimate users or a quota escalation.
 */

import type { Request } from "express";

export function getClientIp(req: Request): string {
  // Optional-chained: unit tests (and some internal callers) pass minimal
  // request fakes without a headers object.
  const cf = req.headers?.["cf-connecting-ip"];
  const cfIp = Array.isArray(cf) ? cf[0] : cf;
  if (typeof cfIp === "string" && cfIp.trim().length > 0) {
    return cfIp.trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}
