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
 *   7. (PR #697 diet) per-vertical onboarding copy:
 *      client/src/data/onboarding-verticals-data.ts (source of truth) →
 *      /onboarding-verticals.json; the wizard loads it via the shared
 *      loader, the lib selectors run over the fetched data with their
 *      pre-extraction semantics, and a loader failure renders a visible
 *      error, never a wizard wearing the wrong vertical's copy.
 *      Regenerate: npx tsx -e 'import {VERTICAL_ONBOARDING, NOTE_ROLE_DATA_OVERRIDES} from "./client/src/data/onboarding-verticals-data";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/onboarding-verticals.json", JSON.stringify({verticals: VERTICAL_ONBOARDING, noteRoleOverrides: NOTE_ROLE_DATA_OVERRIDES}, null, 2)+"\n")'

 *   8. (landing-copy diet) LANDING_COPY (client/src/pages/landing/copy.ts,
 *      source of truth — the claims audit's LANDING_FILES already lists
 *      it, so no re-pointing) → /landing-copy.json; landing.tsx loads it
 *      ONCE via useLandingCopy (client/src/lib/landing-copy.ts) and
 *      threads each section its slice as a prop; the loaded shape is
 *      validated at the loader boundary (isLandingCopy) so a wrong-shape
 *      200 flows into the visible load-error path, never a section crash
 *      (the wrong-shape regression lives in
 *      tests/unit/landingCopyWrongShapeAsset.test.tsx).
 *      Regenerate: npx tsx -e 'import {LANDING_COPY} from "./client/src/pages/landing/copy";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/landing-copy.json", JSON.stringify(LANDING_COPY,null,2)+"\n")'
 *   9. (diet Candidate 3) ⌘K palette verbs: PALETTE_VERBS
 *      (client/src/data/cmdk-verbs-data.ts, source of truth) →
 *      /palette-verbs.json; the command palette loads it via
 *      usePaletteVerbs (client/src/lib/cmdkVerbs.ts) over the shared
 *      loader, the loaded shape is validated at the boundary
 *      (isPaletteVerbs) so a wrong-shape 200 flows into the palette's
 *      visible load-error line, and the matcher behaviour battery
 *      below pins rankItems over the served asset identical to the
 *      module data for representative queries.
 *      Regenerate: npx tsx -e 'import {PALETTE_VERBS} from "./client/src/data/cmdk-verbs-data";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/palette-verbs.json", JSON.stringify(PALETTE_VERBS,null,2)+"\n")'
 *
 *   9. (diet Candidate 2) the glossary registry: GLOSSARY
 *      (client/src/lib/glossary.ts, source of truth) →
 *      /glossary.json; the /glossary page and the <GlossaryTerm>
 *      tooltip load it via useGlossaryData
 *      (client/src/lib/glossary-data.ts), the loaded shape is
 *      validated at the loader boundary (isGlossaryData) so a
 *      wrong-shape 200 flows into the page's visible load-error,
 *      the tooltip renders its children plainly while loading / on
 *      failure (its unknown-slug behaviour), and the page's JSON-LD
 *      is built from the loaded asset, identical to the schema the
 *      module data produced.
 *      Regenerate: npx tsx -e 'import {GLOSSARY} from "./client/src/lib/glossary";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/glossary.json", JSON.stringify(GLOSSARY,null,2)+"\n")'
 *   9. (bundle diet Candidate 1) getting-started checklist copy:
 *      client/src/data/onboarding-checklist-data.ts (source of truth) →
 *      /onboarding-checklist.json; the checklist component loads it via
 *      the shared loader, the lib's step factory rehydrates the rows
 *      (signals/icons stay in code), the loaded shape is guarded at the
 *      boundary (isOnboardingChecklistData), and a loader failure renders
 *      the shell with a visible failure line, never a vanished checklist.
 *      Regenerate: npx tsx -e 'import {ONBOARDING_CHECKLIST_DATA} from "./client/src/data/onboarding-checklist-data";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/onboarding-checklist.json", JSON.stringify(ONBOARDING_CHECKLIST_DATA, null, 2)+"\n")'
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
import {
  NOTE_ROLE_DATA_OVERRIDES,
  VERTICAL_ONBOARDING,
  type OnboardingVerticalsData,
} from "../../client/src/data/onboarding-verticals-data";
import {
  getDataStepCopy,
  getVerticalOnboarding,
  isOnboardingVerticalsData,
} from "../../client/src/lib/onboarding-verticals";
import {
  ONBOARDING_CHECKLIST_DATA,
  type OnboardingChecklistData,
} from "../../client/src/data/onboarding-checklist-data";
import {
  buildChecklistsByBusinessType,
  getChecklistItems,
  isOnboardingChecklistData,
} from "../../client/src/lib/onboarding-checklist";
import { BUSINESS_TYPE_IDS } from "../../shared/business-types";
import { LANDING_COPY } from "../../client/src/pages/landing/copy";
import { isLandingCopy } from "../../client/src/lib/landing-copy";
import { PALETTE_VERBS } from "../../client/src/data/cmdk-verbs-data";
import {
  isPaletteVerbs,
  type PaletteVerb,
} from "../../client/src/lib/cmdkVerbs";
import { rankItems } from "../../shared/cmdkMatcher";
import {
  GLOSSARY,
  getGlossaryEntry as moduleGetGlossaryEntry,
} from "../../client/src/lib/glossary";
import {
  getGlossaryEntry as servedGetGlossaryEntry,
  isGlossaryData,
  type GlossaryData,
} from "../../client/src/lib/glossary-data";
import { glossarySchema } from "../../client/src/lib/jsonld-schemas";
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
const ONBOARDING_ASSET = readJson(
  "client/public/onboarding-verticals.json",
) as OnboardingVerticalsData;
const MODULE_ONBOARDING_DATA: OnboardingVerticalsData = {
  verticals: VERTICAL_ONBOARDING,
  noteRoleOverrides: NOTE_ROLE_DATA_OVERRIDES,
};
const LANDING_ASSET = readJson("client/public/landing-copy.json");
const PALETTE_ASSET = readJson(
  "client/public/palette-verbs.json",
) as PaletteVerb[];
const GLOSSARY_ASSET = readJson("client/public/glossary.json") as GlossaryData;
const CHECKLIST_ASSET = readJson(
  "client/public/onboarding-checklist.json",
) as OnboardingChecklistData;
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

  it("onboarding-verticals.json deep-equals the onboarding data module", () => {
    expect(ONBOARDING_ASSET).toEqual(MODULE_ONBOARDING_DATA);
  });

  it("onboarding-verticals.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/onboarding-verticals.json")).toBe(
      JSON.stringify(MODULE_ONBOARDING_DATA, null, 2) + "\n",
    );
  });

  it("onboarding-checklist.json deep-equals the checklist data module", () => {
    expect(CHECKLIST_ASSET).toEqual(ONBOARDING_CHECKLIST_DATA);
  });

  it("onboarding-checklist.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/onboarding-checklist.json")).toBe(
      JSON.stringify(ONBOARDING_CHECKLIST_DATA, null, 2) + "\n",
    );
  });

  it("landing-copy.json deep-equals LANDING_COPY", () => {
    expect(LANDING_ASSET).toEqual(LANDING_COPY);
  });

  it("landing-copy.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/landing-copy.json")).toBe(
      JSON.stringify(LANDING_COPY, null, 2) + "\n",
    );
  });

  it("palette-verbs.json deep-equals PALETTE_VERBS", () => {
    expect(PALETTE_ASSET).toEqual(PALETTE_VERBS);
  });

  it("palette-verbs.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/palette-verbs.json")).toBe(
      JSON.stringify(PALETTE_VERBS, null, 2) + "\n",
    );
  });

  it("glossary.json deep-equals GLOSSARY", () => {
    expect(GLOSSARY_ASSET).toEqual(GLOSSARY);
  });

  it("glossary.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/glossary.json")).toBe(
      JSON.stringify(GLOSSARY, null, 2) + "\n",
    );
  });

  it("help-content.json deep-equals the help data module", () => {
    expect(HELP_ASSET).toEqual({
      featureGuides: HELP_FEATURE_GUIDES,
      faqItems: HELP_FAQ_ITEMS,
    });
  });
});

