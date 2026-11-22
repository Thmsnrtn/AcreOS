// @vitest-environment jsdom
/**
 * EL-P1 Wave 0 Batch 2 — client honesty (A1-01, A5-01, A2-03, A2-11,
 * A5-02, A2-12, A5-05, A16-03).
 *
 * These tests FAIL on the pre-fix tree and PASS after the cure:
 *
 *  A1-01 — onboarding-v2.tsx promised "50 realistic leads" while
 *    server/services/onboarding/sampleSeeder.ts seeds 2–5 per business
 *    type. Cure: the copy states the seeder's real range (derived from
 *    the seeder source below, so the pin tracks the seeder if it ever
 *    changes) and the success toast reports the seed response's own
 *    count with no fabricated fallback.
 *
 *  A5-01 — pipeline.tsx computed its funnel/KPIs over the server's
 *    default 25-record first page and presented them as portfolio
 *    totals. Cure: fetchAllPages pages through at the 100 cap until a
 *    short page — exercised behaviourally against a stubbed fetch.
 *
 *  A2-03 — the default toast variant was "liquid-glass"
 *    (semi-transparent). Cure: a solid token surface like the semantic
 *    variants.
 *
 *  A2-11 — use-sound's play() was a stub; the Settings toggle only
 *    flipped a localStorage key and no sound ever played. Cure: the
 *    hook, the toggle, and the deal-closed modal's listener-less
 *    "acreos:sound" dispatch are all removed.
 *
 *  A5-02 — the command palette's lead-status menu offered 'contacting'
 *    and 'negotiation', neither in LEAD_STATUSES, and the route 400s
 *    them. Cure: the menu is derived from the canonical LEAD_STATUSES.
 *
 *  A2-12 — the branding editor's Density select claimed "Applied
 *    across the app for every member" but wrote a value nothing
 *    applied (deliberate a11y decision: data-density is personal
 *    reading density). Cure: picker, payload field, and false copy
 *    removed; the tenant-theme context no longer exposes brandDensity.
 *
 *  A5-05 — TcpaConsentToggle's one-click "Grant Consent" fired a PATCH
 *    with consentSource "admin_manual", no attestation, and the lead
 *    then wore the same green TCPA badge as a genuine opt-in. Cure: an
 *    attestation step (named channel + attestation checkbox) must
 *    complete before the PATCH can fire, and the badge renders
 *    admin-attested sources distinctly ("TCPA · Attested", amber).
 *
 *  A16-03 — data-export.tsx had three buttons that always refused:
 *    Campaigns + Activity log hit GET /api/export/:entityType (400 —
 *    only leads/properties/deals/notes are accepted) and the archive
 *    card GET /api/export/archive?format=zip (not a route). Cure: the
 *    two cards are gone and the archive card runs the real async
 *    POST /api/export/everything job flow (create → poll → download).
 *
 * Source pins follow the repo's established pattern for static/UI
 * surfaces (cf. offlineTrioHonesty.test.ts, brandingEditor.test.ts);
 * A5-01's paging and A5-02's vocabulary are additionally exercised
 * against the real imported code/data.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { LEAD_STATUSES } from "../../shared/lifecycle/pipeline-status";
import { fetchAllPages } from "../../client/src/pages/pipeline";

const repoRoot = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

const onboarding = read("client/src/pages/onboarding-v2.tsx");
const seeder = read("server/services/onboarding/sampleSeeder.ts");
const pipeline = read("client/src/pages/pipeline.tsx");
const toast = read("client/src/components/ui/toast.tsx");
const preferencesCard = read("client/src/components/preferences-card.tsx");
const dealClosedModal = read("client/src/components/modals/deal-closed-modal.tsx");
const palette = read("client/src/components/command-palette.tsx");
const brandingEditor = read("client/src/components/settings/branding-editor.tsx");
const tenantTheme = read("client/src/contexts/tenant-theme-context.tsx");
const leadsPage = read("client/src/pages/leads.tsx");
const dataExport = read("client/src/pages/data-export.tsx");

// Per-builder lead counts, counted from the seeder's own fixture arrays.
function seederLeadCounts(): number[] {
  const blocks = seeder.split(/\nfunction build\w+Fixtures\(/).slice(1);
  expect(blocks.length).toBeGreaterThan(10);
  return blocks.map((b) => {
    const m = b.match(/const leads: SampleLeadFixture\[\] = \[([\s\S]*?)\n  \];/);
    if (!m) throw new Error("a seeder builder has no leads fixture array");
    return (m[1].match(/organizationId: orgId/g) ?? []).length;
  });
}

describe("A1-01 — onboarding sample-data copy states the seeder's real counts", () => {
  it("the seeder seeds a small per-type set (the range the copy must state)", () => {
    const counts = seederLeadCounts();
    expect(Math.min(...counts)).toBe(2);
    expect(Math.max(...counts)).toBe(5);
    expect(counts).not.toContain(50);
  });

  it("the sample-data card states the seeder's real range, not 50", () => {
    const counts = seederLeadCounts();
    expect(onboarding).toContain(`${Math.min(...counts)} to ${Math.max(...counts)}`);
    expect(onboarding).not.toMatch(/50 realistic leads/);
    expect(onboarding).not.toMatch(/loads 50/);
    expect(onboarding).not.toMatch(/loaded 50/);
  });

  it("the success toast reports the seed response's count with no fabricated fallback", () => {
    expect(onboarding).toContain("data.counts.leads");
    expect(onboarding).not.toMatch(/\?\? 50/);
  });
});

describe("A5-01 — pipeline header reads the whole set, not the first page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pages through at the cap until a short page arrives", async () => {
    const pageOf = (n: number, size: number) =>
      Array.from({ length: size }, (_, i) => ({ id: (n - 1) * 100 + i + 1, status: "new" }));
    const fetchMock = vi.fn(async (url: string) => {
      const page = Number(new URL(url, "http://x").searchParams.get("page"));
      const rows = page === 1 ? pageOf(1, 100) : page === 2 ? pageOf(2, 100) : pageOf(3, 37);
      return { ok: true, status: 200, json: async () => rows } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const all = await fetchAllPages<{ id: number; status: string }>("/api/leads");
    expect(all).toHaveLength(237);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/leads?page=1&pageSize=100");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/leads?page=3&pageSize=100");
  });

  it("a first page shorter than the cap is the whole set (one request)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ id: 1, status: "new" }],
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const all = await fetchAllPages("/api/deals");
    expect(all).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("both header queries use the paging reader", () => {
    expect(pipeline).toContain('fetchAllPages<Lead>("/api/leads")');
    expect(pipeline).toContain('fetchAllPages<Deal>("/api/deals")');
    expect(pipeline).not.toContain('fetchJsonArray<Lead>("/api/leads")');
    expect(pipeline).not.toContain('fetchJsonArray<Deal>("/api/deals")');
  });
});

describe("A2-03 — default toast variant is a solid surface", () => {
  it("the default variant is not liquid-glass and uses the solid surface token", () => {
    expect(toast).not.toMatch(/default:\s*"liquid-glass"/);
    expect(toast).toMatch(/default:\s*\n?\s*"border-l-4 bg-\[var\(--acr-surface\)\]/);
  });
});

describe("A2-11 — the dead sound surface is removed", () => {
  it("the stub hook file is gone", () => {
    expect(existsSync(resolve(repoRoot, "client/src/hooks/use-sound.ts"))).toBe(false);
  });

  it("the preferences card has no sound toggle", () => {
    expect(preferencesCard).not.toContain("useSound");
    expect(preferencesCard).not.toContain("switch-sound-enabled");
    expect(preferencesCard).not.toContain("pref-sound");
    expect(preferencesCard).not.toContain("acreos-sound-enabled");
  });

  it("the deal-closed modal dispatches no listener-less sound event", () => {
    expect(dealClosedModal).not.toMatch(/dispatchEvent\(new CustomEvent\("acreos:sound"\)/);
    expect(dealClosedModal).not.toContain("@/hooks/use-sound");
  });
});

describe("A5-02 — palette lead-status menu offers exactly LEAD_STATUSES", () => {
  it("the menu is derived from the canonical list", () => {
    expect(palette).toContain('from "@shared/lifecycle/pipeline-status"');
    expect(palette).toMatch(/LEAD_STATUSES\.map\(/);
  });

  it("no non-canonical status literals remain in the menu", () => {
    // Scoped to the menu-entry shape: the cure's own comment names the
    // old values in prose, which is documentation, not an offered status.
    expect(palette).not.toContain("value: 'contacting'");
    expect(palette).not.toContain("value: 'negotiation'");
    expect(palette).not.toContain('value: "contacting"');
    expect(palette).not.toContain('value: "negotiation"');
  });

  it("the label map covers exactly the canonical statuses", () => {
    const m = palette.match(/LEAD_STATUS_LABELS: Record<LeadStatus, string> = \{([\s\S]*?)\};/);
    if (!m) throw new Error("LEAD_STATUS_LABELS map not found");
    const keys = [...m[1].matchAll(/^\s{2}(\w+):/gm)].map((x) => x[1]).sort();
    expect(keys).toEqual([...LEAD_STATUSES].sort());
  });
});

describe("A2-12 — no dead brand-density picker or false copy", () => {
  it("the branding editor has no density picker and sends no density field", () => {
    expect(brandingEditor).not.toContain("select-brand-density");
    expect(brandingEditor).not.toContain("DENSITY_OPTIONS");
    expect(brandingEditor).not.toContain("branding-density");
    expect(brandingEditor).not.toMatch(/brandDensity:/);
    expect(brandingEditor).not.toContain("logo, and density");
  });

  it("the tenant-theme context no longer exposes brandDensity", () => {
    expect(tenantTheme).not.toMatch(/brandDensity: "compact"/);
    expect(tenantTheme).not.toContain("brandDensity: null");
    expect(tenantTheme).not.toContain("brandDensity: density");
  });
});

describe("A5-05 — consent grants require an attestation; the badge distinguishes attested consent", () => {
  it("no one-click grant/restore fires the PATCH with admin_manual", () => {
    expect(leadsPage).not.toMatch(/mutate\(\{ tcpaConsent: true, consentSource: "admin_manual" \}\)/);
  });

  it("the attestation step exists and gates the record action", () => {
    expect(leadsPage).toContain("consent-attestation-");
    expect(leadsPage).toContain("select-consent-method-");
    expect(leadsPage).toContain("checkbox-consent-attest-");
    expect(leadsPage).toContain("button-record-consent-");
    expect(leadsPage).toContain("disabled={!attestationComplete || consentMutation.isPending}");
    expect(leadsPage).toContain("I attest this lead personally gave express consent");
  });

  it("the recorded source is the attested channel, chosen from the canonical methods", () => {
    expect(leadsPage).toMatch(/consentSource: attestMethod/);
    for (const src of ["sms_double_optin", "website", "written", "verbal", "phone_ivr"]) {
      expect(leadsPage).toContain(`{ value: "${src}"`);
    }
  });

  it("the badge distinguishes admin-attested consent from lead-captured opt-in", () => {
    expect(leadsPage).toContain("ADMIN_ATTESTED_CONSENT_SOURCES");
    expect(leadsPage).toContain('"admin_manual"');
    expect(leadsPage).toContain("TCPA · Attested");
    expect(leadsPage).toContain("not captured directly from the lead");
  });
});

describe("A16-03 — no export button points at a route that refuses it", () => {
  it("the Campaigns and Activity log cards are gone", () => {
    expect(dataExport).not.toContain("/api/export/campaigns");
    expect(dataExport).not.toContain("/api/export/activities");
    expect(dataExport).not.toContain('label: "Campaigns"');
    expect(dataExport).not.toContain('label: "Activity log"');
  });

  it("the archive card runs the everything-job flow, not the dead GET", () => {
    // Scoped to the old card's endpoint shape; the header comment names
    // the dead route in prose to document why it was replaced.
    expect(dataExport).not.toContain('endpoint: "/api/export/archive"');
    expect(dataExport).toContain('"/api/export/everything"');
    expect(dataExport).toMatch(/method: "POST"/);
    expect(dataExport).toContain("/api/export/jobs/${jobId}");
    expect(dataExport).toContain("/api/export/jobs/${jobId}/download");
    expect(dataExport).toContain("button-download-archive");
  });
});
