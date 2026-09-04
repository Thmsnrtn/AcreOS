/**
 * F1 SSRF guard — unit tests for `validateUrl()`.
 *
 * Covers:
 *   - cloud metadata endpoints (169.254.169.254)
 *   - loopback (127.0.0.1) and private RFC1918 (10.0.0.1)
 *   - non-http(s) schemes (file://, javascript:)
 *   - public hostnames + public IPs (allowed)
 *   - DNS rebinding: a public hostname that resolves to a private IP is rejected
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Mock node:dns/promises before module under test imports it.
const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  default: { lookup: (...args: any[]) => lookupMock(...args) },
  lookup: (...args: any[]) => lookupMock(...args),
}));

import {
  validateUrl,
  SSRFBlockedError,
} from "../../server/middleware/fileUploadSecurity";

beforeEach(() => {
  lookupMock.mockReset();
  // Default: resolve any public hostname to a public IP (1.1.1.1).
  lookupMock.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
});

describe("validateUrl — F1 SSRF guard", () => {
  it("rejects AWS metadata endpoint 169.254.169.254", async () => {
    await expect(validateUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      SSRFBlockedError
    );
  });

  it("rejects GCP metadata endpoint metadata.google.internal", async () => {
    await expect(
      validateUrl("http://metadata.google.internal/computeMetadata/v1/")
    ).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects loopback 127.0.0.1", async () => {
    await expect(validateUrl("http://127.0.0.1:8080/admin")).rejects.toBeInstanceOf(
      SSRFBlockedError
    );
  });

  it("rejects 0.0.0.0", async () => {
    await expect(validateUrl("http://0.0.0.0/")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects localhost hostname", async () => {
    await expect(validateUrl("http://localhost/internal")).rejects.toBeInstanceOf(
      SSRFBlockedError
    );
  });

  it("rejects RFC1918 10.0.0.1", async () => {
    await expect(validateUrl("http://10.0.0.1/")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects RFC1918 192.168.1.1", async () => {
    await expect(validateUrl("http://192.168.1.1/")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects RFC1918 172.16.0.5", async () => {
    await expect(validateUrl("http://172.16.0.5/")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects link-local 169.254.0.1", async () => {
    await expect(validateUrl("http://169.254.0.1/")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects IPv6 loopback ::1", async () => {
    await expect(validateUrl("http://[::1]/")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects IPv6 link-local fe80::1", async () => {
    await expect(validateUrl("http://[fe80::1]/")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects file:// scheme", async () => {
    await expect(validateUrl("file:///etc/passwd")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects javascript: scheme", async () => {
    await expect(validateUrl("javascript:alert(1)")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects data: scheme", async () => {
    await expect(validateUrl("data:text/html,<script>1</script>")).rejects.toBeInstanceOf(
      SSRFBlockedError
    );
  });

  it("rejects gopher:// scheme", async () => {
    await expect(validateUrl("gopher://evil.example.com:11211/_stats")).rejects.toBeInstanceOf(
      SSRFBlockedError
    );
  });

  it("rejects empty / non-string input", async () => {
    await expect(validateUrl("")).rejects.toBeInstanceOf(SSRFBlockedError);
    // @ts-expect-error testing runtime behavior
    await expect(validateUrl(null)).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("rejects malformed URLs", async () => {
    await expect(validateUrl("not a url")).rejects.toBeInstanceOf(SSRFBlockedError);
  });

  it("accepts https://example.com", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    const url = await validateUrl("https://example.com/path");
    expect(url.hostname).toBe("example.com");
    expect(url.protocol).toBe("https:");
  });

  it("accepts a public IPv4 literal", async () => {
    const url = await validateUrl("https://1.1.1.1/dns-query");
    expect(url.hostname).toBe("1.1.1.1");
  });

  it("accepts a public IPv6 literal", async () => {
    const url = await validateUrl("https://[2606:4700:4700::1111]/");
    expect(url.hostname).toBe("[2606:4700:4700::1111]");
  });

  it("rejects DNS-rebinding: public hostname → private IP", async () => {
    // Hostname looks public, but resolves to a private RFC1918 IP at request time.
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.42", family: 4 }]);
    await expect(validateUrl("https://rebind.example.com/")).rejects.toBeInstanceOf(
      SSRFBlockedError
    );
  });

  it("rejects DNS-rebinding to AWS metadata IP", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(validateUrl("https://innocent.example.com/")).rejects.toBeInstanceOf(
      SSRFBlockedError
    );
  });

  it("rejects DNS-rebinding to IPv6 loopback", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "::1", family: 6 }]);
    await expect(validateUrl("https://innocent6.example.com/")).rejects.toBeInstanceOf(
      SSRFBlockedError
    );
  });

  it("rejects when ANY DNS answer is private (multi-record)", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(validateUrl("https://multi.example.com/")).rejects.toBeInstanceOf(
      SSRFBlockedError
    );
  });

  it("does not call DNS when hostname is already a literal IP", async () => {
    await validateUrl("https://1.1.1.1/").catch(() => {});
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("SSRFBlockedError carries a 422 statusCode", async () => {
    try {
      await validateUrl("http://127.0.0.1/");
      throw new Error("should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(SSRFBlockedError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe("SSRF_BLOCKED");
    }
  });
});

/**
 * ── THE SAME ADDRESS, SPELLED DIFFERENTLY ────────────────────────────────────
 *
 * The block above tests `[::1]` and `[fe80::1]`. Both were already in
 * `PRIVATE_HOSTNAME_PATTERNS` when it was written, so it enumerated the
 * spellings the implementation already knew and proved nothing about the ones
 * it did not — and there were eight, because a LITERAL IPv6 host skipped the
 * DNS branch on the grounds that "those were checked above". They were not:
 * `isPrivateIPv6` existed and was applied only to addresses DNS returned,
 * never to one a user typed.
 *
 * An IPv6 address has many spellings for the same 128 bits, so a prefix test
 * answers a question about the SPELLING rather than about the destination.
 * Measured 2026-09-04 by reverting the fix: these eight reached loopback, RFC
 * 1918 space, and the AWS metadata endpoint — the last one twice, once in
 * dotted form and once in hex.
 *
 * The table is the point. Adding a family to `isPrivateIPv6` without adding a
 * row here leaves the next spelling untested, which is how the first eight
 * survived a file with nineteen SSRF tests in it.
 */
