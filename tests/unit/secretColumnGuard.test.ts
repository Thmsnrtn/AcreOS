/**
 * The response guard removes registered secret columns from JSON responses —
 * through arrays, nested joins and snapshots — without mangling anything
 * else, and it is installed app-wide in server/index.ts before any route.
 *
 * See server/utils/secretColumns.ts (registry + stripSecretColumns) and
 * server/middleware/secretColumnGuard.ts (the res.json wrap).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { stripComments } from "../helpers/stripComments";

const H = vi.hoisted(() => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/utils/logger", () => ({ logger: H.logger }));

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

import {
  leads,
  organizations,
  contractors,
  organizationInvitations,
  founderAdAccounts,
  acquiredNotes,
} from "@shared/schema";
import { stripSecretColumns, omitSecretColumns, SECRET_COLUMNS } from "../../server/utils/secretColumns";
import { secretColumnGuard } from "../../server/middleware/secretColumnGuard";
import { registry, __resetMetricsForTesting } from "../../server/metrics";

/** Every column of `table` set to a placeholder, then `overrides`. */
function rowOf(table: PgTable, overrides: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(getTableColumns(table))) row[key] = `v_${key}`;
  return { ...row, ...overrides };
}

const lead = () => rowOf(leads, { id: 1, firstName: "Dana", taxId: "aa11:bb22:cc33:dd44", taxIdType: "SSN" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stripSecretColumns", () => {
  it("removes a lead row's tax identity and keeps every other column", () => {
    const input = lead();
    const { value, stripped } = stripSecretColumns(input);
    const out = value as Record<string, unknown>;
    expect(out).not.toHaveProperty("taxId");
    expect(out).not.toHaveProperty("taxIdType");
    expect(Object.keys(out).length).toBe(Object.keys(input).length - 2);
    expect(out.firstName).toBe("Dana");
    expect(stripped.map((s) => `${s.table}.${s.key}`).sort()).toEqual(["leads.taxId", "leads.taxIdType"]);
  });

  it("never mutates its input, and returns an untouched payload by reference", () => {
    const input = lead();
    stripSecretColumns(input);
    expect(input.taxId).toBe("aa11:bb22:cc33:dd44");
    const clean = { data: [{ id: 1, name: "x" }], when: new Date(0) };
    expect(stripSecretColumns(clean).value).toBe(clean);
  });

  it("walks arrays, nested joins and audit snapshots", () => {
    const payload = {
      data: [lead(), lead()],
      join: [{ deal: { id: 9, title: "Lot 4" }, lead: lead() }],
      audit: { changes: { before: lead(), after: { ...lead(), score: 10 } } },
      org: rowOf(organizations, { ein: "enc-ein", taxIdType: "EIN" }),
    };
    const { value, stripped } = stripSecretColumns(payload);
    const text = JSON.stringify(value);
    expect(text).not.toContain('"taxId"');
    expect(text).not.toContain("aa11:bb22");
    expect(text).not.toContain('"ein"');
    expect((value as any).join[0].deal).toEqual({ id: 9, title: "Lot 4" });
    expect((value as any).audit.changes.after.score).toBe(10);
    expect(stripped.map((s) => s.path)).toEqual(
      expect.arrayContaining(["data[0].taxId", "data[1].taxIdType", "join[0].lead.taxId", "audit.changes.before.taxId", "org.ein"]),
    );
  });

  it("treats a wide select (a row missing a few columns) as a row", () => {
    const wide = lead();
    for (const k of Object.keys(wide).filter((k) => k !== "taxIdType").slice(0, 8)) delete wide[k];
    const out = stripSecretColumns(wide).value as Record<string, unknown>;
    expect(out).not.toHaveProperty("taxIdType");
  });

  it("strips a distinctive key from a partial projection too ('anywhere' entries)", () => {
    const { value } = stripSecretColumns({ id: 1, taxId: "x", payerEncryptedTin: "y", taxIdEncrypted: "z" });
    expect(value).toEqual({ id: 1 });
  });

  it("keeps a generic key outside a row of its table ('row' entries)", () => {
    // Org tax-identity view: taxIdType is served and read by settings/tax-identity.
    const taxView = { legalEntityName: "Acme", taxIdType: "EIN", taxIdLast4: "6789", captured: true };
    expect(stripSecretColumns(taxView).value).toBe(taxView);
    // A contractor row keeps taxIdType (read by pages/contractors) and loses the ciphertext column.
    const contractor = rowOf(contractors, { taxIdEncrypted: "enc", taxIdType: "ein" });
    const c = stripSecretColumns(contractor).value as Record<string, unknown>;
    expect(c).not.toHaveProperty("taxIdEncrypted");
    expect(c.taxIdType).toBe("ein");
    // A note row keeps payerTinType (read by pages/note-detail).
    const note = stripSecretColumns(rowOf(acquiredNotes, { payerEncryptedTin: "enc", payerTinType: "SSN" })).value as Record<string, unknown>;
    expect(note).not.toHaveProperty("payerEncryptedTin");
    expect(note.payerTinType).toBe("SSN");
    // A map-config payload named accessToken is not a stored credential row.
    const mapConfig = { accessToken: "pk.public", style: "streets" };
    expect(stripSecretColumns(mapConfig).value).toBe(mapConfig);
  });

  it("keeps the invite-create projection's one-time token, removes the stored row's", () => {
    const created = { id: 1, email: "a@b.co", role: "member", token: "plain", tokenLast4: "lain", expiresAt: "2026-11-01", link: "https://x/auth?invite=plain" };
    expect(stripSecretColumns(created).value).toBe(created);
    const stored = stripSecretColumns(rowOf(organizationInvitations, { token: "legacy", inviteTokenHash: "h" })).value as Record<string, unknown>;
    expect(stored).not.toHaveProperty("token");
    expect(stored).not.toHaveProperty("inviteTokenHash");
    expect(stored.inviteTokenLast4).toBeDefined();
  });

  it("removes a founder ad-account row's credentials", () => {
    const out = stripSecretColumns(rowOf(founderAdAccounts, { accessToken: "EAA...", appSecret: "s" })).value as Record<string, unknown>;
    expect(out).not.toHaveProperty("accessToken");
    expect(out).not.toHaveProperty("appSecret");
    expect(out.adAccountId).toBeDefined();
  });

  it("removes any property whose value carries the encryption-envelope prefix, whatever the key", () => {
    const { value, stripped } = stripSecretColumns({
      provider: "lob",
      credentials: { encrypted: "enc:v1:eyJ2IjoxfQ==" },
      masked: { credentials: { hasApiKey: true, maskedKey: "sk_l...9f3c" } },
      list: ["enc:v1:abc"],
    });
    expect(value).toEqual({
      provider: "lob",
      credentials: {},
      masked: { credentials: { hasApiKey: true, maskedKey: "sk_l...9f3c" } },
      list: ["enc:v1:abc"], // array elements are values, not columns: left as-is
    });
    expect(stripped).toEqual([{ table: "envelope", key: "encrypted", path: "credentials.encrypted" }]);
  });

  it("leaves class instances as leaves and counts a cycle instead of looping", () => {
    const buf = Buffer.from("x");
    const d = new Date(0);
    const cyclic: Record<string, unknown> = { id: 1 };
    cyclic.self = cyclic;
    const { value, unwalked } = stripSecretColumns({ buf, d, cyclic });
    expect((value as any).buf).toBe(buf);
    expect((value as any).d).toBe(d);
    expect(unwalked).toBe(1);
  });

  it("omitSecretColumns removes exactly the table's registered keys", () => {
    const out = omitSecretColumns(leads, lead());
    const expected = SECRET_COLUMNS.filter((e) => e.table === "leads").map((e) => e.key).sort();
    expect(expected).toEqual(["taxId", "taxIdType"]);
    for (const k of expected) expect(out).not.toHaveProperty(k);
    expect(out.firstName).toBe("Dana");
  });
});

