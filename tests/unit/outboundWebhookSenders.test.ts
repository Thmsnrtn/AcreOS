/**
 * Every outbound sender that posts to a customer-saved webhook URL runs the
 * shared outbound URL check (`validateUrl`) and a request timeout.
 *
 * The population is a REGISTRY of drivers, one per sender. Each driver calls
 * the real sender with a saved URL; only DNS, the database, the connector
 * store and `fetch` are stubbed. For every member:
 *   - a private-address URL is never fetched (the URL check ran);
 *   - a public URL is fetched with an AbortSignal (the timeout is wired).
 * A per-member vacuity check requires each driver to reach `fetch` on the
 * public URL, so a driver that silently stopped sending cannot pass.
 *
 * Completeness: a parse of server/ finds every `fetch(...)` whose first
 * argument is a `.webhookUrl` / `.url` property read off a stored record, and
 * each file it finds must be a registry member's file or a parse-checked
 * entry (a stored URL no customer saves; its fetch must pass a `signal` and
 * its function must run `validateUrl` on the same URL).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const H = vi.hoisted(() => ({ rows: [] as any[], connectorUrl: "", lookup: vi.fn() }));

vi.mock("node:dns/promises", () => ({
  default: { lookup: (...a: any[]) => H.lookup(...a) },
  lookup: (...a: any[]) => H.lookup(...a),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** A query-builder stand-in: every call chains, and awaiting it yields H.rows. */
function chain(): any {
  const target: any = () => undefined;
  const p: any = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return (res: any, rej: any) => Promise.resolve(H.rows).then(res, rej);
      return () => p;
    },
    apply: () => p,
  });
  return p;
}
const fakeDb = new Proxy({}, { get: () => () => chain() });

vi.mock("../../server/db", () => ({ db: fakeDb }));
vi.mock("../../server/storage", () => ({
  db: fakeDb,
  storage: {
    getOrganization: async () => ({ id: 7 }),
    getPaxConnector: async () => ({
      status: "connected",
      credentialsEncrypted: JSON.stringify({ webhookUrl: H.connectorUrl }),
    }),
  },
}));
vi.mock("../../server/utils/simulationMode", () => ({
  shouldSimulate: () => false,
  recordSimulatedAction: async () => undefined,
}));
vi.mock("../../server/services/fieldEncryption", () => ({
  decryptCredentials: (s: string) => s,
  encrypt: (s: string) => s,
  decrypt: (s: string) => s,
  isEncrypted: () => false,
}));

const ORG = { id: 7 } as any;

interface Sender {
  file: string;
  name: string;
  /** Point the sender at `url` and run it once. */
  drive: (url: string) => Promise<unknown>;
}