describe("validateUrl — one address, every spelling (literal IPv6)", () => {
  const MUST_BLOCK: Array<[string, string]> = [
    ["http://[::ffff:127.0.0.1]/", "IPv4-mapped loopback"],
    ["http://[::ffff:169.254.169.254]/", "IPv4-mapped AWS metadata"],
    ["http://[::ffff:a9fe:a9fe]/", "AWS metadata, hex form of the same mapping"],
    ["http://[::ffff:10.0.0.5]/", "IPv4-mapped RFC 1918"],
    ["http://[64:ff9b::7f00:1]/", "loopback via NAT64 64:ff9b::/96"],
    ["http://[::]/", "unspecified address"],
    ["http://[ff02::1]/", "multicast — all nodes on the link"],
    ["http://[febf::1]/", "link-local at the top of fe80::/10"],
    // These four already passed before the fix. They stay so the table is the
    // whole family rather than only the part that was broken.
    ["http://[0:0:0:0:0:0:0:1]/", "loopback, uncompressed"],
    ["http://[::0001]/", "loopback, zero-padded"],
    ["http://[fd00::1]/", "unique-local"],
    ["http://[fe80::1%25eth0]/", "link-local carrying a zone id"],
  ];

  for (const [url, why] of MUST_BLOCK) {
    it(`rejects ${url} (${why})`, async () => {
      await expect(validateUrl(url)).rejects.toBeInstanceOf(SSRFBlockedError);
    });
  }

  it("does not over-block public IPv6 — the fix must not close the internet", async () => {
    // A guard that rejects everything passes every test above and is useless.
    for (const url of [
      "http://[2606:4700:4700::1111]/",
      "http://[2001:4860:4860::8888]/",
      "http://[2a00:1450:4001:800::200e]/",
    ]) {
      await expect(validateUrl(url)).resolves.toBeInstanceOf(URL);
    }
  });

  it("a literal address is decided WITHOUT a DNS lookup", async () => {
    // The literal branch must not depend on resolution: `dns.lookup` on an
    // address literal can succeed, fail or be skipped depending on the
    // platform, and a guard that needs it would be a guard that a resolver
    // outage turns off.
    lookupMock.mockReset();
    lookupMock.mockRejectedValue(new Error("resolver down"));
    await expect(validateUrl("http://[::ffff:169.254.169.254]/")).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("still blocks a public NAME that resolves to a mapped private address", async () => {
    // The DNS branch and the literal branch must agree. Rebinding to an
    // IPv4-mapped address is the same bypass arriving by a different door.
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "::ffff:169.254.169.254", family: 6 }]);
    await expect(validateUrl("https://rebound.example.com/")).rejects.toBeInstanceOf(
      SSRFBlockedError,
    );
  });
});

