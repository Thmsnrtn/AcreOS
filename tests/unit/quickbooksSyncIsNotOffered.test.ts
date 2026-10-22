/**
 * QuickBooks Online sync is not offered, because it cannot succeed.
 *
 * ── THE DEFECT (audit 2026-10) ──────────────────────────────────────────────
 * The Finance page showed every customer a "Sync to QuickBooks" button that
 * POSTed to /api/bookkeeping/quickbooks/sync. That route needs a stored QBO
 * `accessToken`, and nothing in the repository ever writes one:
 *
 *   - GET /api/integrations/quickbooks/callback stored Intuit's one-time
 *     authorization CODE as the credential ("simplified — in prod exchange
 *     code for tokens") and never exchanged it;
 *   - POST /api/integrations/quickbooks/sync was a TODO that could not run;
 *   - getQboOAuthUrl() built a consent URL whose redirect target,
 *     /api/integrations/qbo/callback, is mounted nowhere.
 *
 * So the button failed for 100% of customers, and the connect flow could walk
 * one through Intuit consent to "connected=quickbooks" holding nothing usable.
 *
 * The honest path — the ledger export at GET /api/accounting/qbo-export — is
 * untouched and pinned below so this fix cannot be "completed" by deleting it.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(ent.name)) acc.push(full);
  }
  return acc;
}

describe("no client surface calls a QuickBooks sync/connect endpoint", () => {
  const files = walk(path.join(ROOT, "client/src"));

  it("vacuity: the client population is the whole tree", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith(path.join("pages", "finance.tsx")))).toBe(true);
  });

  it("no client file names a QuickBooks sync, connect, auth-url or callback route", () => {
    // The population is every client file, not finance.tsx: a second button
    // somewhere else is the same defect.
    const re = /quickbooks\/(sync|connect|auth-url|callback)|integrations\/qbo\//;
    const offenders = files
      .filter((f) => re.test(stripComments(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(ROOT, f));
    expect(
      offenders,
      "a client surface offers QuickBooks Online sync/connect again — no route can obtain a " +
        "QuickBooks access token, so it can only ever fail",
    ).toEqual([]);
  });

  it("the finance page has no QuickBooks sync control", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "client/src/pages/finance.tsx"), "utf8"));
    expect(src).not.toMatch(/data-testid="button-qbo-sync"/);
    expect(src).not.toMatch(/Sync to QuickBooks/);
    // Negative control: the page still renders its real export button.
    expect(src).toMatch(/data-testid="button-export-notes"/);
  });
});

describe("the server refuses the QuickBooks flow instead of pretending (driven)", () => {
  it("connect, callback and sync all answer 501 and store nothing", async () => {
    const execute = vi.fn();
    vi.doMock("../../server/storage", () => ({ storage: {}, db: { execute } }));
    const { registerPlatformFeatureRoutes } = await import("../../server/routes-platform-features");

    const handlers = new Map<string, Function[]>();
    const record = (method: string) => (p: string, ...h: Function[]) => {
      handlers.set(`${method} ${p}`, h);
    };
    const app = { get: record("GET"), post: record("POST"), put: record("PUT"), patch: record("PATCH"), delete: record("DELETE"), use: () => {} };
    registerPlatformFeatureRoutes(app as never);

    for (const key of [
      "GET /api/integrations/quickbooks/connect",
      "GET /api/integrations/quickbooks/callback",
      "POST /api/integrations/quickbooks/sync",
    ]) {
      const chain = handlers.get(key);
      expect(chain, `${key} is no longer registered — re-anchor this`).toBeDefined();
      const final = chain![chain!.length - 1];
      let status = 0;
      let body: any;
      let redirected: string | undefined;
      const res: any = {
        status(c: number) { status = c; return res; },
        json(b: unknown) { body = b; return res; },
        redirect(u: string) { redirected = u; return res; },
        setHeader() { return res; },
      };
      const req: any = {
        query: { code: "AB11-intuit-one-time-code", realmId: "123" },
        organization: { id: 7 },
        body: {},
      };
      await final(req, res, () => {});
      expect(redirected, `${key} redirected as if connected`).toBeUndefined();
      expect(status, `${key} did not refuse`).toBe(501);
      expect(body?.message).toMatch(/QuickBooks/);
    }
    expect(execute, "a QuickBooks route wrote to the database").not.toHaveBeenCalled();
    vi.doUnmock("../../server/storage");
  });

  it("getQboOAuthUrl refuses rather than handing out a dead-end consent URL", async () => {
    vi.resetModules();
    const prev = process.env.QBO_CLIENT_ID;
    process.env.QBO_CLIENT_ID = "configured-client-id";
    try {
      const { getQboOAuthUrl } = await import("../../server/services/bookkeeping");
      expect(() => getQboOAuthUrl(1)).toThrow(/not implemented/i);
    } finally {
      if (prev === undefined) delete process.env.QBO_CLIENT_ID;
      else process.env.QBO_CLIENT_ID = prev;
    }
  });

  it("the honest ledger export still exists (negative control)", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-accounting.ts"), "utf8"));
    expect(src).toMatch(/router\.get\("\/qbo-export"/);
  });
});