describe("secretColumnGuard middleware", () => {
  function app() {
    const a = express();
    a.use(secretColumnGuard);
    a.get("/x/:id", (_req, res) => {
      res.json({ lead: lead() });
    });
    a.get("/send", (_req, res) => {
      res.send([lead()]);
    });
    a.get("/clean", (_req, res) => {
      res.json({ ok: true });
    });
    return a;
  }

  it("strips res.json bodies, logs route + keys, and counts each removal", async () => {
    __resetMetricsForTesting();
    const res = await request(app()).get("/x/42");
    expect(res.status).toBe(200);
    expect(res.body.lead.firstName).toBe("Dana");
    expect(res.body.lead).not.toHaveProperty("taxId");
    expect(res.body.lead).not.toHaveProperty("taxIdType");
    expect(H.logger.warn).toHaveBeenCalledWith(
      "[secretColumnGuard] removed secret columns from a response",
      expect.objectContaining({ route: "GET /x/:id", keys: ["leads.taxId", "leads.taxIdType"], count: 2 }),
    );
    const metrics = await registry.metrics();
    expect(metrics).toMatch(/acreos_response_secret_column_stripped_total\{table="leads",key="taxId"\} 1/);
  });

  it("covers res.send(object), which Express routes through res.json", async () => {
    const res = await request(app()).get("/send");
    expect(res.body[0]).not.toHaveProperty("taxId");
    expect(res.body[0].firstName).toBe("Dana");
  });

  it("says nothing about a clean response", async () => {
    const res = await request(app()).get("/clean");
    expect(res.body).toEqual({ ok: true });
    expect(H.logger.warn).not.toHaveBeenCalled();
  });
});

describe("server/index.ts installs the guard app-wide, before any route", () => {
  const src = stripComments(
    fs.readFileSync(path.resolve(__dirname, "../../server/index.ts"), "utf8"),
  );

  it("mounts it unconditionally on the app (no path prefix), ahead of registerRoutes", () => {
    const mount = src.search(/\bapp\.use\(\s*secretColumnGuard\s*\)/);
    const routes = src.search(/\bregisterRoutes\(\s*httpServer\s*,\s*app\s*\)/);
    expect(mount, "app.use(secretColumnGuard) not found in live code").toBeGreaterThan(-1);
    expect(routes, "registerRoutes(httpServer, app) not found").toBeGreaterThan(-1);
    expect(mount).toBeLessThan(routes);
    // Nothing that serves a response is registered on the app before it.
    const before = src.slice(0, mount);
    expect(before.match(/\bapp\.(get|post|put|patch|delete|all)\(/g) ?? []).toEqual([]);
    expect(before).not.toMatch(/\bregisterRoutes\(|mountStripeWebhook\(/);
  });
});
