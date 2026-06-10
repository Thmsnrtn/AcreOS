/**
 * Tier 1B — domain policy for the Pax `browse_web` tool.
 *
 * The SSRF layer (validateUrl in server/middleware/fileUploadSecurity.ts
 * + the in-page request interception in browserAutomation.ts) blocks
 * private IPs / loopback / link-local / cloud metadata / non-http(s)
 * schemes. THIS module is the org-policy layer on top: an operator can
 * pin browsing to an allowlist or block specific domains without a
 * deploy.
 *
 *   BROWSE_WEB_DOMAIN_DENYLIST  — comma-separated domain suffixes that
 *                                 are always blocked (e.g. "evil.example,
 *                                 internal.acreos.com").
 *   BROWSE_WEB_DOMAIN_ALLOWLIST — if set and non-empty, ONLY hosts
 *                                 matching one of these suffixes may be
 *                                 browsed. Empty/unset = allow all
 *                                 public hosts (denylist still applies).
 *
 * Matching is suffix-based on full labels: "example.com" matches
 * "example.com" and "sub.example.com" but NOT "notexample.com".
 */

export interface BrowseDomainPolicyResult {
  allowed: boolean;
  reason?: string;
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((s) => s.length > 0);
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function checkBrowseDomainPolicy(
  hostname: string,
  env: { allowlist?: string; denylist?: string } = {
    allowlist: process.env.BROWSE_WEB_DOMAIN_ALLOWLIST,
    denylist: process.env.BROWSE_WEB_DOMAIN_DENYLIST,
  },
): BrowseDomainPolicyResult {
  const host = String(hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return { allowed: false, reason: "Empty hostname" };

  const denylist = parseList(env.denylist);
  for (const domain of denylist) {
    if (hostMatchesDomain(host, domain)) {
      return { allowed: false, reason: `Domain ${host} is blocked by policy` };
    }
  }

  const allowlist = parseList(env.allowlist);
  if (allowlist.length > 0) {
    const ok = allowlist.some((domain) => hostMatchesDomain(host, domain));
    if (!ok) {
      return {
        allowed: false,
        reason: `Domain ${host} is not on the browse allowlist`,
      };
    }
  }

  return { allowed: true };
}
