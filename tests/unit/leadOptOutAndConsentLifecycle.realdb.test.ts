/**
 * Opt-out and consent across a lead's life, against a real Postgres.
 *
 *   - STOP then START over SMS: re-consent clears BOTH opt-out flags. It
 *     cleared doNotContact and left optOutDate, so every opt-out check still
 *     read the lead as opted out — re-consent stranded it.
 *   - mergeLeads: a duplicate's opt-out survives the merge (doNotContact if
 *     either had it; the EARLIEST opt-out date). The merge only filled the
 *     primary's gaps, so the duplicate's STOP was deleted with it.
 *   - PATCH /api/leads/:id/consent's repository call: vocabulary-checked
 *     source, first grant wins, scoped to the organization.
 *   - A caller cannot claim a source only the SMS keyword handler records.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("leadOptOutAndConsentLifecycle.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `loc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = { org: 0, other: 0 };

describe.runIf(realDbAvailable)("lead opt-out and consent lifecycle (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    ids.org = (await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as any).returning())[0].id;
    ids.other = (await db.insert(organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-o2` } as any).returning())[0].id;
  });
  afterAll(async () => {
    const { db } = await import("../../server/db");
    const { eq } = await import("drizzle-orm");
    const { leads, activityLog, organizations: orgs } = await import("@shared/schema");
    const { leadConsentEvents } = await import("@shared/schema/comms-email");
    for (const org of [ids.org, ids.other].filter(Boolean) as number[]) {
      // Typed deletes, so the cleanup's tables and columns are checked by tsc.
      await db.delete(leadConsentEvents).where(eq(leadConsentEvents.organizationId, org)).catch(() => undefined);
      await db.delete(activityLog).where(eq(activityLog.organizationId, org)).catch(() => undefined);
      await db.delete(leads).where(eq(leads.organizationId, org)).catch(() => undefined);
      await db.delete(orgs).where(eq(orgs.id, org));
    }
  });

  const make = async (extra: Record<string, unknown> = {}, org = ids.org) => {
    const { db } = await import("../../server/db");
    const { leads } = await import("@shared/schema");
    return (await db.insert(leads).values({ organizationId: org, firstName: "L", lastName: tag, ...extra } as any).returning())[0];
  };
  const reload = async (id: number) => {
    const { db } = await import("../../server/db");
    const { leads } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    return (await db.select().from(leads).where(eq(leads.id, id)))[0];
  };

  it("STOP then START leaves the lead contactable again", async () => {
    const { processOptKeyword } = await import("../../server/services/tcpaCompliance");
    const { leadHasOptedOut } = await import("../../server/services/leadContactability");
    const phone = `+1512${String(Date.now()).slice(-7)}`;
    const lead = await make({ phone, tcpaConsent: true });
    await processOptKeyword(ids.org, phone, "STOP", `SM-${tag}-1`);
    expect(leadHasOptedOut(await reload(lead.id))).toBe(true);
    await processOptKeyword(ids.org, phone, "START", `SM-${tag}-2`);
    const after = await reload(lead.id);
    expect(after.doNotContact).toBe(false);
    expect(after.optOutDate).toBeNull();
    expect(leadHasOptedOut(after)).toBe(false);
  });

  it("a merge keeps either lead's opt-out, with the earliest date", async () => {
    const { storage } = await import("../../server/storage");
    const early = new Date("2026-03-01T00:00:00Z");
    const primary = await make({ email: `${tag}-p@example.com`, optOutDate: new Date("2026-06-01T00:00:00Z"), optOutReason: "later" });
    const duplicate = await make({ email: `${tag}-p@example.com`, doNotContact: true, optOutDate: early, optOutReason: "STOP" });
    const merged = await storage.mergeLeads(ids.org, primary.id, duplicate.id);
    expect(merged.doNotContact).toBe(true);
    expect(new Date(merged.optOutDate!).toISOString()).toBe(early.toISOString());
    expect(merged.optOutReason).toBe("STOP");
  });

  it("the consent PATCH's repository call: vocabulary, first grant wins, org-scoped", async () => {
    const { storage } = await import("../../server/storage");
    const lead = await make();
    const granted = await storage.updateLeadConsent(lead.id, { tcpaConsent: true, consentSource: "manual" }, ids.org);
    expect(granted.consentSource).toBe("admin_manual"); // free text → the default
    const firstAt = new Date(granted.consentDate!).getTime();

    await new Promise((r) => setTimeout(r, 15));
    const again = await storage.updateLeadConsent(lead.id, { tcpaConsent: true, consentSource: "written" }, ids.org);
    expect(new Date(again.consentDate!).getTime()).toBe(firstAt);
    expect(again.consentSource).toBe("admin_manual");

    // Another organization's id cannot touch it.
    const foreign = await storage.updateLeadConsent(lead.id, { tcpaConsent: false, optOutReason: "x" }, ids.other);
    expect(foreign).toBeUndefined();
    expect((await reload(lead.id)).tcpaConsent).toBe(true);
  });

  it("a caller cannot claim a source only the SMS keyword handler records", async () => {
    const { storage } = await import("../../server/storage");
    for (const claimed of ["sms_double_optin", "inbound_stop"]) {
      const lead = await storage.createLead({ organizationId: ids.org, firstName: "C", lastName: tag, tcpaConsent: true, consentSource: claimed } as any);
      expect(lead.consentSource, claimed).toBe("admin_manual");
    }
    const ok = await storage.createLead({ organizationId: ids.org, firstName: "C", lastName: tag, tcpaConsent: true, consentSource: "written" } as any);
    expect(ok.consentSource).toBe("written");
  });

  it("the public API's lead writes go through the same consent stamp", async () => {
    const { leadsV1Router } = (await import("../../server/api-v1/leads")) as any;
    const handle = (method: string, path: string) => {
      const layer = leadsV1Router.stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
      return layer.route.stack[layer.route.stack.length - 1].handle;
    };
    const res = () => {
      const r: any = { statusCode: 200, headers: {} as Record<string, unknown> };
      r.status = (c: number) => ((r.statusCode = c), r);
      r.getHeader = (k: string) => r.headers[k.toLowerCase()];
      r.setHeader = (k: string, v: unknown) => ((r.headers[k.toLowerCase()] = v), r);
      r.set = r.setHeader;
      r.json = (b: unknown) => ((r.body = b), r);
      return r;
    };
    const { db } = await import("../../server/db");
    const { leads } = await import("@shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const find = async (last: string) =>
      (await db.select().from(leads).where(and(eq(leads.organizationId, ids.org), eq(leads.lastName, last))))[0];

    const created = res();
    await handle("post", "/")({ apiKeyOrganization: { id: ids.org }, body: { first_name: "A", last_name: `${tag}-api1`, tcpa_consent: true }, headers: {} }, created);
    expect(created.statusCode, JSON.stringify(created.body)).toBeLessThan(300);
    const a = await find(`${tag}-api1`);
    expect(a.consentDate, "a consent granted through the API carries no consent date").not.toBeNull();
    expect(a.consentSource).toBe("admin_manual");

    const b0 = await make({ lastName: `${tag}-api2` });
    const patched = res();
    await handle("patch", "/:id")({ apiKeyOrganization: { id: ids.org }, params: { id: String(b0.id) }, body: { tcpa_consent: true }, headers: {} }, patched);
    expect(patched.statusCode, JSON.stringify(patched.body)).toBeLessThan(300);
    const b = await reload(b0.id);
    expect(b.consentDate).not.toBeNull();
    expect(b.consentSource).toBe("admin_manual");
  });
});

describe("one default source for the lead row and its consent event", () => {
  it("POST /api/leads records the event with the source the row was stamped with", async () => {
    const { readFileSync } = await import("node:fs");
    const { stripComments } = await import("../helpers/stripComments");
    const src = stripComments(readFileSync("server/routes-leads.ts", "utf8"));
    const call = src.slice(src.indexOf("await recordConsentGranted({"), src.indexOf("metadata: { route: \"POST /api/leads\" }"));
    expect(call.length).toBeGreaterThan(100);
    expect(call).toMatch(/source: \(lead\.consentSource \?\? DEFAULT_GRANT_SOURCE\)/);
    expect(call).not.toMatch(/"website"/);
  });
});