// ── 1b. Onboarding selectors: served asset behaves as the module data ────

describe("onboarding selectors over the served asset match the module", () => {
  it("getVerticalOnboarding agrees for every id + unknown input", () => {
    for (const id of Object.keys(VERTICAL_ONBOARDING)) {
      expect(getVerticalOnboarding(ONBOARDING_ASSET, id)).toEqual(
        getVerticalOnboarding(MODULE_ONBOARDING_DATA, id),
      );
    }
    expect(getVerticalOnboarding(ONBOARDING_ASSET, undefined)).toEqual(
      VERTICAL_ONBOARDING.land_flipper,
    );
    expect(getVerticalOnboarding(ONBOARDING_ASSET, "not_a_type")).toEqual(
      VERTICAL_ONBOARDING.land_flipper,
    );
  });

  it("getDataStepCopy agrees across verticals and note roles", () => {
    for (const id of Object.keys(VERTICAL_ONBOARDING)) {
      for (const role of ["invest", "originate", "service"] as const) {
        expect(getDataStepCopy(ONBOARDING_ASSET, id, role)).toEqual(
          getDataStepCopy(MODULE_ONBOARDING_DATA, id, role),
        );
      }
    }
  });
});

// ── 1c. Loaded-shape guard: a wrong-shape 200 is a load failure (D-2) ────

