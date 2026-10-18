/**
 * An https GET that cannot be pointed at AcreOS's own network — for content a
 * customer names (a letter PDF URL, an image inside letter HTML).
 *
 * A hostname check alone is not enough: a public-looking name can resolve to
 * 127.0.0.1, a private range, the cloud metadata address, or an IPv4-mapped
 * IPv6 address, and can resolve differently on a second lookup (rebinding).
 * So this resolves the name ONCE, rejects it unless EVERY address is public,
 * and connects to exactly that pinned address (TLS still verifies the
 * hostname). The body is streamed under a hard byte cap, redirects are not
 * followed, and the whole request is time-boxed.
 */
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

/** Expand an IPv6 literal (with an optional embedded dotted IPv4 tail) to 8 hextets, or null. */
function ipv6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tail: number[] = [];
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    if (o.some((x) => x > 255)) return null;
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = s.slice(0, s.length - v4[1].length);
    if (s.endsWith(":") && !s.endsWith("::")) s = s.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((n) => Number.isNaN(n))) return null;
  const fill = 8 - head.length - rest.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 0) return null;
  return [...head, ...Array(Math.max(0, fill)).fill(0), ...rest, ...tail];
}

function ipv4Blocked(ip: string): boolean {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = o;
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && o[2] === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/**
 * True when `ip` must never be connected to: loopback, private, link-local,
 * CGNAT, multicast, reserved, unspecified, unique-local IPv6, and any IPv6
 * form that embeds an IPv4 address (mapped, compatible, NAT64) of those.
 * Anything unparseable is blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return ipv4Blocked(ip);
  if (kind !== 6) return true;
  const h = ipv6Hextets(ip);
  if (!h) return true;
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible); :: and ::1 land here too.
    return ipv4Blocked(embedded(h[6], h[7]));
  }
  if (h[0] === 0x64 && h[1] === 0xff9b) return ipv4Blocked(embedded(h[6], h[7])); // NAT64
  if ((h[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  return false;
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const systemResolver: Resolver = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

/** Resolve once; refuse unless EVERY address is public. Returns the address to pin. */
export async function resolvePublicAddress(
  hostname: string,
  resolve: Resolver = systemResolver,
): Promise<{ address: string; family: number } | null> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await resolve(host);
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) return null;
  return addrs[0];
}

/** A `lookup` that answers every query with the one pinned address — no second resolution. */
export function pinnedLookup(address: string, family: number): LookupFunction {
  return ((_host: string, opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === "function" ? opts : cb) as (...args: unknown[]) => void;
    const all = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all;
    if (all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  }) as unknown as LookupFunction;
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
}

/**
 * GET `rawUrl` over https to a pinned public address. Null when the URL is not
 * https, resolves to a blocked address, redirects, exceeds `maxBytes`, or
 * times out. Never throws.
 */
export async function safeHttpsGet(
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs: number; resolve?: Resolver },
): Promise<SafeFetchResult | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  let pinned: { address: string; family: number } | null;
  try {
    pinned = await resolvePublicAddress(url.hostname, opts.resolve);
  } catch {
    return null;
  }
  if (!pinned) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: SafeFetchResult | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const req = https.request(
      {
        protocol: "https:",
        hostname: host,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        lookup: pinnedLookup(pinned!.address, pinned!.family),
        servername: net.isIP(host) ? undefined : host,
        timeout: opts.timeoutMs,
        headers: { "user-agent": "AcreOS-mail/1.0", accept: "*/*" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return done(null); // no redirects: one could lead past the address check
        }
        const declared = Number(res.headers["content-length"]);
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy();
          return done(null);
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.length;
          if (total > opts.maxBytes) {
            res.destroy();
            req.destroy();
            done(null);
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => done({ status, contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
        res.on("error", () => done(null));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(null);
    }, opts.timeoutMs);
    req.on("timeout", () => req.destroy());
    req.on("error", () => done(null));
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}
