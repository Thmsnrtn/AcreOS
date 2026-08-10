/**
 * X-A slice 2 — the abuse-signal reader and the trust panel it feeds.
 *
 * This suite exists because the failure mode of an "abuse signals" surface is
 * not a crash — it is a confident sentence the code never earned. Five pins:
 *
 *   1. SOURCE TRUTH. Every signal that names a source table names a table that
 *      really exists in shared/schema.ts. A signal invented out of a wish
 *      fails BY NAME (the assertion message carries the signal key and the
 *      table it claimed), and a signal declared unavailable must name NO
 *      source and say why.
 *   2. HONEST ABSENCE. The reader distinguishes three states that a lazier
 *      implementation would collapse into `0`: a measured zero, a signal with
 *      no substrate, and a read that failed. Only the first is ever a number.
 *   3. PROPOSED, NOT ENFORCED. The panel's enforcement sentence is served by
 *      the API and rendered verbatim; the surface may not compose a softer
 *      claim of its own, and every cap it prints is tagged with its real
 *      status from orgTrust.
 *   4. NO AUTOMATIC DEMOTION. A derived walk of the server tree proves NO code
 *      path writes organizations.trust_tier. A tier change is a founder act,
 *      and no route to make one exists yet — so the allowlist is empty, and
 *      the day a founder-initiated route is built it gets added here
 *      deliberately, in the same change.
 *   5. EVIDENCE ≠ VERDICT. evaluateTrustReviewEvidence only fires on
 *      thresholds that exist in code, and files everything else as awaiting a
 *      founder ruling rather than judging it against an invented number.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

// ─── Mocks (coverageLedgerQuery house pattern) ──────────────────────────────

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@shared/schema", () => ({
  decisionsInboxItems: {
    __t: "decisions_inbox_items",
    organizationId: { __c: "organization_id" },
    itemType: { __c: "item_type" },
    status: { __c: "status" },
    createdAt: { __c: "created_at" },
  },
  emailSuppressions: {
    __t: "email_suppressions",
    organizationId: { __c: "organization_id" },
    suppressedAt: { __c: "suppressed_at" },
    source: { __c: "source" },
    bounceCategory: { __c: "bounce_category" },
  },
  notes: {
    __t: "notes",
    organizationId: { __c: "organization_id" },
    accessToken: { __c: "access_token" },
    accessTokenExpiresAt: { __c: "access_token_expires_at" },
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ __and: a }),
  or: (...a: unknown[]) => ({ __or: a }),
  eq: (c: unknown, v: unknown) => ({ __eq: [c, v] }),
  gte: (c: unknown, v: unknown) => ({ __gte: [c, v] }),
  inArray: (c: unknown, v: unknown) => ({ __in: [c, v] }),
  isNull: (c: unknown) => ({ __isNull: c }),
  isNotNull: (c: unknown) => ({ __isNotNull: c }),
  sql: Object.assign((..._a: unknown[]) => ({ __sql: true }), { raw: () => ({ __sql: true }) }),
}));

/**
 * FIFO of expected reads. Each entry declares the table it expects to be
 * queried against, so a reordering of the reader's queries fails loudly here
 * instead of silently mislabelling one signal's counts as another's.
 */
type QueuedRead =
  | { table: string; rows: Array<{ orgId: number | null; count: number }> }
  | { table: string; error: string };

let readQueue: QueuedRead[] = [];
const tablesQueried: string[] = [];

vi.mock("../../server/db", () => {
  const makeChain = () => {
    let table = "unknown";
    const chain: Record<string, unknown> = {
      from: (t: { __t?: string }) => {
        table = t?.__t ?? "unknown";
        return chain;
      },
      where: () => chain,
      groupBy: async () => {
        tablesQueried.push(table);
        const next = readQueue.shift();
        if (!next) throw new Error(`unexpected read against ${table} (queue empty)`);
        if (next.table !== table) {
          throw new Error(`read order drift: expected ${next.table}, got ${table}`);
        }
        if ("error" in next) throw new Error(next.error);
        return next.rows;
      },
    };
    return chain;
  };
  return { db: { select: () => makeChain() } };
});

