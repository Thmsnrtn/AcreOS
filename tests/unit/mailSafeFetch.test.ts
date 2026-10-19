/**
 * Content a customer names (a letter PDF URL, an image inside letter HTML) is
 * fetched by AcreOS only from PUBLIC addresses (server/services/mail/
 * safeFetch.ts): the name is resolved once, EVERY address must be public, the
 * connection is pinned to that address, and the body is byte-capped.
 */
import { describe, it, expect } from "vitest";
import { isBlockedAddress, resolvePublicAddress, pinnedLookup, safeHttpsGet } from "../../server/services/mail/safeFetch";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // IPv4-mapped, hex form
    "::ffff:a9fe:a9fe", // mapped 169.254.169.254
    "::127.0.0.1", // IPv4-compatible
    "64:ff9b::7f00:1", // NAT64 of 127.0.0.1
    "fc00::1",
    "fd12:3456::1", // unique local
    "fe80::1", // link-local
    "ff02::1", // multicast
    "not-an-ip",
  ])("%s is blocked", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:93.184.216.34"])("%s is public", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe("resolvePublicAddress — DNS resolved once, every answer checked", () => {
  const resolver = (answers: string[]) => async () => answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("a public name that RESOLVES to loopback is refused (rebinding-style)", async () => {
    expect(await resolvePublicAddress("letters.example.com", resolver(["127.0.0.1"]))).toBeNull();
  });

  it("one private answer among public ones refuses the name", async () => {
    expect(await resolvePublicAddress("letters.example.com", resolver(["93.184.216.34", "10.0.0.5"]))).toBeNull();
  });

  it("a name resolving to a mapped-IPv6 loopback is refused", async () => {
    expect(await resolvePublicAddress("letters.example.com", resolver(["::ffff:7f00:1"]))).toBeNull();
  });

  it("an all-public name is pinned to its first address", async () => {
    expect(await resolvePublicAddress("letters.example.com", resolver(["93.184.216.34", "93.184.216.35"]))).toEqual({
      address: "93.184.216.34",
      family: 4,
    });
  });

  it("IP literals are judged without DNS, brackets and all", async () => {
    const never = async () => {
      throw new Error("resolver must not be called for a literal");
    };
    expect(await resolvePublicAddress("[::ffff:7f00:1]", never)).toBeNull();
    expect(await resolvePublicAddress("127.0.0.1", never)).toBeNull();
    expect(await resolvePublicAddress("93.184.216.34", never)).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("the pinned lookup answers every query with the one checked address — no second resolution", async () => {
    const lookup = pinnedLookup("93.184.216.34", 4) as unknown as (h: string, o: unknown, cb: (...a: unknown[]) => void) => void;
    const single = await new Promise<unknown[]>((r) => lookup("letters.example.com", {}, (...a) => r(a)));
    expect(single).toEqual([null, "93.184.216.34", 4]);
    const all = await new Promise<unknown[]>((r) => lookup("letters.example.com", { all: true }, (...a) => r(a)));
    expect(all).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
  });
});

describe("safeHttpsGet refuses before connecting", () => {
  const publicResolver = async () => [{ address: "127.0.0.1", family: 4 }];
  it.each([
    "http://letters.example.com/a.pdf", // not https
    "https://127.0.0.1/a.pdf",
    "https://2130706433/a.pdf", // decimal IPv4 → 127.0.0.1 (URL parser normalizes)
    "https://0177.0.0.1/a.pdf", // octal IPv4 → 127.0.0.1
    "https://0x7f.0.0.1/a.pdf", // hex IPv4
    "https://[::ffff:7f00:1]/a.pdf", // mapped IPv6 literal
    "https://[::ffff:169.254.169.254]/latest/meta-data", // mapped metadata
    "https://user:pw@letters.example.com/a.pdf", // credentials in URL
    "https://letters.example.com/a.pdf", // resolves to loopback
  ])("%s → null", async (url) => {
    expect(await safeHttpsGet(url, { maxBytes: 1024, timeoutMs: 1000, resolve: publicResolver })).toBeNull();
  });
});

describe("safeHttpsGet applies the outbound source block-list (it bypasses the fetch guard)", () => {
  it("a retired data service named in a letter is refused before DNS", async () => {
    let resolved = false;
    const url = "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0/query";
    const r = await safeHttpsGet(url, { maxBytes: 1024, timeoutMs: 1000, resolve: async () => ((resolved = true), [{ address: "93.184.216.34", family: 4 }]) });
    expect(r).toBeNull();
    expect(resolved).toBe(false);
  });
});