describe("isOnboardingVerticalsData guards the loaded asset shape", () => {
  it("accepts the served asset and the module data", () => {
    expect(isOnboardingVerticalsData(ONBOARDING_ASSET)).toBe(true);
    expect(isOnboardingVerticalsData(MODULE_ONBOARDING_DATA)).toBe(true);
  });

  it("rejects the D-2 payload: a 200 with body {}", () => {
    expect(isOnboardingVerticalsData({})).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "verticals"],
    ["verticals missing", { noteRoleOverrides: NOTE_ROLE_DATA_OVERRIDES }],
    ["noteRoleOverrides missing", { verticals: VERTICAL_ONBOARDING }],
    ["verticals not an object", { verticals: 42, noteRoleOverrides: NOTE_ROLE_DATA_OVERRIDES }],
    [
      "one vertical missing",
      {
        verticals: { ...VERTICAL_ONBOARDING, land_flipper: undefined },
        noteRoleOverrides: NOTE_ROLE_DATA_OVERRIDES,
      },
    ],
    [
      "a vertical with a malformed finish",
      {
        verticals: {
          ...VERTICAL_ONBOARDING,
          note_investor: { ...VERTICAL_ONBOARDING.note_investor, finish: { path: "/money" } },
        },
        noteRoleOverrides: NOTE_ROLE_DATA_OVERRIDES,
      },
    ],
    [
      "a vertical with a non-pair dataTitle",
      {
        verticals: {
          ...VERTICAL_ONBOARDING,
          hybrid: { ...VERTICAL_ONBOARDING.hybrid, dataTitle: ["only one"] },
        },
        noteRoleOverrides: NOTE_ROLE_DATA_OVERRIDES,
      },
    ],
    [
      "the invest override missing (selector fallback target)",
      {
        verticals: VERTICAL_ONBOARDING,
        noteRoleOverrides: { ...NOTE_ROLE_DATA_OVERRIDES, invest: undefined },
      },
    ],
  ])("rejects %s", (_label, payload) => {
    expect(isOnboardingVerticalsData(payload)).toBe(false);
  });
});

// ── 1d. Palette verbs: matcher behaviour over the asset == the module ────

