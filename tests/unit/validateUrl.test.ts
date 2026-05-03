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