/** Every sender of a customer-saved webhook URL. Add new ones here. */
const SENDERS: Sender[] = [
  {
    file: "server/services/teamWebhookDispatcher.ts",
    name: "dispatchTeamEvent",
    drive: async (url) => {
      H.rows = [{ id: 1, organizationId: 7, provider: "slack", webhookUrl: url, eventTypes: ["deal_closed"], isActive: true }];
      const m = await import("../../server/services/teamWebhookDispatcher");
      return m.dispatchTeamEvent(7, "deal_closed", { title: "Deal closed", body: "Deal #1 closed." });
    },
  },
  {
    file: "server/services/webhookDispatcher.ts",
    name: "dispatchWebhook",
    drive: async (url) => {
      H.rows = [{ id: 1, organizationId: 7, provider: "webhooks", isEnabled: true, credentials: { endpoints: [{ url, events: "all", isActive: true }] } }];
      const m = await import("../../server/services/webhookDispatcher");
      return m.dispatchWebhook(7, "deal.created", { dealId: 1 });
    },
  },
  {
    file: "server/services/publicWebhookDispatcher.ts",
    name: "dispatchWebhookEvent",
    drive: async (url) => {
      H.rows = [{ id: 1, organizationId: 7, url, events: ["deal.closed"], isActive: true, signingSecret: "s" }];
      const m = await import("../../server/services/publicWebhookDispatcher");
      return m.dispatchWebhookEvent(7, "deal.closed", { dealId: 1 });
    },
  },
  {
    file: "server/services/connectors/executor.ts",
    name: "sendSlackMessage",
    drive: async (url) => {
      H.connectorUrl = url;
      const m = await import("../../server/services/connectors/executor");
      return m.sendSlackMessage(ORG, { message: "Deal #1 closed" });
    },
  },
  {
    file: "server/services/connectors/executor.ts",
    name: "triggerZapier",
    drive: async (url) => {
      H.connectorUrl = url;
      const m = await import("../../server/services/connectors/executor");
      return m.triggerZapier(ORG, { data: { dealId: 1 } });
    },
  },
  {
    file: "server/services/connectors/executor.ts",
    name: "triggerMake",
    drive: async (url) => {
      H.connectorUrl = url;
      const m = await import("../../server/services/connectors/executor");
      return m.triggerMake(ORG, { data: { dealId: 1 } });
    },
  },
  {
    file: "server/services/agentOrchestration.ts",
    name: "triggerSubscriptionAction",
    drive: async (url) => {
      const m = await import("../../server/services/agentOrchestration");
      const subscription = { id: 1, eventFilter: { triggerAction: "call_webhook", triggerConfig: { webhookUrl: url } } };
      return (m.agentOrchestration as any).triggerSubscriptionAction(subscription, { id: 1, eventType: "deal.closed", payload: {} }, 7);
    },
  },
];

const PUBLIC_URL = "https://hooks.example.com/in/abc";
const PRIVATE_URL = "http://10.0.0.5/in/abc";
const fetchMock = vi.fn();

beforeEach(() => {
  H.rows = [];
  H.connectorUrl = "";
  H.lookup.mockReset();
  H.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the registry", () => {
  it("holds every sender (vacuity floor)", () => {
    expect(SENDERS.length).toBeGreaterThanOrEqual(7);
    for (const s of SENDERS) {
      const src = fs.readFileSync(path.resolve(__dirname, "../..", s.file), "utf8");
      expect(src, `${s.name} is not declared in ${s.file}`).toMatch(new RegExp(`(?:export\\s+async\\s+function|private\\s+async)\\s+${s.name}\\b`));
    }
  });
});

