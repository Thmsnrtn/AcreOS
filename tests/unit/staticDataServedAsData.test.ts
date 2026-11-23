/**
 * Static copy is served as data assets, not bundled JS (bundle diet
 * micro-slice, the BD-6 / legal-docs pattern generalised).
 *
 * Three registries left the client bundle:
 *   - CAMPAIGN_TEMPLATES (shared/outreach/templates.ts) →
 *     /outreach-templates.json, read by the campaign composer's picker
 *     through client/src/lib/outreach-templates.ts;
 *   - CUSTOMER_CHANGELOG (client/src/data/customer-changelog.ts) →
 *     /customer-changelog.json, read by the /changelog page;
 *   - the help centre's feature guides + FAQ (source of truth moved to
 *     client/src/data/help-content-data.ts) → /help-content.json, read
 *     by client/src/components/help-content.tsx.
 *
 * That stays safe only while:
 *   1. each served asset is VERBATIM its module's data — same strings,
 *      no silent edits (the modules stay the source of truth; the
 *      server and other suites import them synchronously);
 *   2. the client selector reproduces campaignTemplatesFor exactly
 *      (language fallback, unknown channel → []);
 *   3. the help data's {{TOKEN}} placeholders resolve, from the live
 *      @shared/pax-glossary-core constants, to exactly the strings the
 *      old inline arrays computed — and every named icon is a real
 *      lucide export the component maps;
 *   4. no client file value-imports the externalised registries back
 *      into the bundle (type-only imports are erased and fine);
 *   5. the shared loader rejects on !ok and clears its cache on
 *      rejection, so a retry can succeed;
 *   6a. (diet micro-slice #3) /trust copy: client/src/data/trust-content-data.ts
 *      (source of truth) → /trust-content.json; the page loads it via the
 *      shared loader and renders a visible error on failure; the claims
 *      audit reads the module, so all 27 anchored sentences stay verbatim.
 *      Regenerate: npx tsx -e 'import {TRUST_SECTIONS} from "./client/src/data/trust-content-data";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/trust-content.json", JSON.stringify(TRUST_SECTIONS,null,2)+"\n")'
 *   6. the static server never gives the unhashed assets the 1-year
 *      immutable cache.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as lucide from "lucide-react";
import {
  CAMPAIGN_TEMPLATES,
  campaignTemplatesFor,
} from "../../shared/outreach/templates";
import { TRUST_SECTIONS } from "../../client/src/data/trust-content-data";
import { CUSTOMER_CHANGELOG } from "../../client/src/data/customer-changelog";
import {
  HELP_FAQ_ITEMS,
  HELP_FEATURE_GUIDES,
} from "../../client/src/data/help-content-data";
import {
  PAX_CONTROLS_LABEL,
  PAX_LABELS,
  PAX_PAUSE_STILL_WORKS,
  PAX_STANDING_LINE,
} from "../../shared/pax-glossary-core";
import {
  loadStaticData,
  substituteTokens,
} from "../../client/src/lib/static-data";
import {
  selectCampaignTemplates,
  type CampaignTemplatesData,
} from "../../client/src/lib/outreach-templates";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

// The no-rebundle sweep walks all of client/src; declare its budget.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.join(__dirname, "../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf8");
const readJson = (rel: string): unknown => JSON.parse(read(rel));

const OUTREACH_ASSET = readJson("client/public/outreach-templates.json");
const CHANGELOG_ASSET = readJson("client/public/customer-changelog.json");
const TRUST_ASSET = readJson("client/public/trust-content.json");
const HELP_ASSET = readJson("client/public/help-content.json") as {
  featureGuides: typeof HELP_FEATURE_GUIDES;
  faqItems: typeof HELP_FAQ_ITEMS;
};

// ── 1. Verbatim: asset data == module data ────────────────────────────────

describe("served assets are verbatim the modules' data", () => {
  it("outreach-templates.json deep-equals CAMPAIGN_TEMPLATES", () => {
    expect(OUTREACH_ASSET).toEqual(CAMPAIGN_TEMPLATES);
  });

  it("customer-changelog.json deep-equals CUSTOMER_CHANGELOG", () => {
    expect(CHANGELOG_ASSET).toEqual(CUSTOMER_CHANGELOG);
  });

  it("trust-content.json deep-equals TRUST_SECTIONS", () => {
    expect(TRUST_ASSET).toEqual(TRUST_SECTIONS);
  });

  it("trust-content.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/trust-content.json")).toBe(
      JSON.stringify(TRUST_SECTIONS, null, 2) + "\n",
    );
  });

  it("help-content.json deep-equals the help data module", () => {
    expect(HELP_ASSET).toEqual({
      featureGuides: HELP_FEATURE_GUIDES,
      faqItems: HELP_FAQ_ITEMS,
    });
  });
});

// ── 2. Selector equivalence with campaignTemplatesFor ─────────────────────

describe("selectCampaignTemplates reproduces campaignTemplatesFor", () => {
  const data = OUTREACH_ASSET as CampaignTemplatesData;
  it.each([
    ["en", "direct_mail"],
    ["en", "email"],
    ["en", "sms"],
    ["es", "direct_mail"],
    ["es", "email"],
    ["es", "sms"],
    ["en", "carrier_pigeon"],
    ["es", ""],
  ] as const)("%s / %s", (language, channel) => {
    expect(selectCampaignTemplates(data, language, channel)).toEqual(
      campaignTemplatesFor(language, channel),
    );
  });

  it("unknown language falls back to English, like the module", () => {
    const fr = "fr" as never;
    expect(selectCampaignTemplates(data, fr, "email")).toEqual(
      campaignTemplatesFor(fr, "email"),
    );
  });
});

// ── 3. Help tokens resolve to the old inline strings ──────────────────────

describe("help {{TOKEN}} placeholders resolve to the pre-extraction strings", () => {
  const TOKENS: Record<string, string> = {
    PAX_STANDING_LINE,
    PAX_CONTROLS_LABEL,
    PAX_MENTAL_MODEL: PAX_LABELS.mentalModel.join(" "),
    PAX_FIXED_RULE: PAX_LABELS.fixedRule,
    PAX_QUEUE: PAX_LABELS.queue,
    PAX_PAUSE_STILL_WORKS,
  };
  const resolve = (s: string) => substituteTokens(s, TOKENS);

  it("no placeholder survives resolution, anywhere in the asset", () => {
    for (const guide of HELP_ASSET.featureGuides) {
      expect(resolve(guide.description)).not.toContain("{{");
      for (const detail of guide.details) {
        expect(resolve(detail)).not.toContain("{{");
      }
    }
    for (const faq of HELP_ASSET.faqItems) {
      expect(resolve(faq.question)).not.toContain("{{");
      expect(resolve(faq.answer)).not.toContain("{{");
    }
  });

  it("the Pax guide description IS the standing line constant", () => {
    const paxGuide = HELP_ASSET.featureGuides.find((g) => g.title === "Pax");
    expect(paxGuide).toBeDefined();
    expect(resolve(paxGuide!.description)).toBe(PAX_STANDING_LINE);
    expect(resolve(paxGuide!.details[4])).toBe(
      `One button under ${PAX_CONTROLS_LABEL} pauses everything that runs on its own`,
    );
  });

  it("the Pax FAQ answers rebuild the old concatenations exactly", () => {
    const byQuestion = new Map(
      HELP_ASSET.faqItems.map((f) => [f.question, resolve(f.answer)]),
    );
    expect(byQuestion.get("How does Pax work?")).toBe(
      PAX_LABELS.mentalModel.join(" ") +
        ` The chat and the queue are behind the Pax door in the sidebar. The switches, the receipts and the pause button are under ${PAX_CONTROLS_LABEL}.` +
        " Most plans include a set number of Pax messages each month; connect your own AI key under Settings → Your provider keys to chat past it.",
    );
    expect(byQuestion.get("Can Pax email or text someone without me?")).toBe(
      `No. ${PAX_LABELS.fixedRule}` +
        ` Pax writes the message and puts it in "${PAX_LABELS.queue}" on the Pax page, with what it wrote and why. You approve it, edit it, or reject it — nothing leaves until you do.` +
        " Drips and campaign sequences you switched on are the exception: those go out on the schedule you set, and each one has its own switch.",
    );
    expect(byQuestion.get("How do I stop Pax?")).toBe(
      `Open ${PAX_CONTROLS_LABEL} and tap Pause, then choose how long. That stops the things that run without you — workflows, campaign sequences, scheduled prompts, lead scoring, borrower reminder prep.` +
        ` ${PAX_PAUSE_STILL_WORKS}` +
        " The same page lists each of them separately, so you can switch off one thing instead of all of it.",
    );
  });

  it("every guide icon names a real lucide export the component maps", () => {
    const component = read("client/src/components/help-content.tsx");
    for (const guide of HELP_FEATURE_GUIDES) {
      expect(
        (lucide as Record<string, unknown>)[guide.icon],
        `${guide.icon} is not a lucide export`,
      ).toBeDefined();
      expect(
        component,
        `help-content.tsx does not map the ${guide.icon} icon`,
      ).toContain(`${guide.icon},`);
    }
  });
});

// ── 4. Nothing re-bundles the externalised registries ─────────────────────

describe("no client file value-imports the externalised registries", () => {
  function* walk(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
    }
  }

  it("client/src references the registries type-only, or not at all", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "client/src"))) {
      const src = stripComments(fs.readFileSync(file, "utf8"));
      for (const m of src.matchAll(
        /import\s+(type\s+)?\{[^}]*\}\s+from\s+["']([^"']+)["']/g,
      )) {
        const isTypeOnly = Boolean(m[1]);
        const from = m[2];
        if (isTypeOnly) continue;
        if (
          from === "@shared/outreach/templates" ||
          from.endsWith("/data/customer-changelog") ||
          from.endsWith("/data/help-content-data") ||
          from.endsWith("/data/trust-content-data")
        ) {
          offenders.push(
            `${path.relative(ROOT, file)} value-imports ${from}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the consumers read the served assets through the shared loader", () => {
    expect(read("client/src/components/campaigns-content.tsx")).toContain(
      "useCampaignTemplates",
    );
    expect(read("client/src/pages/changelog.tsx")).toContain(
      "CUSTOMER_CHANGELOG_URL",
    );
    expect(read("client/src/components/help-content.tsx")).toContain(
      "HELP_CONTENT_URL",
    );
    expect(read("client/src/pages/trust.tsx")).toContain("TRUST_CONTENT_URL");
  });

  it("/trust renders a VISIBLE error on loader failure, never a blank page", () => {
    const page = stripComments(read("client/src/pages/trust.tsx"));
    expect(page).toContain("useStaticData<TrustSection[]>(TRUST_CONTENT_URL)");
    expect(page).toMatch(/\{error && \(\s*<p role="alert"/);
    expect(page).toContain('data-testid="trust-load-error"');
  });

  it("the /trust claims audit reads the source module with the same sentences (anchors not weakened)", () => {
    const audit = read("scripts/audit-public-claims.ts");
    expect(audit).toContain('"client/src/pages/trust.tsx"');
    expect(audit).toContain('"client/src/data/trust-content-data.ts"');
    // The 27 TRUST_LINES anchors are exactly the module's sentences, in order.
    const block = audit.slice(
      audit.indexOf("const TRUST_LINES"),
      audit.indexOf("const CLAIMS"),
    );
    const anchored = [...block.matchAll(/^\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)].map(
      (m) => JSON.parse(`"${m[1]}"`) as string,
    );
    const served = (TRUST_ASSET as typeof TRUST_SECTIONS).flatMap((s) => s.lines);
    expect(anchored).toHaveLength(27);
    expect(served).toEqual(anchored);
  });
});

// ── 5. Loader behaviour ────────────────────────────────────────────────────

describe("loadStaticData", () => {
  it("rejects on !ok, and a retry after rejection can succeed", async () => {
    const url = "/help-content.json";
    const failing = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", failing);
    await expect(loadStaticData(url)).rejects.toThrow("HTTP 503");

    const ok = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ featureGuides: [], faqItems: [] }),
    }));
    vi.stubGlobal("fetch", ok);
    await expect(loadStaticData(url)).resolves.toEqual({
      featureGuides: [],
      faqItems: [],
    });
    vi.unstubAllGlobals();
  });

  it("substituteTokens replaces known tokens and leaves unknown ones visible", () => {
    expect(substituteTokens("a {{KNOWN}} b {{NOPE}}", { KNOWN: "x" })).toBe(
      "a x b {{NOPE}}",
    );
  });
});

// ── 6. The unhashed assets never get the immutable cache ──────────────────

describe("static server cache discipline", () => {
  it("server/static.ts no-cache-lists all three assets", () => {
    const src = read("server/static.ts");
    for (const url of [
      "/outreach-templates.json",
      "/customer-changelog.json",
      "/help-content.json",
      "/trust-content.json",
    ]) {
      expect(src).toContain(`"${url}"`);
    }
    expect(src).toContain("isStaticDataPath");
  });
});