describe("palette matcher over the served asset matches the module data", () => {
  // The palette's own item mapping (command-palette.tsx matchedVerbs).
  const toItems = (verbs: readonly PaletteVerb[], scope?: string) =>
    verbs
      .filter((v) => (scope ? v.scope === scope || v.scope === "global" : true))
      .map((v) => ({
        id: v.id,
        title: v.label,
        subtitle: v.hint,
        keywords: v.keywords,
        kind: "verb" as const,
        verb: v,
      }));
  const rankedShape = (
    verbs: readonly PaletteVerb[],
    query: string,
    scope?: string,
  ) =>
    rankItems(query, toItems(verbs, scope), {
      keepAll: query.trim() === "",
    }).map((r) => ({ id: r.item.id, score: r.score }));

  it.each([
    "",
    "add lead",
    "send letter",
    "skip trace",
    "billing",
    "export csv",
    "qualify",
    "close won",
    "switch org",
    "xyzqq",
  ])("query %j ranks identically", (query) => {
    expect(rankedShape(PALETTE_ASSET, query)).toEqual(
      rankedShape(PALETTE_VERBS, query),
    );
  });

  it.each(["leads", "deals", "properties", "inbox", "settings", "global"])(
    "scope %s filters + ranks identically",
    (scope) => {
      expect(rankedShape(PALETTE_ASSET, "a", scope)).toEqual(
        rankedShape(PALETTE_VERBS, "a", scope),
      );
    },
  );

  it("every verb iconKey names a real lucide export the palette maps", () => {
    const component = read("client/src/components/command-palette.tsx");
    for (const verb of PALETTE_VERBS) {
      expect(
        (lucide as Record<string, unknown>)[verb.iconKey],
        `${verb.iconKey} is not a lucide export`,
      ).toBeDefined();
      expect(
        component,
        `command-palette.tsx does not map the ${verb.iconKey} icon`,
      ).toContain(`${verb.iconKey},`);
    }
  });
});

// ── 1e. Palette-verbs shape guard: a wrong-shape 200 is a load failure ───

describe("isPaletteVerbs guards the loaded asset shape", () => {
  it("accepts the served asset and the module data", () => {
    expect(isPaletteVerbs(PALETTE_ASSET)).toBe(true);
    expect(isPaletteVerbs(PALETTE_VERBS)).toBe(true);
  });

  it.each([
    ["null", null],
    ["an object", {}],
    ["a string", "verbs"],
    ["an empty array", []],
    ["a record missing label", [{ ...PALETTE_VERBS[0], label: undefined }]],
    ["a record with a non-string path", [{ ...PALETTE_VERBS[0], path: 42 }]],
    [
      "a record with non-array keywords",
      [{ ...PALETTE_VERBS[0], keywords: "lead" }],
    ],
    ["a record with an unknown scope", [{ ...PALETTE_VERBS[0], scope: "bogus" }]],
    [
      "a record with an unknown iconKey",
      [{ ...PALETTE_VERBS[0], iconKey: "NotAnIcon" }],
    ],
    ["a record with a non-string hint", [{ ...PALETTE_VERBS[0], hint: 7 }]],
  ])("rejects %s", (_label, payload) => {
    expect(isPaletteVerbs(payload)).toBe(false);
  });
});

// ── 1d. Glossary: shape guard, selector + JSON-LD equivalence ────────────

describe("isGlossaryData guards the loaded glossary shape", () => {
  it("accepts the served asset and the module data", () => {
    expect(isGlossaryData(GLOSSARY_ASSET)).toBe(true);
    expect(isGlossaryData(GLOSSARY)).toBe(true);
  });

  it("rejects the D-2 payload: a 200 with body {}", () => {
    expect(isGlossaryData({})).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "glossary"],
    ["an entry missing its definition", { comp: { term: "Comp" } }],
    ["an entry with a non-string term", { comp: { term: 42, definition: "x" } }],
    ["an entry that is not an object", { comp: "Comparable property" }],
  ])("rejects %s", (_label, payload) => {
    expect(isGlossaryData(payload)).toBe(false);
  });
});

describe("glossary selector + JSON-LD over the served asset match the module", () => {
  it("getGlossaryEntry(data, slug) reproduces the module selector for every slug + unknown", () => {
    for (const slug of Object.keys(GLOSSARY)) {
      expect(servedGetGlossaryEntry(GLOSSARY_ASSET, slug)).toEqual(
        moduleGetGlossaryEntry(slug),
      );
    }
    expect(servedGetGlossaryEntry(GLOSSARY_ASSET, "not_a_term")).toBeUndefined();
    expect(moduleGetGlossaryEntry("not_a_term")).toBeUndefined();
  });

  it("getGlossaryEntry(null, slug) is undefined — the loading / failure state", () => {
    expect(servedGetGlossaryEntry(null, "comp")).toBeUndefined();
  });

  it("glossarySchema over the asset entries deep-equals the module's schema", () => {
    const toInputs = (data: GlossaryData) =>
      Object.entries(data)
        .map(([slug, e]) => ({ slug, ...e }))
        .sort((a, b) => a.term.localeCompare(b.term))
        .map((e) => ({ slug: e.slug, term: e.term, definition: e.definition }));
    expect(glossarySchema(toInputs(GLOSSARY_ASSET))).toEqual(
      glossarySchema(toInputs(GLOSSARY)),
    );
  });
});