import {
  ABUSE_SIGNAL_WINDOW_DAYS,
  evaluateTrustReviewEvidence,
  readAbuseSignals,
  type AbuseSignal,
} from "../../server/services/abuseSignals";

/** The reader's query order — the same order the FIFO above must be filled. */
const READ_ORDER = [
  "decisions_inbox_items", // abuse_reports_open
  "decisions_inbox_items", // abuse_reports_window
  "email_suppressions", // spam_complaints_window
  "email_suppressions", // bounce_suppressions_window
  "notes", // active_portal_links
] as const;

/** Queue five successful reads, each returning `rows` for the matching table. */
function queueAll(rowsPerRead: Array<Array<{ orgId: number | null; count: number }>>) {
  readQueue = READ_ORDER.map((table, i) => ({ table, rows: rowsPerRead[i] ?? [] }));
}

beforeEach(() => {
  readQueue = [];
  tablesQueried.length = 0;
});

// ─── 1. Source truth — a signal cannot name a table that does not exist ─────

describe("every signal traces to a real table, or names itself unavailable", () => {
  /** Every pgTable declared in the real schema (NOT the mock above). */
  function realSchemaTables(): Set<string> {
    const names = new Set<string>();
    for (const file of ["shared/schema.ts"]) {
      const src = read(file);
      for (const m of src.matchAll(/pgTable\(\s*["'`]([a-z0-9_]+)["'`]/g)) {
        names.add(m[1]);
      }
    }
    // shared/schema.ts re-exports satellite schema modules; sweep those too so
    // a signal reading one of them is not falsely rejected.
    const dir = path.join(ROOT, "shared/schema");
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir)) {
        if (!entry.endsWith(".ts")) continue;
        const src = fs.readFileSync(path.join(dir, entry), "utf-8");
        for (const m of src.matchAll(/pgTable\(\s*["'`]([a-z0-9_]+)["'`]/g)) {
          names.add(m[1]);
        }
      }
    }
    return names;
  }

  async function allSignals(): Promise<AbuseSignal[]> {
    queueAll([[], [], [], [], []]);
    const reports = await readAbuseSignals([1]);
    return reports.get(1)!.signals;
  }

  it("an UNAVAILABLE signal must not have a table sitting right there — the negative direction", async () => {
    // The positive direction (a claimed source must be real) was already
    // pinned, and it passed while export_velocity claimed no source at all on
    // a false premise. This is the other direction: a signal declared
    // unavailable because "nothing records X" must name the tables it actually
    // inspected, so the claim is checkable rather than asserted. A table whose
    // name obviously matches the signal's subject is a red flag the reviewer
    // must resolve before the note ships.
    const real = realSchemaTables();
    const SUBJECT_HINTS: Record<string, string[]> = {
      complaint_rate_per_send: ["email_events", "email_reputation_snapshot", "outbound_email_log"],
      portal_link_rebind_rate: ["notes"],
    };
    for (const signal of (await allSignals()).filter((s) => s.availability === "unavailable")) {
      const hints = SUBJECT_HINTS[signal.key];
      expect(
        hints,
        `signal "${signal.key}" is declared unavailable but names no inspected tables here — ` +
          `add the tables you checked so the absence claim is verifiable, not asserted.`,
      ).toBeDefined();
      for (const table of hints) {
        // Every table named as inspected must exist (else the note cites a
        // ghost) AND must appear in the note, so the reasoning is on record.
        expect(real.has(table), `${signal.key} cites "${table}", which is not a real pgTable`).toBe(true);
        expect(
          signal.note.includes(table),
          `${signal.key}'s note must name "${table}" — the table it inspected and rejected`,
        ).toBe(true);
      }
    }
  });

  it("every declared source table is a real pgTable — a fabricated source fails by name", async () => {
    const real = realSchemaTables();
    // Sanity: the sweep found the schema, so a miss below is the signal's
    // fault and not a broken regex.
    expect(real.size).toBeGreaterThan(100);

    for (const signal of await allSignals()) {
      if (signal.sourceTable === null) continue;
      expect(
        real.has(signal.sourceTable),
        `signal "${signal.key}" claims source table "${signal.sourceTable}", which is not a pgTable in shared/schema. ` +
          `A signal with no real table behind it must be declared unavailable, not invented.`,
      ).toBe(true);
    }
  });

  it("unavailable signals name NO source and explain the absence", async () => {
    const unavailable = (await allSignals()).filter((s) => s.availability === "unavailable");
    // REWRITTEN (fleet-10 verifier catch, rewrite-not-delete): export_velocity
    // was listed here on the premise that "nothing records an export" — false,
    // export_jobs does, org-scoped and indexed. The false premise rendered
    // verbatim on the founder panel and became a founder-queue ask. It is now
    // an AVAILABLE signal; the two that remain are genuinely unbacked.
    expect(unavailable.map((s) => s.key).sort()).toEqual([
      "complaint_rate_per_send",
      "portal_link_rebind_rate",
    ]);
    for (const signal of unavailable) {
      expect(signal.sourceTable, `${signal.key} must not claim a source`).toBeNull();
      expect(signal.count, `${signal.key} must not report a number`).toBeNull();
      expect(
        signal.note.startsWith("UNAVAILABLE"),
        `${signal.key}'s note must open by declaring the absence`,
      ).toBe(true);
      // The reason has to be a reason, not a shrug.
      expect(signal.note.length).toBeGreaterThan(80);
    }
  });

  it("the abuse_report item type matches the one decisionsInbox actually writes", () => {
    const src = read("server/services/abuseSignals.ts");
    const local = src.match(/const ABUSE_REPORT_ITEM_TYPE = "([a-z_]+)"/)?.[1];
    const canonical = read("server/services/decisionsInbox.ts").match(
      /export const ABUSE_REPORT_ITEM_TYPE = "([a-z_]+)"/,
    )?.[1];
    expect(canonical).toBeTruthy();
    expect(local).toBe(canonical);
  });
});

// ─── 2. Honest absence — null is not zero ───────────────────────────────────

describe("honest absence: a measured zero, an absent source, and a failed read are three things", () => {
  it("a measured zero reads as 0/available; an unavailable signal reads as null", async () => {
    queueAll([[], [], [], [], []]);
    const signals = (await readAbuseSignals([42])).get(42)!.signals;

    const openReports = signals.find((s) => s.key === "abuse_reports_open")!;
    expect(openReports.availability).toBe("available");
    // GROUP BY returned no row for org 42 — a real query against a real table
    // found nothing. THAT is a zero.
    expect(openReports.count).toBe(0);

    const rate = signals.find((s) => s.key === "complaint_rate_per_send")!;
    expect(rate.availability).toBe("unavailable");
    expect(rate.count).toBeNull();
  });

  it("counts land on the right org and the right signal", async () => {
    queueAll([
      [{ orgId: 1, count: 2 }],
      [{ orgId: 1, count: 5 }, { orgId: 2, count: 1 }],
      [{ orgId: 2, count: 7 }],
      [{ orgId: 1, count: 3 }],
      [{ orgId: 1, count: 40 }, { orgId: 2, count: 0 }],
    ]);
    const reports = await readAbuseSignals([1, 2]);
    const pick = (org: number, key: string) =>
      reports.get(org)!.signals.find((s) => s.key === key)!.count;

    expect(pick(1, "abuse_reports_open")).toBe(2);
    expect(pick(2, "abuse_reports_open")).toBe(0); // no row → measured zero
    expect(pick(1, "abuse_reports_window")).toBe(5);
    expect(pick(2, "spam_complaints_window")).toBe(7);
    expect(pick(1, "spam_complaints_window")).toBe(0);
    expect(pick(1, "bounce_suppressions_window")).toBe(3);
    expect(pick(1, "active_portal_links")).toBe(40);
    expect(tablesQueried).toEqual([...READ_ORDER]);
  });

  it("a failed read reports read_failed with NO count — never a zero", async () => {
    readQueue = [
      { table: "decisions_inbox_items", error: "connection refused" },
      { table: "decisions_inbox_items", rows: [{ orgId: 9, count: 4 }] },
      { table: "email_suppressions", error: "connection refused" },
      { table: "email_suppressions", rows: [] },
      { table: "notes", rows: [] },
    ];
    const signals = (await readAbuseSignals([9])).get(9)!.signals;

    const failed = signals.find((s) => s.key === "abuse_reports_open")!;
    expect(failed.availability).toBe("read_failed");
    expect(failed.count).toBeNull();
    expect(failed.note).toMatch(/absent, not zero/i);

    const complaints = signals.find((s) => s.key === "spam_complaints_window")!;
    expect(complaints.availability).toBe("read_failed");
    expect(complaints.count).toBeNull();

    // A neighbouring read that succeeded is unaffected — one broken query does
    // not poison the whole panel.
    expect(signals.find((s) => s.key === "abuse_reports_window")!.count).toBe(4);
  });

  it("no org ids means no queries at all, and an empty report set", async () => {
    const reports = await readAbuseSignals([]);
    expect(reports.size).toBe(0);
    expect(tablesQueried).toEqual([]);
  });

  it("windowed signals carry the window they were actually read with", async () => {
    queueAll([[], [], [], [], []]);
    const signals = (await readAbuseSignals([1], { windowDays: 7 })).get(1)!.signals;
    expect(signals.find((s) => s.key === "spam_complaints_window")!.windowDays).toBe(7);
    // Stock quantities have no window and must not pretend to.
    expect(signals.find((s) => s.key === "active_portal_links")!.windowDays).toBeNull();
    expect(ABUSE_SIGNAL_WINDOW_DAYS).toBe(30);
  });

  it("the reader is a READER — it holds no write, no tier, no policy", () => {
    const src = read("server/services/abuseSignals.ts");
    // Code-only view: the header comment legitimately discusses these words.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/db\s*\.\s*(insert|update|delete)\s*\(/);
    expect(code).not.toMatch(/trustTier|trust_tier/);
    // No orgTrust import: the caps table is policy, and evidence must not be
    // able to reach for it (evaluateTrustReviewEvidence takes values in).
    expect(code).not.toMatch(/from\s+["'][^"']*orgTrust["']/);
  });
});

// ─── 3. Evidence, never a verdict ───────────────────────────────────────────

describe("evaluateTrustReviewEvidence recommends a look, and only against real thresholds", () => {
  const signal = (over: Partial<AbuseSignal>): AbuseSignal => ({
    key: "active_portal_links",
    label: "Live borrower portal links held",
    sourceTable: "notes",
    availability: "available",
    count: 0,
    windowDays: null,
    note: "",
    ...over,
  });

  it("fires only when a MEASURED count exceeds a cap that exists in code", () => {
    const under = evaluateTrustReviewEvidence(
      [signal({ count: 25, capKey: "portalLinksActiveMax" })],
      { portalLinksActiveMax: 25 },
    );
    expect(under.reviewRecommended).toBe(false);

    const over = evaluateTrustReviewEvidence(
      [signal({ count: 26, capKey: "portalLinksActiveMax" })],
      { portalLinksActiveMax: 25 },
    );
    expect(over.reviewRecommended).toBe(true);
    expect(over.exceeded[0]).toContain("PROPOSED");
    expect(over.exceeded[0]).toContain("portalLinksActiveMax");
    expect(over.exceeded[0]).toContain("26");
  });

  it("a signal with no threshold in code is filed as awaiting a ruling, never judged", () => {
    const result = evaluateTrustReviewEvidence(
      [signal({ key: "spam_complaints_window", label: "Spam complaints", count: 12, capKey: undefined })],
      { portalLinksActiveMax: 25 },
    );
    // 12 complaints is NOT silently declared bad — the proposal leaves this
    // threshold to the founder, so the evidence says exactly that.
    expect(result.reviewRecommended).toBe(false);
    expect(result.awaitingThreshold).toHaveLength(1);
    expect(result.awaitingThreshold[0]).toContain("no threshold");
  });

  it("unmeasured signals are carried as unmeasured, never counted as clean", () => {
    const result = evaluateTrustReviewEvidence(
      [
        signal({ key: "export_velocity", label: "Export jobs and rows", availability: "unavailable", count: null }),
        signal({ key: "abuse_reports_open", label: "Open abuse reports", availability: "read_failed", count: null }),
      ],
      { portalLinksActiveMax: 25 },
    );
    expect(result.notMeasured).toHaveLength(2);
    expect(result.notMeasured[0]).toContain("no source at HEAD");
    expect(result.notMeasured[1]).toContain("read failed");
    expect(result.awaitingThreshold).toEqual([]);
    expect(result.reviewRecommended).toBe(false);
  });
});

// ─── 4. The panel says PROPOSED, and cannot say otherwise ───────────────────

describe("the trust panel is labelled proposed-not-enforced at the source", () => {
  const ROUTE = "server/routes-founder-customers.ts";
  const PANEL = "client/src/pages/founder/admin/trust-signals.tsx";

  it("the API serves the enforcement sentence and it says NOT ENFORCED", () => {
    const src = read(ROUTE);
    expect(src).toContain("TRUST_PANEL_ENFORCEMENT_STATUS");
    expect(src).toContain("PROPOSED — NOT ENFORCED");
    expect(src).toContain("A tier change is a founder act.");
    expect(src).toContain("enforcementStatus: TRUST_PANEL_ENFORCEMENT_STATUS");
    // Read-only endpoint: GET, founder-gated, no mutation verb on this path.
    expect(src).toContain('app.get(\n    "/api/founder/trust-signals"');
    expect(src).not.toMatch(/app\.(post|put|patch|delete)\(\s*\n?\s*"\/api\/founder\/trust-signals/);
  });

  it("the panel renders the served sentence verbatim rather than composing its own", () => {
    const src = read(PANEL);
    expect(src).toContain("{data?.enforcementStatus}");
    // No surface-authored claim that anything is live.
    expect(src).not.toMatch(/\bis enforced\b/i);
    expect(src).not.toMatch(/\bnow enforcing\b/i);
    // Caps are labelled by the SERVER's per-cap status, not by the surface's
    // guess — "read by live code" appears only under status === "consumed".
    expect(src).toContain('cap.status === "consumed" ? "read by live code" : "proposed only"');
  });

  it("cap status comes from orgTrust, which knows exactly one cap is consumed", () => {
    const src = read("server/services/orgTrust.ts");
    expect(src).toContain("export function resolveOrgTrustCapStatus()");
    const statusBlock = src.match(
      /const ORG_TRUST_CAP_STATUS[\s\S]*?\n\};/,
    )?.[0];
    expect(statusBlock).toBeTruthy();
    const consumed = (statusBlock!.match(/"consumed"/g) ?? []).length;
    // portalLinkTtlDays is the ONLY cap a live code path reads today (the
    // portal-link rebind TTL). If a second one becomes real, that is the
    // founder ruling landing — update this count in the same change.
    expect(consumed).toBe(1);
    expect(statusBlock).toMatch(/portalLinkTtlDays: "consumed"/);
  });

  it("the panel renders absence as words, never as a zero", () => {
    const src = read(PANEL);
    expect(src).toContain("not measured");
    expect(src).toContain("read failed");
    // The value renderer prints a number ONLY on availability "available" with
    // a non-null count; anything else falls through to the words above.
    expect(src).toMatch(
      /if \(signal\.availability === "available" && signal\.count !== null\)/,
    );
    // The "nothing crossed a threshold" fallback must not overclaim. An org can
    // have a real non-zero count that simply sits under its cap, so this line
    // may never read as "everything is zero" or as a clearance.
    // Whitespace-normalized: JSX wrapping may reflow, the claim may not.
    const flat = src.replace(/\s+/g, " ");
    expect(flat).toContain("it is not a statement that every count is zero");
    expect(flat).toContain("it is not a clearance");
  });

  it("the panel is a TAB of an existing hub — it claims no /founder route", () => {
    const hub = read("client/src/pages/founder/admin/telemetry.tsx");
    expect(hub).toContain("TrustSignalsContent");
    expect(hub).toContain('{ value: "trust", label: "Trust & abuse" }');
    const panel = read(PANEL);
    // A routed page would default-export a page component; a tab exports
    // shell-less content and registers nothing.
    expect(panel).not.toMatch(/export default/);
    expect(panel).not.toContain("PageShell");
    expect(read("client/src/App.tsx")).not.toContain("trust-signals");
  });

  it("labels name what the value IS — organizations, not customers", () => {
    const src = read(PANEL);
    expect(src).toContain("Organization");
    // The one place "customer" may appear is the sentence explaining that this
    // is NOT a customer count.
    for (const line of src.split("\n")) {
      if (!/customer/i.test(line)) continue;
      expect(
        /not a customer count/i.test(line),
        `panel line calls orgs customers: ${line.trim()}`,
      ).toBe(true);
    }
  });
});

// ─── 5. Derived: nothing writes organizations.trust_tier ────────────────────

describe("a trust-tier change is a founder act — no code path writes one", () => {
  /**
   * Files that may legitimately write organizations.trust_tier. EMPTY at HEAD:
   * no founder-initiated tier route has been built. When one is (it is a
   * founder decision, queued in docs/proposals/x-a-send-chokepoint-caps.md),
   * add it here IN THE SAME CHANGE with the ruling cited — that is the whole
   * point of the allowlist being explicit rather than absent.
   */
  const FOUNDER_TIER_WRITE_ALLOWLIST: string[] = [];

  function tierWriters(): string[] {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".claude") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        const raw = fs.readFileSync(full, "utf-8");
        // Comments discuss tiers constantly; only CODE can write one.
        const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        const rel = path.relative(ROOT, full);
        const writes =
          // drizzle: update(organizations) … trustTier / insert(organizations) … trustTier
          /\.(update|insert)\(\s*organizations\s*\)[\s\S]{0,600}?trustTier/.test(src) ||
          // storage layer: updateOrganization(id, { trustTier … })
          /updateOrganization\([\s\S]{0,300}?trustTier/.test(src) ||
          // raw SQL assignment anywhere in server/shared code
          /trust_tier"?\s*=\s*(?!=)/.test(src);
        if (writes) hits.push(rel);
      }
    };
    walk(path.join(ROOT, "server"));
    walk(path.join(ROOT, "shared"));
    return hits.sort();
  }

  it("no server or shared code path writes organizations.trust_tier", () => {
    expect(
      tierWriters(),
      "a code path now writes organizations.trust_tier. Automatic demotion/promotion is a " +
        "founder-approval item (docs/proposals/x-a-send-chokepoint-caps.md item 5) — if this is a " +
        "founder-initiated route, add it to FOUNDER_TIER_WRITE_ALLOWLIST citing the ruling.",
    ).toEqual(FOUNDER_TIER_WRITE_ALLOWLIST);
  });

  it("the detector actually detects — a synthetic writer would be caught", () => {
    // Guards the regexes above from rotting into a permanent green.
    const synthetic = `
      await db.update(organizations).set({ trustTier: "new" }).where(eq(organizations.id, 1));
    `;
    expect(/\.(update|insert)\(\s*organizations\s*\)[\s\S]{0,600}?trustTier/.test(synthetic)).toBe(true);
    expect(/trust_tier"?\s*=\s*(?!=)/.test(`sql\`update organizations set trust_tier = 'trusted'\``)).toBe(true);
    expect(/updateOrganization\([\s\S]{0,300}?trustTier/.test("storage.updateOrganization(id, { trustTier: 'trusted' })")).toBe(true);
  });

  it("the panel and its endpoint offer no way to change a tier", () => {
    const route = read("server/routes-founder-customers.ts");
    const panel = read("client/src/pages/founder/admin/trust-signals.tsx");
    expect(route).not.toMatch(/set\(\s*\{[^}]*trustTier/);
    expect(panel).not.toMatch(/useMutation/);
    expect(panel).not.toMatch(/method:\s*["'](POST|PATCH|PUT|DELETE)["']/);
  });
});
