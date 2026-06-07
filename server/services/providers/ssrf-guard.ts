/**
 * SSRF guard for operator-contributed data-source URLs (Beatrice item 5).
 *
 * county_gis_endpoints.baseUrl is operator-contributed (`contributedBy`). We
 * fetch it server-side, which is a classic SSRF surface: a malicious or
 * mistaken row pointing at an internal address (169.254.169.254 metadata,
 * 10.x/192.168.x internal services, localhost) would let the fetch path reach
 * internal infrastructure. We also require https — a county GIS portal that
 * only speaks http is a downgrade we don't accept for a re-served data source.
 *
 * This is a hostname/IP-literal check applied at WRITE time. It blocks the
 * obvious literal-IP and localhost cases. A hostname that later resolves to a
 * private IP via DNS rebinding is out of scope here (would need resolve-time
 * pinning at fetch time) — but blocking the literal cases closes the live hole
 * the lens flagged.
 */

export interface SsrfCheckResult {
  ok: boolean;
  reason?: string;
}

/** Private / link-local / loopback IPv4 ranges + IPv6 loopback/ULA. */
function isPrivateOrReservedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // Loopback + obvious internal names.
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) {
    return true;
  }
  // IPv6 loopback + unique-local + link-local.
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
    return true;
  }

  // IPv4 literal?
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // a normal hostname — allowed (DNS-rebind out of scope)
  const oct = m.slice(1).map((n) => parseInt(n, 10));
  if (oct.some((n) => n > 255)) return true; // malformed → reject

  const [a, b] = oct;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * Validate an operator-contributed baseUrl for a data source. Rejects
 * non-https and private/loopback/link-local/metadata addresses.
 */
export function checkOperatorUrl(rawUrl: string): SsrfCheckResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "baseUrl is not a valid URL" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "baseUrl must use https" };
  }
  if (!url.hostname) {
    return { ok: false, reason: "baseUrl has no host" };
  }
  if (isPrivateOrReservedHost(url.hostname)) {
    return {
      ok: false,
      reason: "baseUrl resolves to a private, loopback, or link-local address (SSRF blocked)",
    };
  }
  return { ok: true };
}