// ── 1d. Checklist builders: served asset behaves as the module data ──────

describe("checklist builders over the served asset match the module", () => {
  it("buildChecklistsByBusinessType agrees, icons and signals included", () => {
    expect(buildChecklistsByBusinessType(CHECKLIST_ASSET)).toEqual(
      buildChecklistsByBusinessType(ONBOARDING_CHECKLIST_DATA),
    );
  });

  it("getChecklistItems agrees for every business type", () => {
    for (const bt of BUSINESS_TYPE_IDS) {
      expect(getChecklistItems(CHECKLIST_ASSET, bt)).toEqual(
        getChecklistItems(ONBOARDING_CHECKLIST_DATA, bt),
      );
    }
  });
});

// ── 1e. Checklist loaded-shape guard: a wrong-shape 200 is a load failure ─

describe("isOnboardingChecklistData guards the loaded asset shape", () => {
  it("accepts the served asset and the module data", () => {
    expect(isOnboardingChecklistData(CHECKLIST_ASSET)).toBe(true);
    expect(isOnboardingChecklistData(ONBOARDING_CHECKLIST_DATA)).toBe(true);
  });

  it("rejects the D-2 payload: a 200 with body {}", () => {
    expect(isOnboardingChecklistData({})).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "checklists"],
    [
      "connectServices missing",
      { checklists: ONBOARDING_CHECKLIST_DATA.checklists },
    ],
    [
      "one business type missing",
      {
        connectServices: ONBOARDING_CHECKLIST_DATA.connectServices,
        checklists: { ...ONBOARDING_CHECKLIST_DATA.checklists, hybrid: undefined },
      },
    ],
    [
      "a row with an unknown step base",
      {
        connectServices: ONBOARDING_CHECKLIST_DATA.connectServices,
        checklists: {
          ...ONBOARDING_CHECKLIST_DATA.checklists,
          hybrid: [
            { base: "teleport", title: "Skip ahead", description: "No such step" },
          ],
        },
      },
    ],
    [
      "a row with an unresolvable icon override",
      {
        connectServices: ONBOARDING_CHECKLIST_DATA.connectServices,
        checklists: {
          ...ONBOARDING_CHECKLIST_DATA.checklists,
          buy_and_hold: [
            {
              base: "propertyLookup",
              title: "Add your first rental property",
              description: "Add a property",
              iconKey: "not_an_icon",
            },
          ],
        },
      },
    ],
  ])("rejects %s", (_label, payload) => {
    expect(isOnboardingChecklistData(payload)).toBe(false);
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
          from.endsWith("/data/trust-content-data") ||
          from.endsWith("/data/onboarding-verticals-data") ||
          from.endsWith("/data/cmdk-verbs-data") ||
          from.endsWith("/data/onboarding-checklist-data") ||
          from.endsWith("/pages/landing/copy") ||
          from === "@/lib/glossary" ||
          from.endsWith("/lib/glossary") ||
          (from === "./copy" &&
            path.relative(ROOT, file).startsWith("client/src/pages/landing/"))
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
    expect(read("client/src/pages/onboarding-v2.tsx")).toContain(
      "ONBOARDING_VERTICALS_URL",
    );
    expect(read("client/src/components/command-palette.tsx")).toContain(
      "usePaletteVerbs",
    );
    expect(read("client/src/lib/cmdkVerbs.ts")).toContain("PALETTE_VERBS_URL");
  });

  it("the command palette renders a VISIBLE error on verb-registry load failure, never a silently verb-less palette", () => {
    const palette = stripComments(
      read("client/src/components/command-palette.tsx"),
    );
    expect(palette).toContain("paletteVerbsError &&");
    expect(palette).toMatch(/<p\s+role="alert"/);
    expect(palette).toContain('data-testid="palette-verbs-load-error"');
    expect(read("client/src/components/getting-started-checklist.tsx")).toContain(
      "ONBOARDING_CHECKLIST_URL",
    );
  });

  it("the getting-started checklist renders a VISIBLE error on loader failure, never a vanished card", () => {
    const page = stripComments(
      read("client/src/components/getting-started-checklist.tsx"),
    );
    expect(page).toContain("useStaticData<unknown>(ONBOARDING_CHECKLIST_URL)");
    expect(page).toContain("isOnboardingChecklistData");
    expect(page).toMatch(/<p\s+role="alert"/);
    expect(page).toContain('data-testid="checklist-load-error"');
  });

  it("the onboarding wizard renders a VISIBLE error on loader failure, never a blank wizard", () => {
    const page = stripComments(read("client/src/pages/onboarding-v2.tsx"));
    expect(page).toContain(
      "useStaticData<OnboardingVerticalsData>(ONBOARDING_VERTICALS_URL)",
    );
    expect(page).toMatch(/<p role="alert"/);
    expect(page).toContain('data-testid="onboarding-verticals-load-error"');
  });

  it("the glossary consumers load the registry through the validated loader", () => {
    expect(read("client/src/lib/glossary-data.ts")).toContain("GLOSSARY_URL");
    expect(read("client/src/lib/glossary-data.ts")).toContain("isGlossaryData");
    expect(read("client/src/lib/static-data.ts")).toContain(
      'export const GLOSSARY_URL = "/glossary.json"',
    );
    expect(read("client/src/pages/glossary.tsx")).toContain("useGlossaryData()");
    expect(read("client/src/components/Glossary.tsx")).toContain(
      "useGlossaryData()",
    );
  });

  it("the /glossary page renders a VISIBLE error on loader failure, never a blank page", () => {
    const page = stripComments(read("client/src/pages/glossary.tsx"));
    expect(page).toMatch(/\{error && \(\s*<p role="alert"/);
    expect(page).toContain('data-testid="glossary-load-error"');
  });

  it("the landing page loads its copy ONCE through the validated loader", () => {
    expect(read("client/src/pages/landing.tsx")).toContain("useLandingCopy()");
    expect(read("client/src/lib/landing-copy.ts")).toContain(
      "LANDING_COPY_URL",
    );
    expect(read("client/src/lib/landing-copy.ts")).toContain("isLandingCopy");
  });

  it("the landing page renders a VISIBLE error on loader failure, never a blank page", () => {
    const page = stripComments(read("client/src/pages/landing.tsx"));
    expect(page).toMatch(/\{copyError && \(\s*<p role="alert"/);
    expect(page).toContain('data-testid="landing-load-error"');
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

// ── 4b. Landing shape guard (the #716 D-2 mandate) ────────────────────────

describe("isLandingCopy validates the served shape at the boundary", () => {
  it("accepts the real asset", () => {
    expect(isLandingCopy(LANDING_ASSET)).toBe(true);
  });

  it("rejects non-objects and empty objects", () => {
    expect(isLandingCopy(null)).toBe(false);
    expect(isLandingCopy("copy")).toBe(false);
    expect(isLandingCopy({})).toBe(false);
  });

  it("rejects a missing section", () => {
    const broken = { ...(LANDING_ASSET as object) } as Record<string, unknown>;
    delete broken.faq;
    expect(isLandingCopy(broken)).toBe(false);
  });

  it("rejects a wrong-typed field inside a section", () => {
    const broken = JSON.parse(JSON.stringify(LANDING_ASSET)) as {
      hero: { wedge: unknown };
    };
    broken.hero.wedge = 42;
    expect(isLandingCopy(broken)).toBe(false);
  });

  it("rejects a malformed nested list", () => {
    const broken = JSON.parse(JSON.stringify(LANDING_ASSET)) as {
      how: { steps: unknown };
    };
    broken.how.steps = [{ n: "one", t: "x", b: "y" }];
    expect(isLandingCopy(broken)).toBe(false);
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
  it("server/static.ts no-cache-lists all served assets", () => {
    const src = read("server/static.ts");
    for (const url of [
      "/outreach-templates.json",
      "/customer-changelog.json",
      "/help-content.json",
      "/trust-content.json",
      "/onboarding-verticals.json",
      "/landing-copy.json",
      "/palette-verbs.json",
      "/glossary.json",
      "/onboarding-checklist.json",
    ]) {
      expect(src).toContain(`"${url}"`);
    }
    expect(src).toContain("isStaticDataPath");
  });
});