/**
 * ── ONE IMPLEMENTATION, ACTUALLY ADOPTED ─────────────────────────────────────
 *
 * CLAUDE.md's second law: authoritative semantics are one third of canonical.
 * The other two are real production adoption and drift prevention.
 *
 * `server/services/browserAutomation.ts` had its OWN `isPrivateIpv4` /
 * `isPrivateIpv6` pair, and by 2026-09-04 they had drifted: the IPv6 half
 * matched `::ffff:` only in DOTTED form, so `::ffff:a9fe:a9fe` — the AWS
 * metadata endpoint in hex — passed; it anchored link-local on the literal
 * `fe80:` rather than the fe80::/10 range, so `febf::1` passed; and it
 * modelled neither NAT64 nor multicast nor the uncompressed spelling of
 * loopback. Fixing one copy would have left the other reachable.
 *
 * This block is the drift half: it fails when a THIRD implementation appears,
 * which is the only way the two can diverge again.
 */
describe("the private-address rule has exactly one implementation", () => {
  const ROOT = path.resolve(__dirname, "../..");

  function serverFiles(dir = "server"): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!["node_modules", "__tests__", "__mocks__", "public", "dist"].includes(e.name)) {
          out.push(...serverFiles(rel));
        }
      } else if (e.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(e.name)) out.push(rel);
    }
    return out;
  }

  const files = serverFiles();

  it("scans a real population (vacuity guard)", () => {
    expect(files.length, "the walk found no server files, so this proves nothing").toBeGreaterThan(300);
  });

  it("only fileUploadSecurity DEFINES it; everyone else imports", () => {
    const definers = files.filter((f) =>
      /(?:export\s+)?function\s+isPrivateIp?v[46]\b/i.test(fs.readFileSync(path.join(ROOT, f), "utf8")),
    );
    expect(
      definers,
      "a second implementation of the private-address rule exists. Two copies " +
        "of one security rule is a rule as strong as whichever copy an " +
        "attacker reaches — that is how ::ffff:a9fe:a9fe stayed reachable " +
        "through browserAutomation after the other copy learned about it. " +
        "Import from server/middleware/fileUploadSecurity instead.",
    ).toEqual(["server/middleware/fileUploadSecurity.ts"]);
  });

  it("browserAutomation actually consumes it (adoption, not just availability)", () => {
    // A canonical function with no production callers is not canonical. This
    // is the assertion that would have failed while the exported version sat
    // unused beside a local copy.
    const src = fs.readFileSync(path.join(ROOT, "server/services/browserAutomation.ts"), "utf8");
    expect(src).toMatch(
      /import \{[^}]*isPrivateIPv4[^}]*isPrivateIPv6[^}]*\}\s*from\s*["'][^"']*fileUploadSecurity["']/,
    );
    // And it still calls them, so the import is not decorative.
    expect(src).toMatch(/isPrivateIpv6\(/);
    expect(src).toMatch(/isPrivateIpv4\(/);
  });
});
