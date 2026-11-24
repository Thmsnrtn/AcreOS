/**
 * R-14 / F-2 — the browse_web request gate fails CLOSED.
 *
 * Before the fix, any error thrown while checking a sub-request (a resolver
 * throwing, a URL parse failure) landed in a catch that called
 * request.continue(). These tests pin that no error path returns "continue".
 */
import { describe, expect, it, vi } from "vitest";
import {
  evaluateBrowseRequest,
  isBlockedBrowseUrl,
  resolveAndCheckBrowseHost,
} from "../../server/services/browseRequestGate";

const ok4 = vi.fn(async () => ["93.184.216.34"]);
const none6 = vi.fn(async () => {
  throw new Error("ENODATA");
});

describe("evaluateBrowseRequest", () => {
  it("continues for a public host resolving to public addresses", async () => {
    const r = await evaluateBrowseRequest("https://example.com/page", {
      resolve4: async () => ["93.184.216.34"],
      resolve6: async () => ["2606:2800:220:1:248:1893:25c8:1946"],
    });
    expect(r.action).toBe("continue");
  });

  it("aborts a host resolving to a private IPv4", async () => {
    const r = await evaluateBrowseRequest("https://rebind.example.com/", {
      resolve4: async () => ["10.0.0.5"],
      resolve6: async () => [],
    });
    expect(r.action).toBe("abort");
  });

  it("aborts a host resolving to a private IPv6", async () => {
    const r = await evaluateBrowseRequest("https://rebind6.example.com/", {
      resolve4: async () => [],
      resolve6: async () => ["::1"],
    });
    expect(r.action).toBe("abort");
  });

  it("aborts when the resolvers throw (the F-2 regression: this used to continue)", async () => {
    const r = await evaluateBrowseRequest("https://example.com/", {
      resolve4: async () => {
        throw new Error("SERVFAIL");
      },
      resolve6: async () => {
        throw new Error("SERVFAIL");
      },
    });
    expect(r.action).toBe("abort");
  });

  it("aborts without any DNS call when the URL pattern is blocked", async () => {
    const resolve4 = vi.fn(async () => ["93.184.216.34"]);
    const resolve6 = vi.fn(async () => []);
    for (const url of [
      "http://localhost/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.1/",
    ]) {
      const r = await evaluateBrowseRequest(url, { resolve4, resolve6 });
      expect(r.action, url).toBe("abort");
    }
    expect(resolve4).not.toHaveBeenCalled();
    expect(resolve6).not.toHaveBeenCalled();
  });

  it("aborts (does not throw) on a malformed URL", async () => {
    await expect(evaluateBrowseRequest("not a url", { resolve4: ok4, resolve6: none6 })).resolves.toMatchObject({
      action: "abort",
    });
    await expect(evaluateBrowseRequest("", {})).resolves.toMatchObject({ action: "abort" });
  });
});

describe("resolveAndCheckBrowseHost", () => {
  it("never throws, even when both resolvers throw synchronously", async () => {
    const boom = (() => {
      throw new Error("sync boom");
    }) as unknown as (h: string) => Promise<string[]>;
    const r = await resolveAndCheckBrowseHost("example.com", { resolve4: boom, resolve6: boom });
    expect(r.allowed).toBe(false);
  });

  it("returns the validated addresses on success", async () => {
    const r = await resolveAndCheckBrowseHost("example.com", {
      resolve4: async () => ["93.184.216.34"],
      resolve6: none6,
    });
    expect(r).toEqual({ allowed: true, resolvedAddresses: ["93.184.216.34"] });
  });

  it("a family with no records is fine when the other validates", async () => {
    const r = await resolveAndCheckBrowseHost("example.com", {
      resolve4: async () => {
        throw new Error("ENODATA");
      },
      resolve6: async () => ["2606:2800:220:1:248:1893:25c8:1946"],
    });
    expect(r.allowed).toBe(true);
  });

  it("does not throw on an unparseable hostname", async () => {
    const r = await resolveAndCheckBrowseHost("exa mple.com:::", { resolve4: ok4, resolve6: none6 });
    expect(r.allowed).toBe(false);
  });
});

describe("isBlockedBrowseUrl (moved pattern rules still bite)", () => {
  it("blocks octal and shorthand IPv4 spellings", () => {
    expect(isBlockedBrowseUrl("http://0177.0.0.1/").blocked).toBe(true);
    expect(isBlockedBrowseUrl("http://127.1/").blocked).toBe(true);
  });

  it("blocks .internal suffix and non-http schemes", () => {
    expect(isBlockedBrowseUrl("http://db.corp.internal/").blocked).toBe(true);
    expect(isBlockedBrowseUrl("file:///etc/passwd").blocked).toBe(true);
  });

  it("allows an ordinary public hostname", () => {
    expect(isBlockedBrowseUrl("https://example.com/a?b=1")).toEqual({ blocked: false });
  });
});