describe.each(SENDERS)("$name ($file)", (s) => {
  it("reaches fetch for a public URL, with an AbortSignal", async () => {
    await s.drive(PUBLIC_URL);
    expect(fetchMock, "the driver never reached the send, so this member proves nothing").toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(PUBLIC_URL);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("never fetches a private-address URL", async () => {
    await s.drive(PRIVATE_URL);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("completeness: no fetch of a stored URL outside the registry", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const STORED_URL_PROPS = new Set(["webhookUrl", "url"]);
  /** Receivers whose `.url` is a stored webhook record (endpoint, subscription, integration row). */
  const STORED_RECEIVERS = /^(endpoint|ep|sub|subscription|target|integration|hook|webhook|creds|credentials|row|record)$/i;

  function serverFiles(dir = "server"): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!["node_modules", "__tests__", "__mocks__", "public", "dist"].includes(e.name)) out.push(...serverFiles(rel));
      } else if (e.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(e.name)) out.push(rel);
    }
    return out;
  }

  /**
   * Senders of a stored URL that no customer saves, so they sit outside the
   * registry. Each is still read here: its fetch must pass a `signal`, and the
   * enclosing function must run `validateUrl` on the same URL expression.
   */
  const PARSE_CHECKED: Record<string, string> = {
    "server/routes-title-partners.ts": "partner URL registered by the founder (POST /api/founder/title-partners), not saved by a customer",
  };

  interface StoredFetch {
    hasSignal: boolean;
    validatesSameUrl: boolean;
  }

  function enclosingFunction(node: ts.Node): ts.Node | undefined {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isFunctionLike(p)) return p;
    }
    return undefined;
  }

  function validatesUrl(fn: ts.Node | undefined, urlText: string, sf: ts.SourceFile): boolean {
    if (!fn) return false;
    let found = false;
    const visit = (n: ts.Node) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "validateUrl" &&
        n.arguments[0]?.getText(sf) === urlText
      ) {
        found = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(fn);
    return found;
  }

  function storedUrlFetchSites(file: string, text: string): StoredFetch[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const out: StoredFetch[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch") {
        const a = node.arguments[0];
        if (
          a &&
          ts.isPropertyAccessExpression(a) &&
          STORED_URL_PROPS.has(a.name.text) &&
          (a.name.text === "webhookUrl" || (ts.isIdentifier(a.expression) && STORED_RECEIVERS.test(a.expression.text)))
        ) {
          const init = node.arguments[1];
          const hasSignal =
            !!init &&
            ts.isObjectLiteralExpression(init) &&
            init.properties.some((p) => p.name && p.name.getText(sf) === "signal");
          out.push({ hasSignal, validatesSameUrl: validatesUrl(enclosingFunction(node), a.getText(sf), sf) });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  }

  function storedUrlFetches(file: string, text: string): number {
    return storedUrlFetchSites(file, text).length;
  }

  it("canary: the parse sees both shapes", () => {
    expect(storedUrlFetches("f.ts", "await fetch(creds.webhookUrl, { method: 'POST' });")).toBe(1);
    expect(storedUrlFetches("f.ts", "await fetch(sub.url, { method: 'POST' });")).toBe(1);
    expect(storedUrlFetches("f.ts", "// fetch(creds.webhookUrl)\nawait fetch(`https://api.example.com`);")).toBe(0);
  });

  it("every file that fetches a stored URL is a registry member", () => {
    const files = serverFiles();
    expect(files.length, "the walk found no server files").toBeGreaterThan(300);
    const members = new Set(SENDERS.map((s) => s.file));
    const found = new Map<string, number>();
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      if (!/\bfetch\s*\(/.test(text)) continue;
      const n = storedUrlFetches(f, text);
      if (n > 0) found.set(f, n);
    }
    // Floor: the three registry members that still fetch a stored property directly.
    expect([...found.keys()].sort()).toEqual(expect.arrayContaining(["server/services/agentOrchestration.ts", "server/services/publicWebhookDispatcher.ts", "server/services/teamWebhookDispatcher.ts"]));
    const outside = [...found.keys()].filter((f) => !members.has(f) && !(f in PARSE_CHECKED));
    expect(outside, `fetch of a stored webhook URL outside the registry:\n${outside.join("\n")}`).toEqual([]);
  });

  it("each parse-checked sender validates the same URL and passes a timeout signal", () => {
    for (const f of Object.keys(PARSE_CHECKED)) {
      const sites = storedUrlFetchSites(f, fs.readFileSync(path.join(ROOT, f), "utf8"));
      expect(sites.length, `${f}: no stored-URL fetch found, so this entry proves nothing`).toBeGreaterThan(0);
      for (const site of sites) {
        expect(site, f).toEqual({ hasSignal: true, validatesSameUrl: true });
      }
    }
  });

  it("canary: the parse check sees a missing URL check and a missing signal", () => {
    const bad = "async function f(p: any) { await validateUrl(other.url); await fetch(p.webhookUrl, { method: 'POST' }); }";
    expect(storedUrlFetchSites("f.ts", bad)).toEqual([{ hasSignal: false, validatesSameUrl: false }]);
    const good = "async function f(p: any, c: any) { await validateUrl(p.webhookUrl); await fetch(p.webhookUrl, { signal: c.signal }); }";
    expect(storedUrlFetchSites("f.ts", good)).toEqual([{ hasSignal: true, validatesSameUrl: true }]);
  });
});
