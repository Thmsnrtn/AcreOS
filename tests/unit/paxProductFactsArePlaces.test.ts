/**
 * Pax's product facts name real places and real rules.
 *
 *  - ADOPTION: every route that ENFORCES a limit Pax quotes reads the shared
 *    constant (no `= 500` / `max: 5` literal left at a charge or cap site), and
 *    the BYO-key route asks the same tier rule Pax quotes. Without this the
 *    constant would be canonical in name only.
 *  - PLACES: every path Pax cites is a real client route, and every customer
 *    door Pax names is a label in the sidebar's NAV_MODULES.
 *
 * Mutations recorded (reverted after each red run):
 *   - routes-leads `MAX_CSV_IMPORT_ROWS = 500` restored: red.
 *   - PLACES.byok.path → "/settings/keys": red ("every cited path is a route").
 *   - paxPlaces: SETTINGS_TAB_LABELS.notifications → "communications" (the
 *     legacy hash that caused the wrong return-address path): red ("tabs are
 *     the real tabs" and "no legacy alias").
 *   - sendPricing.ts: hand-typing "Settings → Mail" back into the quote note:
 *     red ("no Pax-facing file types a Settings path by hand").
 *   - paxPlaces: SETTINGS_SECTIONS.returnAddress.section → "Mail": red
 *     ("every section marker is on the page it names").
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";
import { PLACES, getPaxProductFacts } from "../../server/services/paxProductFacts";
import {
  OTHER_PLACES,
  PLACE_TEXT,
  SETTINGS_TAB_LABELS,
  placeDirectory,
  type PlaceEvidence,
} from "../../server/services/paxPlaces";
const DIR = placeDirectory();
const FINANCE_TAB_LABELS = DIR.financeTabs;
const SETTINGS_SECTIONS = DIR.sections;
const FINANCE_PLACES = DIR.finance;
import { quoteOutboundSend } from "../../server/services/sendPricing";
import { CSV_IMPORT_MAX_ROWS_PER_FILE, BULK_EXPORT_DAILY_CAP } from "@shared/product-limits";

const ROOT = path.resolve(__dirname, "../..");
const code = (rel: string) => stripCommentsPreservingLines(fs.readFileSync(path.join(ROOT, rel), "utf8")) as string;

describe("the routes that enforce a limit read the shared constant", () => {
  it.each(["server/routes-leads.ts", "server/routes-properties.ts", "server/routes-import-export.ts"])(
    "%s: the CSV row cap is CSV_IMPORT_MAX_ROWS_PER_FILE",
    (rel) => {
      const src = code(rel);
      expect(src).toMatch(/const MAX_CSV_IMPORT_ROWS = CSV_IMPORT_MAX_ROWS_PER_FILE;/);
      expect(src).not.toMatch(/MAX_CSV_IMPORT_ROWS\s*=\s*\d/);
      expect(src, "the constant is declared but no check reads it").toMatch(/\.length > MAX_CSV_IMPORT_ROWS/);
    },
  );

  it.each(["server/middleware/identityRateLimiters.ts", "server/routes-import-export.ts"])(
    "%s: the bulk-export limiter's max is BULK_EXPORT_DAILY_CAP",
    (rel) => {
      const src = code(rel);
      expect(src).toMatch(/max: BULK_EXPORT_DAILY_CAP,/);
      expect(src).not.toMatch(/windowMs: 24 \* 60 \* 60 \* 1000,\s*max: \d/);
    },
  );

  it("the job-backed import cap is the shared constant", () => {
    expect(code("server/services/migrationJobs.ts")).toMatch(/export const MAX_IMPORT_ROWS = DATA_IMPORT_JOB_MAX_ROWS;/);
  });

  it("the BYO-key route asks the shared tier rule", () => {
    expect(code("server/routes-byok.ts")).toMatch(/if \(byokTierAllows\(tier, channel\)\) return true;/);
  });

  it("the real facts carry the real values", async () => {
    const f: any = await getPaxProductFacts("all");
    expect(f.imports.rowsPerFile).toBe(CSV_IMPORT_MAX_ROWS_PER_FILE);
    expect(f.exports.perPersonPerDay).toBe(BULK_EXPORT_DAILY_CAP);
    expect(f.sending.textsPlanRequirement).toEqual(["pro", "scale"]);
  });
});

describe("every place Pax names exists", () => {
  const app = code("client/src/App.tsx");
  const routes = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
  const sidebar = code("client/src/components/layout-sidebar.tsx");

  it("vacuity: the client route table parsed", () => {
    expect(routes.size).toBeGreaterThan(100);
  });

  it("every cited path is a route", async () => {
    const nav: any = ((await getPaxProductFacts("navigation")) as any).navigation;
    const CUSTOMER_DOORS: Array<{ door: string; path: string }> = nav.doors;
    const TOP_BAR: Array<{ path: string }> = nav.topBar;
    const paths = [
      ...Object.values(PLACES).map((p) => p.path),
      ...CUSTOMER_DOORS.map((d) => d.path),
      ...TOP_BAR.map((t) => t.path),
    ];
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) expect(routes.has(p), `${p} is not a client route`).toBe(true);
  });

  it("the five doors are exactly the sidebar's door labels", async () => {
    const CUSTOMER_DOORS: Array<{ door: string }> = ((await getPaxProductFacts("navigation")) as any).navigation.doors;
    expect(CUSTOMER_DOORS.map((d) => d.door)).toEqual(["Today", "Map", "Deals", "Finance", "Pax"]);
    for (const d of CUSTOMER_DOORS) {
      expect(sidebar, `door "${d.door}" is not a NAV_MODULES label`).toMatch(new RegExp(`label: "${d.door}"`));
    }
  });
});

// ── ONE source for every place string ────────────────────────────────────────
describe("every Settings / Finance place Pax cites is derived from the real client tabs", () => {
  const settings = code("client/src/pages/settings.tsx");
  const money = code("client/src/pages/money.tsx");
  const PAX_FACING = (() => {
    const out = ["server/services/sendPricing.ts"];
    for (const dir of ["server/ai", "server/services"]) {
      for (const f of fs.readdirSync(path.join(ROOT, dir))) {
        const isAi = dir === "server/ai" && f.endsWith(".ts") && !f.endsWith(".test.ts");
        const isPax = dir === "server/services" && /^pax.*\.ts$/.test(f);
        if (isAi || isPax) out.push(`${dir}/${f}`);
      }
    }
    return [...new Set(out)];
  })();

  /** value -> visible label for each <TabsTrigger value="..."> in a page. */
  function triggers(src: string, finance = false): Map<string, string> {
    const out = new Map<string, string>();
    for (const m of src.matchAll(/<TabsTrigger value="([^"]+)"[\s\S]*?<\/TabsTrigger>/g)) {
      let text = m[0].replace(/<TabsTrigger[^>]*>/, "").replace(/<\/TabsTrigger>/, "");
      text = text.replace(/<[A-Z]\w*\s[^>]*\/>/g, "").replace(/<\/?span>/g, "");
      text = text.replace("{PAX_SETTINGS_COPY.bucketLabel}", SETTINGS_TAB_LABELS.integrations);
      out.set(m[1], text.replace(/&amp;/g, "&").trim());
    }
    return finance ? out : out;
  }

  it("vacuity: both pages' tab triggers parsed", () => {
    expect(triggers(settings).size).toBe(7);
    expect(triggers(money, true).size).toBe(4);
  });

  it("tabs are the real tabs: the keys equal settings.tsx VALID_TABS and the labels equal what the tab prints", () => {
    const valid = [...(settings.match(/const VALID_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(valid.length).toBe(7);
    expect(Object.keys(SETTINGS_TAB_LABELS).sort()).toEqual([...valid].sort());
    const real = triggers(settings);
    for (const [tab, label] of Object.entries(SETTINGS_TAB_LABELS)) expect(real.get(tab), `tab ${tab}`).toBe(label);
  });

  it("no legacy alias is cited as a tab (communications, team, payments ... are URL hashes, not tabs)", () => {
    const legacy = [...(settings.match(/const LEGACY_TO_CANONICAL[\s\S]*?\n\};/)?.[0] ?? "").matchAll(/^\s+"?([a-z-]+)"?:/gm)].map((m) => m[1]);
    expect(legacy).toContain("communications");
    for (const k of legacy) {
      expect(Object.keys(SETTINGS_TAB_LABELS), `${k} is a legacy alias`).not.toContain(k);
      expect(Object.values(SETTINGS_TAB_LABELS).map((l) => l.toLowerCase()), `${k} as a label`).not.toContain(k);
    }
  });

  it("the Finance door's tabs are the real ones", () => {
    const real = triggers(money, true);
    for (const [tab, label] of Object.entries(FINANCE_TAB_LABELS)) expect(real.get(tab), `finance tab ${tab}`).toBe(label);
    expect([...real.keys()].sort()).toEqual(Object.keys(FINANCE_TAB_LABELS).sort());
  });

  function tabRegion(tab: string): string {
    const parts = settings.split(/(?=<TabsContent value=")/).filter((p) => p.startsWith(`<TabsContent value="${tab}"`));
    return parts.join("\n");
  }

  const evidence: Array<[string, PlaceEvidence]> = [
    ...Object.entries(SETTINGS_SECTIONS).flatMap(([k, v]) => v.evidence.map((e) => [k, e as PlaceEvidence] as [string, PlaceEvidence])),
    ...Object.entries(FINANCE_PLACES).flatMap(([k, v]) => v.evidence.map((e) => [k, e as PlaceEvidence] as [string, PlaceEvidence])),
    ...Object.entries(OTHER_PLACES).flatMap(([k, v]) => v.evidence.map((e) => [k, e as PlaceEvidence] as [string, PlaceEvidence])),
  ];

  it("vacuity: sections and evidence were enumerated", () => {
    expect(Object.keys(SETTINGS_SECTIONS).length).toBeGreaterThanOrEqual(8);
    expect(evidence.length).toBeGreaterThan(20);
  });

  it.each(evidence)("every section marker is on the page it names: %s", (_k, e) => {
    const src = code(e.file);
    const hay = e.withinSettingsTab ? tabRegion(e.withinSettingsTab) : src;
    expect(hay.length, `${e.file}${e.withinSettingsTab ? ` tab ${e.withinSettingsTab}` : ""} not found`).toBeGreaterThan(200);
    expect(hay, `"${e.marker}" is not in ${e.file}${e.withinSettingsTab ? ` under the ${e.withinSettingsTab} tab` : ""}`).toContain(e.marker);
  });

  it("each section's visible name is the marker text the page prints", () => {
    expect(tabRegion("notifications")).toContain(SETTINGS_SECTIONS.returnAddress.section);
    expect(PLACE_TEXT.returnAddress).toBe("Settings \u2192 Notifications \u2192 Mail Settings");
  });

  it("no Pax-facing file types a Settings path by hand", () => {
    expect(PAX_FACING.length).toBeGreaterThan(12);
    const hand = /Settings\s*(?:\u2192|->|&gt;|>|\/)\s*[A-Z]/;
    const offenders = PAX_FACING.filter((f) => hand.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("two strings never disagree: every place Pax emits for the return address is the one place", async () => {
    const facts = JSON.stringify(await getPaxProductFacts("all"));
    const quote = quoteOutboundSend({
      channel: "postcard",
      recipients: 5,
      rails: { ownMailAccount: false, ownEmailAccount: false, emailCanSend: true, smsConnected: false },
    }).notes.join(" ");
    expect(facts).toContain(PLACE_TEXT.returnAddress);
    expect(quote).toContain(PLACE_TEXT.returnAddress);
    // And every "Settings → <X>" either string names is a real tab.
    const labels = Object.values(SETTINGS_TAB_LABELS);
    for (const text of [facts, quote]) {
      for (const m of text.matchAll(/Settings \u2192 ([^\u2192"(),.]+?)(?= \u2192|"|\)|,|\.|$| \()/g)) {
        expect(labels, `"${m[1]}" is not a Settings tab`).toContain(m[1].trim());
      }
    }
  });
});

// ── The claims the how-to facts make about behaviour, pinned to the code ─────
describe("the payments / sequences / cancellation facts match what the code does", () => {
  function allServerFiles(dir = "server"): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(...allServerFiles(rel));
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(rel);
    }
    return out;
  }
  const files = allServerFiles();

  it("vacuity: the server tree was enumerated", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("recording a payment is owner/admin only and needs an idempotency key (what the payments fact says)", () => {
    const src = code("server/routes-finance.ts");
    expect(src).toMatch(/api\.post\("\/api\/payments", isAuthenticated, getOrCreateOrg, requireRole\(\["owner", "admin"\]\)/);
    expect(src).toMatch(/headers\?\.\["idempotency-key"\]/);
    const ui = code("client/src/pages/finance.tsx");
    expect(ui).toMatch(/permissions\?\.role === "owner" \|\| permissions\?\.role === "admin"/);
  });

  it("nothing reads a sequence's enrollment trigger, and only the enroll route creates enrollments (what the sequences fact says)", () => {
    const readers = files.filter((f) => /enrollmentTrigger|enrollment_trigger/.test(code(f)));
    expect(readers, "a server file now reads the enrollment trigger: update the sequences fact").toEqual([]);
    const creators = files.filter((f) => /\bcreateSequenceEnrollment\b/.test(code(f))).sort();
    // The route is the only CALLER; storage.ts / sequencesRepo.ts only define it.
    expect(creators, "a new caller enrols leads: update the sequences fact").toEqual([
      "server/routes-campaigns.ts",
      "server/storage.ts",
      "server/storage/sequencesRepo.ts",
    ]);
  });

  it("the sequence processor runs each step through canSendViaChannel (the consent the fact computes)", () => {
    expect(code("server/services/sequenceProcessor.ts")).toMatch(/canSendViaChannel\(lead, step\.channel as/);
  });

  it("cancelling moves the org to the Free plan and stamps the wind-down; it deletes no customer rows (what the cancellation fact says)", () => {
    const src = code("server/webhookHandlers.ts");
    const i = src.indexOf("subscriptionTier: 'free'");
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i, i + 1500);
    expect(block).toContain("subscriptionStatus: 'cancelled'");
    expect(block).toContain("subscriptionEndedPatch()");
    expect(block).not.toMatch(/\.delete\(/);
    expect(src).toContain("Your data is preserved");
  });
});
