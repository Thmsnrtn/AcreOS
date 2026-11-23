/**
 * OFF-DEF-1 + OFF-DEF-2 — service-worker replay behaviour.
 *
 * These tests EXECUTE the real client/public/sw.js in a node vm with a fake
 * IndexedDB (counts open/close), a scripted fetch and a stubbed cookieStore.
 * Set SW_PATH to point the harness at a different copy of sw.js (used for the
 * red-green proof against the pre-fix file).
 *
 * Spec: hidden_files/off-def-cure-specs-2026-11.md §3.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const SW_PATH = process.env.SW_PATH || path.resolve(__dirname, "../../client/public/sw.js");
const SW_SRC = fs.readFileSync(SW_PATH, "utf8");

type Scripted = number | { status: number; body?: unknown } | "throw";

function makeSw(opts: {
  responses: Scripted[];
  cookie?: () => string | null;
  noCookieStore?: boolean;
  onFetch?: (n: number, h: Record<string, string>) => void;
}) {
  const store = new Map<number, any>();
  let seq = 0;
  const posted: any[] = [];
  const fetches: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const handlers: Record<string, (e: any) => void> = {};
  let opens = 0;
  let closes = 0;
  const clone = (v: any) => JSON.parse(JSON.stringify(v));

  const indexedDB = {
    open() {
      const req: any = {};
      opens++;
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({ createIndex() {} }),
        close() {
          closes++;
        },
        transaction() {
          const tx: any = {};
          const done = () => setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
          tx.objectStore = () => ({
            add(e: any) {
              const k = ++seq;
              store.set(k, clone(e));
              done();
              return { result: k };
            },
            put(e: any, k: number) {
              store.set(k, clone(e));
              done();
            },
            delete(k: number) {
              store.delete(k);
              done();
            },
            getAll() {
              const r: any = { result: [...store.values()].map(clone) };
              setTimeout(() => r.onsuccess && r.onsuccess(), 0);
              return r;
            },
            openCursor() {
              const entries = [...store.entries()];
              let i = 0;
              const r: any = {};
              const step = () =>
                setTimeout(() => {
                  const cur = i < entries.length ? { key: entries[i][0], value: clone(entries[i][1]), continue: () => { i++; step(); } } : null;
                  r.onsuccess({ target: { result: cur } });
                }, 0);
              step();
              return r;
            },
          });
          return tx;
        },
      };
      setTimeout(() => {
        req.result = db;
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    },
  };

  const responses = [...opts.responses];
  const sandbox: any = {
    console: { log() {}, warn() {}, error() {} },
    URL,
    Headers,
    Response,
    Date,
    Math,
    Promise,
    setTimeout,
    JSON,
    Object,
    Set,
    indexedDB,
    caches: {},
    self: {
      addEventListener: (t: string, h: (e: any) => void) => {
        handlers[t] = h;
      },
      skipWaiting() {},
      clients: { claim() {}, matchAll: async () => [{ postMessage: (m: any) => posted.push(m) }] },
      crypto: { randomUUID: () => "minted-key" },
    },
    fetch: async (url: string, o: any) => {
      const headers = Object.fromEntries(new Headers(o?.headers || {}).entries());
      fetches.push({ url, headers, body: o?.body });
      opts.onFetch?.(fetches.length, headers);
      const r = responses.shift();
      if (r === "throw" || r === undefined) throw new TypeError("network down");
      const status = typeof r === "number" ? r : r.status;
      const body = typeof r === "number" ? {} : r.body ?? {};
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
  };
  if (!opts.noCookieStore) {
    let n = 0;
    sandbox.cookieStore = {
      get: async () => {
        n++;
        const v = opts.cookie ? opts.cookie() : `fresh${n}`;
        return v === null ? null : { value: v };
      },
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox);
  const replay = () => vm.runInContext("replayOfflineQueue()", sandbox) as Promise<void>;
  const seed = (e: any) => {
    const k = ++seq;
    store.set(k, clone(e));
    return k;
  };
  const row = (over: any = {}) => ({
    url: "/api/leads",
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "stale" },
    body: "{}",
    idempotencyKey: "K1",
    retries: 0,
    data: { pathname: "/api/leads" },
    ...over,
  });
  const types = () => posted.map((m) => m.type);
  return { store, posted, fetches, handlers, replay, seed, row, types, stats: () => ({ opens, closes }) };
}

async function queueViaFetchHandler(sw: ReturnType<typeof makeSw>, headers: Record<string, string>) {
  let resp: Promise<any> | undefined;
  const request: any = {
    method: "POST",
    url: "https://x.test/api/leads",
    headers: new Headers(headers),
    clone: () => ({ text: async () => '{"a":1}' }),
  };
  // the handler's own fetch(request) must fail so the row is queued
  sw.handlers.fetch({ request, respondWith: (p: Promise<any>) => (resp = p) });
  return resp!;
}

describe("single-flight (OFF-DEF-1 §2A)", () => {
  it("coalesces a sync trigger and a message trigger into one drain", async () => {
    const sw = makeSw({ responses: [201, 201] });
    sw.seed(sw.row());
    sw.seed(sw.row({ idempotencyKey: "K2" }));
    const a = sw.replay();
    const b = sw.replay();
    await Promise.all([a, b]);
    expect(sw.fetches).toHaveLength(2); // each row sent once, not twice
    expect(sw.store.size).toBe(0);
    expect(sw.posted.filter((m) => m.type === "OFFLINE_SYNC_COMPLETE")).toEqual([{ type: "OFFLINE_SYNC_COMPLETE", count: 2 }]);
  });

  it("a trigger after the drain finished starts a fresh pass", async () => {
    const sw = makeSw({ responses: [201, 201] });
    sw.seed(sw.row());
    await sw.replay();
    sw.seed(sw.row({ idempotencyKey: "K2" }));
    await sw.replay();
    expect(sw.fetches).toHaveLength(2);
  });

  it("D5: rows queued mid-drain are drained in the same wake (bounded)", async () => {
    let sw: ReturnType<typeof makeSw>;
    sw = makeSw({
      responses: [201, 201],
      onFetch: (n) => {
        if (n === 1) sw.seed(sw.row({ idempotencyKey: "LATE" }));
      },
    });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.fetches.map((f) => f.headers["idempotency-key"])).toEqual(["K1", "LATE"]);
    expect(sw.store.size).toBe(0);
  });

  it("D5: the re-read is bounded to 3 passes and never re-sends re-queued 5xx rows", async () => {
    let sw: ReturnType<typeof makeSw>;
    sw = makeSw({
      responses: [201, 201, 201, 201, 201],
      onFetch: (n) => {
        sw.seed(sw.row({ idempotencyKey: `L${n}` })); // every send queues another row
      },
    });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.fetches).toHaveLength(3); // 3 passes, then stop
    expect(sw.store.size).toBe(1); // the last one waits for the next trigger

    const sw2 = makeSw({ responses: [500, 201] });
    sw2.seed(sw2.row());
    await sw2.replay();
    expect(sw2.fetches).toHaveLength(1); // the re-queued 500 row is not re-sent in-flight
    expect(sw2.store.size).toBe(1);
  });
});

describe("claim-then-send, key mint and canonical header (OFF-DEF-1 §2B/C)", () => {
  it("row is claim-deleted before the fetch", async () => {
    let sizeAtFetch = -1;
    let sw: ReturnType<typeof makeSw>;
    sw = makeSw({ responses: [201], onFetch: () => (sizeAtFetch = sw.store.size) });
    sw.seed(sw.row());
    await sw.replay();
    expect(sizeAtFetch).toBe(0);
  });

  it("legacy row without a key gets one minted and persisted before the fetch", async () => {
    let persisted: any;
    let sw: ReturnType<typeof makeSw>;
    sw = makeSw({ responses: ["throw"], onFetch: () => {} });
    const k = sw.seed(sw.row({ idempotencyKey: undefined }));
    await sw.replay();
    expect(sw.fetches[0].headers["idempotency-key"]).toBe("minted-key");
    // network error re-queued with the SAME minted key
    persisted = [...sw.store.values()][0];
    expect(persisted.idempotencyKey).toBe("minted-key");
    expect(k).toBeGreaterThan(0);
  });

  it("D2: queue time promotes a captured idempotency-key (any case) and strips csrf", async () => {
    const sw = makeSw({ responses: [] });
    const resp = await queueViaFetchHandler(sw, {
      "content-type": "application/json",
      "Idempotency-Key": "CAPTURED",
      "x-csrf-token": "tok",
    });
    expect(resp.status).toBe(202);
    const [entry] = [...sw.store.values()];
    expect(entry.idempotencyKey).toBe("CAPTURED");
    expect(Object.keys(entry.headers).map((h) => h.toLowerCase())).not.toContain("idempotency-key");
    expect(Object.keys(entry.headers).map((h) => h.toLowerCase())).not.toContain("x-csrf-token");
  });

  it("D2: queue time mints a key when none was captured", async () => {
    const sw = makeSw({ responses: [] });
    await queueViaFetchHandler(sw, { "content-type": "application/json" });
    expect([...sw.store.values()][0].idempotencyKey).toBe("minted-key");
  });

  it("D2: exactly one Idempotency-Key on the wire even if a legacy row stores one (any case)", async () => {
    const sw = makeSw({ responses: [201, 201] });
    sw.seed(sw.row({ headers: { "content-type": "a", "idempotency-key": "ORIG" } }));
    sw.seed(sw.row({ headers: { "content-type": "a", "IDEMPOTENCY-KEY": "ORIG2" }, idempotencyKey: "K2" }));
    await sw.replay();
    expect(sw.fetches[0].headers["idempotency-key"]).toBe("K1");
    expect(sw.fetches[1].headers["idempotency-key"]).toBe("K2");
  });
});

describe("CSRF fresh read + auth disposition (OFF-DEF-2)", () => {
  it("replays with the CURRENT cookie, never the stored token", async () => {
    const sw = makeSw({ responses: [201], cookie: () => "cur%20rent" });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.fetches[0].headers["x-csrf-token"]).toBe("cur rent");
  });

  it("403 → one fresh-header retry (cookie re-read) → 201: success once, same key", async () => {
    const sw = makeSw({ responses: [403, 201] });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.fetches).toHaveLength(2);
    expect(sw.fetches[0].headers["x-csrf-token"]).toBe("fresh1");
    expect(sw.fetches[1].headers["x-csrf-token"]).toBe("fresh2");
    expect(sw.fetches[1].headers["idempotency-key"]).toBe("K1");
    expect(sw.store.size).toBe(0);
    expect(sw.posted).toEqual([{ type: "OFFLINE_SYNC_COMPLETE", count: 1 }]);
  });

  it("D1: 403 → 403 retains the row with auth bookkeeping and posts AUTH_BLOCKED (not FAILED)", async () => {
    const sw = makeSw({ responses: [403, 403] });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.fetches).toHaveLength(2);
    const [kept] = [...sw.store.values()];
    expect(sw.store.size).toBe(1);
    expect(kept.authRetries).toBe(1);
    expect(kept.retries).toBe(1);
    expect(typeof kept.firstAuthFailureAt).toBe("number");
    expect(typeof kept.lastAuthFailureAt).toBe("number");
    expect(kept.idempotencyKey).toBe("K1");
    expect(sw.types()).toEqual(["OFFLINE_SYNC_AUTH_BLOCKED"]);
    expect(sw.types()).not.toContain("OFFLINE_SYNC_FAILED");
  });

  it("D1: 401 → 401 behaves the same, and the drain continues to later rows", async () => {
    const sw = makeSw({ responses: [401, 401, 201] });
    sw.seed(sw.row());
    sw.seed(sw.row({ idempotencyKey: "K2" }));
    await sw.replay();
    expect(sw.types()).toEqual(["OFFLINE_SYNC_AUTH_BLOCKED", "OFFLINE_SYNC_COMPLETE"]);
    expect(sw.store.size).toBe(1);
  });

  it("D1: ceiling — 10 auth failures but <7 days: still retained", async () => {
    const sw = makeSw({ responses: [403, 403] });
    sw.seed(sw.row({ authRetries: 20, firstAuthFailureAt: Date.now() - 2 * 86400000 }));
    await sw.replay();
    expect(sw.store.size).toBe(1);
    expect(sw.types()).toEqual(["OFFLINE_SYNC_AUTH_BLOCKED"]);
  });

  it("D1: ceiling — 7 days but <10 auth failures: still retained", async () => {
    const sw = makeSw({ responses: [403, 403] });
    sw.seed(sw.row({ authRetries: 3, firstAuthFailureAt: Date.now() - 30 * 86400000 }));
    await sw.replay();
    expect(sw.store.size).toBe(1);
    expect(sw.types()).toEqual(["OFFLINE_SYNC_AUTH_BLOCKED"]);
  });

  it("D1: ceiling — 10th auth failure AND 7 days: dropped, with OFFLINE_SYNC_FAILED (never silent)", async () => {
    const sw = makeSw({ responses: [403, 403] });
    sw.seed(sw.row({ authRetries: 9, firstAuthFailureAt: Date.now() - 8 * 86400000 }));
    await sw.replay();
    expect(sw.store.size).toBe(0);
    expect(sw.types()).toEqual(["OFFLINE_SYNC_FAILED"]);
    expect(sw.posted[0].status).toBe(403);
  });
});

describe("remaining disposition table", () => {
  it("400 / 422 / 404: dropped with OFFLINE_SYNC_FAILED, no retry", async () => {
    for (const status of [400, 404, 422]) {
      const sw = makeSw({ responses: [status] });
      sw.seed(sw.row());
      await sw.replay();
      expect(sw.fetches).toHaveLength(1);
      expect(sw.store.size).toBe(0);
      expect(sw.posted).toEqual([expect.objectContaining({ type: "OFFLINE_SYNC_FAILED", status })]);
    }
  });

  it("5xx: re-queued with retries+1 and the same key, no message", async () => {
    const sw = makeSw({ responses: [503] });
    sw.seed(sw.row());
    await sw.replay();
    const [kept] = [...sw.store.values()];
    expect(kept.retries).toBe(1);
    expect(kept.idempotencyKey).toBe("K1");
    expect(sw.posted).toEqual([]);
  });

  it("network error: row re-queued, drain stops (later rows untouched)", async () => {
    const sw = makeSw({ responses: ["throw"] });
    sw.seed(sw.row());
    sw.seed(sw.row({ idempotencyKey: "K2" }));
    await sw.replay();
    expect(sw.fetches).toHaveLength(1);
    expect(sw.store.size).toBe(2);
  });

  it("D3: a 3xx is never silently dropped — row retained and a message posted", async () => {
    const sw = makeSw({ responses: [302] });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.store.size).toBe(1);
    expect([...sw.store.values()][0].retries).toBe(1);
    expect(sw.posted).toHaveLength(1);
    expect(sw.posted[0]).toMatchObject({ type: "OFFLINE_SYNC_DEFERRED", status: 302 });
  });

  it("D3: 3xx on the post-403 retry is retained too", async () => {
    const sw = makeSw({ responses: [403, 302] });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.store.size).toBe(1);
    expect(sw.types()).toEqual(["OFFLINE_SYNC_DEFERRED"]);
  });

  it("409 IDEMPOTENCY_IN_PROGRESS: retained, no FAILED", async () => {
    const sw = makeSw({ responses: [{ status: 409, body: { code: "IDEMPOTENCY_IN_PROGRESS" } }] });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.store.size).toBe(1);
    expect(sw.posted).toEqual([]);
  });

  it("D4: other 409 is a permanent drop with FAILED", async () => {
    const sw = makeSw({ responses: [{ status: 409, body: { code: "CONFLICT" } }] });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.store.size).toBe(0);
    expect(sw.posted).toEqual([expect.objectContaining({ type: "OFFLINE_SYNC_FAILED", status: 409 })]);
  });

  it("D4: after the fresh-header retry, 409 body code decides (IN_PROGRESS retained, other dropped)", async () => {
    const a = makeSw({ responses: [403, { status: 409, body: { code: "IDEMPOTENCY_IN_PROGRESS" } }] });
    a.seed(a.row());
    await a.replay();
    expect(a.store.size).toBe(1);
    expect(a.posted).toEqual([]);

    const b = makeSw({ responses: [403, { status: 409, body: { code: "CONFLICT" } }] });
    b.seed(b.row());
    await b.replay();
    expect(b.store.size).toBe(0);
    expect(b.types()).toEqual(["OFFLINE_SYNC_FAILED"]);
  });

  it("no cookieStore: still sends (header omitted), row not dropped on 403", async () => {
    const sw = makeSw({ responses: [403, 403], noCookieStore: true });
    sw.seed(sw.row());
    await sw.replay();
    expect(sw.fetches[0].headers["x-csrf-token"]).toBeUndefined();
    expect(sw.store.size).toBe(1);
  });
});

describe("connection close (OFF-DEF-1 §2E)", () => {
  it("every opened IndexedDB connection is closed after a full replay", async () => {
    const sw = makeSw({ responses: [403, 403, 201] });
    sw.seed(sw.row());
    sw.seed(sw.row({ idempotencyKey: "K2", idempotencyKey_: 1 }));
    await sw.replay();
    const { opens, closes } = sw.stats();
    expect(opens).toBeGreaterThan(4);
    expect(closes).toBe(opens);
  });
});
