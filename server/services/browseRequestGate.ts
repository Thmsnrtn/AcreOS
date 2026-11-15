/**
 * The request gate for Pax's public `browse_web` (R-14 / F-2).
 *
 * Pure decision logic, split out of browserAutomation.ts so the failure
 * semantics can be tested without launching Chromium. No DB imports, and no
 * import of browserAutomation.ts (that file imports this one).
 *
 * The one property this module exists to guarantee: **an error is never a
 * reason to let a request through.** `evaluateBrowseRequest` returns "continue"
 * only when the URL pattern check passed AND the DNS check positively
 * validated the host. Every throw, from either step, is an "abort".
 *
 * Residual (honest, not faked): this validates the addresses the host resolves
 * to NOW. Chromium re-resolves the name itself when it connects, and
 * puppeteer-core request interception offers no way to pin the connection to
 * the addresses validated here, so a DNS-rebinding window remains between the
 * check and the connect. Closing it needs a separate browser process behind an
 * egress-filtered network (PX-10), not anything in this module.
 */
import { logger } from "../utils/logger";
import { isPrivateIPv4 as isPrivateIpv4, isPrivateIPv6 as isPrivateIpv6 } from "../middleware/fileUploadSecurity";

export interface BrowseDnsDeps {
  resolve4?: (host: string) => Promise<string[]>;
  resolve6?: (host: string) => Promise<string[]>;
}

// DNS resolution for SSRF protection (moved verbatim from browserAutomation.ts)
const defaultResolve4 = (host: string): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const dns = require("dns");
    dns.resolve4(host, (err: Error | null, addresses: string[]) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
};

const defaultResolve6 = (host: string): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const dns = require("dns");
    dns.resolve6(host, (err: Error | null, addresses: string[]) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
};

/**
 * Resolve `hostname` and validate every address. NEVER throws.
 *
 * A family with no records is fine. If NEITHER family yields a validated
 * address (both resolvers failed, or returned nothing) the host is blocked
 * "as a precaution" — we cannot say where it points.
 */
export async function resolveAndCheckBrowseHost(
  hostname: string,
  deps?: BrowseDnsDeps,
): Promise<{ allowed: boolean; reason?: string; resolvedAddresses?: string[] }> {
  try {
    const resolve4 = deps?.resolve4 ?? defaultResolve4;
    const resolve6 = deps?.resolve6 ?? defaultResolve6;

    const parsed = new URL(`http://${hostname}`);
    const host = parsed.hostname;

    const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      if (isPrivateIpv4(host)) {
        return { allowed: false, reason: "Resolved to private IPv4 address" };
      }
      return { allowed: true, resolvedAddresses: [host] };
    }

    const validated: string[] = [];

    // Resolve hostname via DNS and validate all resolved IPs
    try {
      const ipv4Addresses = await resolve4(host);
      for (const addr of ipv4Addresses) {
        if (isPrivateIpv4(addr)) {
          logger.warn(`[SSRF] DNS resolved ${host} to private IPv4 ${addr}`);
          return { allowed: false, reason: `DNS resolved to private/internal IPv4 address: ${addr}` };
        }
        validated.push(addr);
      }
    } catch {
      // No IPv4 records is fine — check IPv6 next
    }

    try {
      const ipv6Addresses = await resolve6(host);
      for (const addr of ipv6Addresses) {
        if (isPrivateIpv6(addr)) {
          logger.warn(`[SSRF] DNS resolved ${host} to private IPv6 ${addr}`);
          return { allowed: false, reason: `DNS resolved to private/internal IPv6 address: ${addr}` };
        }
        validated.push(addr);
      }
    } catch {
      // No IPv6 records is fine
    }

    if (validated.length === 0) {
      return { allowed: false, reason: "DNS resolution failed — blocking as a precaution" };
    }

    return { allowed: true, resolvedAddresses: validated };
  } catch (err) {
    try {
      logger.warn(`[SSRF] DNS check error for ${hostname}`, { metadata: { detail: err } });
    } catch {
      // logging must not turn a block into a throw
    }
    return { allowed: false, reason: "DNS resolution failed — blocking as a precaution" };
  }
}

export function isBlockedBrowseUrl(urlString: string): { blocked: boolean; reason?: string } {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { blocked: true, reason: "Only HTTP/HTTPS URLs are allowed" };
    }

    if (hostname.startsWith("[") || hostname.includes(":")) {
      return { blocked: true, reason: "IPv6 addresses are not allowed" };
    }

    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match && isPrivateIpv4(hostname)) {
      return { blocked: true, reason: "Access to internal/private networks is not allowed" };
    }

    if (/^\d+$/.test(hostname)) {
      return { blocked: true, reason: "Numeric IP formats are not allowed" };
    }
    if (/^0x[0-9a-f]+$/i.test(hostname)) {
      return { blocked: true, reason: "Hex IP formats are not allowed" };
    }
    if (/^0[0-7]+$/.test(hostname)) {
      return { blocked: true, reason: "Octal IP formats are not allowed" };
    }

    const shortIpv4 = hostname.match(/^(\d+)\.(\d+)$/);
    if (shortIpv4) {
      return { blocked: true, reason: "Shorthand IPv4 formats are not allowed" };
    }
    const threePartIpv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (threePartIpv4) {
      return { blocked: true, reason: "Shorthand IPv4 formats are not allowed" };
    }

    if (/^0\d+\./.test(hostname) || /\.0\d+\./.test(hostname) || /\.0\d+$/.test(hostname)) {
      return { blocked: true, reason: "Octal IPv4 formats are not allowed" };
    }

    const blockedPatterns = [
      /^localhost$/i,
      /\.localhost$/i,
      /\.local$/i,
      /\.internal$/i,
      /^metadata\./i,
      /^instance-data\./i,
      /\.metadata\.google\.internal$/i,
    ];

    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        return { blocked: true, reason: "Access to internal/private networks is not allowed" };
      }
    }

    return { blocked: false };
  } catch {
    return { blocked: true, reason: "Invalid URL format" };
  }
}

/**
 * The fail-closed decision for one browser sub-request. Pattern check first,
 * then host check. "continue" is returned ONLY on a positive pass of both; any
 * block, any failure, any throw is "abort". Never throws.
 */
export async function evaluateBrowseRequest(
  urlString: string,
  deps?: BrowseDnsDeps,
): Promise<{ action: "continue" | "abort"; reason?: string }> {
  try {
    const pattern = isBlockedBrowseUrl(urlString);
    if (pattern.blocked) {
      return { action: "abort", reason: `URL pattern: ${pattern.reason ?? "blocked"}` };
    }

    const hostname = new URL(urlString).hostname;
    const host = await resolveAndCheckBrowseHost(hostname, deps);
    if (!host.allowed) {
      return { action: "abort", reason: `DNS resolve: ${host.reason ?? "blocked"}` };
    }

    return { action: "continue" };
  } catch (err) {
    return {
      action: "abort",
      reason: `Request check failed — blocking (${err instanceof Error ? err.message : "unknown error"})`,
    };
  }
}
