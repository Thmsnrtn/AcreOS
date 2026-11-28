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
 *   10. (bundle diet cure, main baeec610) the security-deposit statutory
 *      rules table: DEPOSIT_RETURN_RULES
 *      (shared/regulatory/depositReturnRules.ts, source of truth — the
 *      server and the deposit suites import it synchronously) →
 *      /deposit-return-rules.json; the rent roll's deposit clock loads
 *      it via useDepositReturnRules (client/src/lib/deposit-return-rules.ts)
 *      over the shared loader, the loaded shape is validated at the
 *      boundary (isDepositReturnRulesData), the clock computes with the
 *      module's own parameterised logic (computeDepositDeadlineFrom)
 *      over the served table — pinned equivalent to the bundled-table
 *      entry point below — and a loader failure renders a visible
 *      error line, never a silently-empty clock. Only the TABLE left
 *      the bundle; the module's logic stays shared code.
 *      Regenerate: npx tsx -e 'import {DEPOSIT_RETURN_RULES} from "./shared/regulatory/depositReturnRules";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/deposit-return-rules.json", JSON.stringify(DEPOSIT_RETURN_RULES, null, 2)+"\n")'
 *   11. (same diet cure, leg 2) the sub-processor list:
 *      SUB_PROCESSORS + SUB_PROCESSORS_LAST_UPDATED
 *      (client/src/data/sub-processors.ts, source of truth) →
 *      /sub-processors.json; /security, /legal/sub-processors and the
 *      privacy policy's Section 8 table load it via useSubProcessors
 *      (client/src/lib/sub-processors.ts) over the shared loader, the
 *      shape is validated at the boundary (isSubProcessorsData), the
 *      privacy rows are built by the module's own subProcessorRowsHtml
 *      over the loaded list (pinned byte-identical below), and a loader
 *      failure renders a visible error on all three surfaces, never a
 *      silently shorter list or legal document.
 *      Regenerate: npx tsx -e 'import {SUB_PROCESSORS, SUB_PROCESSORS_LAST_UPDATED} from "./client/src/data/sub-processors";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/sub-processors.json", JSON.stringify({lastUpdated: SUB_PROCESSORS_LAST_UPDATED, processors: SUB_PROCESSORS}, null, 2)+"\n")'
 *   12. (bundle diet BD-10) the note-tape field catalogue:
 *      NOTE_TAPE_FIELDS (shared/notes/noteTapeFields.ts, source of
 *      truth — the server validator and import services import it
 *      synchronously) → /note-tape-fields.json; the import mapping UI
 *      and the note record panels load it via useNoteTapeFields
 *      (client/src/lib/note-tape-fields.ts) over the shared loader,
 *      the shape is validated at the boundary (isNoteTapeFields), the
 *      by-key map is derived from the served array with the module's
 *      own derivation, value formatting runs through
 *      formatNoteTapeValue (pinned identical to the pre-extraction
 *      formatter below), and a loader failure renders a visible error
 *      on both surfaces, never a silently field-less mapping or
 *      unformatted values. Only the catalogue left the bundle; the
 *      module's validators and logic stay shared code.
 *      Regenerate: npx tsx -e 'import {NOTE_TAPE_FIELDS} from "./shared/notes/noteTapeFields";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/note-tape-fields.json", JSON.stringify(NOTE_TAPE_FIELDS, null, 2)+"\n")'
 *   13. (bundle diet BD-10, leg 2) the A2P 10DLC registration
 *      registry: A2P_STATUSES + A2P_SOURCE_LABELS + A2P_10DLC_STEPS
 *      (shared/sms/a2p10dlc.ts, source of truth — the server imports
 *      it synchronously) → /a2p-10dlc.json; the registration guide
 *      loads it via useA2p10dlc (client/src/lib/a2p-10dlc.ts) over
 *      the shared loader, the shape is validated at the boundary
 *      (isA2p10dlcData), and a loader failure renders a visible
 *      error, never a silently empty checklist. Only the registry
 *      data left the bundle; the module's logic stays shared code.
 *      Regenerate: npx tsx -e 'import {A2P_STATUSES, A2P_SOURCE_LABELS, A2P_10DLC_STEPS} from "./shared/sms/a2p10dlc";
 *      import fs from "node:fs"; fs.writeFileSync("client/public/a2p-10dlc.json", JSON.stringify({statuses: A2P_STATUSES, sourceLabels: A2P_SOURCE_LABELS, steps: A2P_10DLC_STEPS}, null, 2)+"\n")'
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
  A2P_10DLC_URL,
  DEPOSIT_RETURN_RULES_URL,
  NOTE_TAPE_FIELDS_URL,
  SUB_PROCESSORS_URL,
  loadStaticData,
  substituteTokens,
} from "../../client/src/lib/static-data";
import {
  DEPOSIT_RETURN_RULES,
  computeDepositDeadline,
  computeDepositDeadlineFrom,
} from "../../shared/regulatory/depositReturnRules";
import {
  isDepositReturnRulesData,
  type DepositReturnRulesData,
} from "../../client/src/lib/deposit-return-rules";
import {
  SUB_PROCESSORS,
  SUB_PROCESSORS_LAST_UPDATED,
  subProcessorRowsHtml,
} from "../../client/src/data/sub-processors";
import {
  isSubProcessorsData,
  type SubProcessorsData,
} from "../../client/src/lib/sub-processors";
import {
  NOTE_TAPE_FIELD,
  NOTE_TAPE_FIELDS,
} from "../../shared/notes/noteTapeFields";
import {
  formatNoteTapeValue,
  isNoteTapeFields,
  noteTapeFieldByKey,
} from "../../client/src/lib/note-tape-fields";
import {
  A2P_10DLC_STEPS,
  A2P_SOURCE_LABELS,
  A2P_STATUSES,
} from "../../shared/sms/a2p10dlc";
import {
  isA2p10dlcData,
  type A2p10dlcData,
} from "../../client/src/lib/a2p-10dlc";
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
const DEPOSIT_ASSET = readJson(
  "client/public/deposit-return-rules.json",
) as DepositReturnRulesData;
const SUBPROC_ASSET = readJson(
  "client/public/sub-processors.json",
) as SubProcessorsData;
const MODULE_SUBPROC_DATA: SubProcessorsData = {
  lastUpdated: SUB_PROCESSORS_LAST_UPDATED,
  processors: [...SUB_PROCESSORS],
};
const NOTE_TAPE_ASSET = readJson(
  "client/public/note-tape-fields.json",
) as typeof NOTE_TAPE_FIELDS;
const A2P_ASSET = readJson("client/public/a2p-10dlc.json") as A2p10dlcData;
const MODULE_A2P_DATA: A2p10dlcData = {
  statuses: A2P_STATUSES,
  sourceLabels: A2P_SOURCE_LABELS,
  steps: A2P_10DLC_STEPS,
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

  it("deposit-return-rules.json deep-equals DEPOSIT_RETURN_RULES", () => {
    expect(DEPOSIT_ASSET).toEqual(DEPOSIT_RETURN_RULES);
  });

  it("deposit-return-rules.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/deposit-return-rules.json")).toBe(
      JSON.stringify(DEPOSIT_RETURN_RULES, null, 2) + "\n",
    );
  });

  it("sub-processors.json deep-equals the sub-processor module data", () => {
    expect(SUBPROC_ASSET).toEqual(MODULE_SUBPROC_DATA);
  });

  it("sub-processors.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/sub-processors.json")).toBe(
      JSON.stringify(MODULE_SUBPROC_DATA, null, 2) + "\n",
    );
  });

  it("note-tape-fields.json deep-equals NOTE_TAPE_FIELDS", () => {
    expect(NOTE_TAPE_ASSET).toEqual(NOTE_TAPE_FIELDS);
  });

  it("note-tape-fields.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/note-tape-fields.json")).toBe(
      JSON.stringify(NOTE_TAPE_FIELDS, null, 2) + "\n",
    );
  });

  it("a2p-10dlc.json deep-equals the A2P registry module data", () => {
    expect(A2P_ASSET).toEqual(MODULE_A2P_DATA);
  });

  it("a2p-10dlc.json is the generator's exact output (regenerate with the header's command)", () => {
    expect(read("client/public/a2p-10dlc.json")).toBe(
      JSON.stringify(MODULE_A2P_DATA, null, 2) + "\n",
    );
  });
});

// ── 1f. Sub-processors: served list renders exactly as the module ───────

describe("the served sub-processor list renders as the module list", () => {
  it("the privacy Section 8 rows are byte-identical", () => {
    expect(subProcessorRowsHtml(SUBPROC_ASSET.processors)).toBe(
      subProcessorRowsHtml(SUB_PROCESSORS),
    );
  });

  it("the version stamp is the module's", () => {
    expect(SUBPROC_ASSET.lastUpdated).toBe(SUB_PROCESSORS_LAST_UPDATED);
  });
});

// ── 1g. Sub-processors shape guard (the #716 D-2 mandate) ───────────────

describe("isSubProcessorsData guards the loaded asset shape", () => {
  it("accepts the served asset and the module data", () => {
    expect(isSubProcessorsData(SUBPROC_ASSET)).toBe(true);
    expect(isSubProcessorsData(MODULE_SUBPROC_DATA)).toBe(true);
  });

  it("rejects the D-2 payload: a 200 with body {}", () => {
    expect(isSubProcessorsData({})).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["an empty processors list", { lastUpdated: "2026-11-25", processors: [] }],
    [
      "a row missing its evidence pointer",
      {
        lastUpdated: "2026-11-25",
        processors: [
          { vendor: "Clerk", purpose: "Auth", dataCategories: ["email"], region: "United States" },
        ],
      },
    ],
    [
      "a row with non-string data categories",
      {
        lastUpdated: "2026-11-25",
        processors: [
          {
            vendor: "Clerk",
            purpose: "Auth",
            dataCategories: [42],
            region: "United States",
            evidence: "x",
          },
        ],
      },
    ],
  ])("rejects %s", (_label, payload) => {
    expect(isSubProcessorsData(payload)).toBe(false);
  });
});

// ── 1h. Note tape: served catalogue derives and formats as the module ───

describe("the served note-tape catalogue derives and formats as the module", () => {
  const servedByKey = noteTapeFieldByKey(NOTE_TAPE_ASSET);

  it("the by-key map derived from the served asset is the module's NOTE_TAPE_FIELD", () => {
    expect(servedByKey).toEqual(NOTE_TAPE_FIELD);
  });

  it("formatNoteTapeValue over the served map matches the module map for every field and sample value", () => {
    const samples: unknown[] = [null, undefined, 0, 99, 850, 875, 8425000, "paid_off", "performing", "2025-10-25", "Jane Q Borrower"];
    for (const field of NOTE_TAPE_FIELDS) {
      for (const v of samples) {
        expect(formatNoteTapeValue(servedByKey, field.key, v)).toBe(
          formatNoteTapeValue(NOTE_TAPE_FIELD, field.key, v),
        );
      }
    }
  });

  it("the kind formatting is the pre-extraction formatting, in words", () => {
    expect(formatNoteTapeValue(servedByKey, "originalPrincipal", 8425000)).toBe("$84,250.00");
    expect(formatNoteTapeValue(servedByKey, "currentBalance", 99)).toBe("$0.99");
    expect(formatNoteTapeValue(servedByKey, "interestRate", 850)).toBe("8.5%");
    expect(formatNoteTapeValue(servedByKey, "interestRate", 800)).toBe("8%");
    expect(formatNoteTapeValue(servedByKey, "status", "paid_off")).toBe("paid off");
    expect(formatNoteTapeValue(servedByKey, "termMonths", 360)).toBe("360 months");
    expect(formatNoteTapeValue(servedByKey, "payerName", "Jane Q Borrower")).toBe("Jane Q Borrower");
    expect(formatNoteTapeValue(servedByKey, "originalPrincipal", null)).toBe("");
  });
});

// ── 1i. Note-tape shape guard (the #716 D-2 mandate) ────────────────────

describe("isNoteTapeFields guards the loaded asset shape", () => {
  it("accepts the served asset and the module catalogue", () => {
    expect(isNoteTapeFields(NOTE_TAPE_ASSET)).toBe(true);
    expect(isNoteTapeFields(NOTE_TAPE_FIELDS)).toBe(true);
  });

  it("rejects the D-2 payload: a 200 with body {}", () => {
    expect(isNoteTapeFields({})).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "fields"],
    ["an empty list", []],
    ["a field missing its label", [{ key: "status", group: "terms", kind: "status", required: true, decay: "months", aliases: [], fix: "x" }]],
    ["a field with an unknown kind", [{ key: "status", label: "Status", group: "terms", kind: "bogus", required: true, decay: "months", aliases: [], fix: "x" }]],
    ["a field with an unknown group", [{ key: "status", label: "Status", group: "bogus", kind: "status", required: true, decay: "months", aliases: [], fix: "x" }]],
    ["a field with a non-boolean required", [{ key: "status", label: "Status", group: "terms", kind: "status", required: "yes", decay: "months", aliases: [], fix: "x" }]],
    ["a field with non-string aliases", [{ key: "status", label: "Status", group: "terms", kind: "status", required: true, decay: "months", aliases: [42], fix: "x" }]],
    ["a field with an unknown decay", [{ key: "status", label: "Status", group: "terms", kind: "status", required: true, decay: "bogus", aliases: [], fix: "x" }]],
  ])("rejects %s", (_label, payload) => {
    expect(isNoteTapeFields(payload)).toBe(false);
  });
});

// ── 1j. A2P registry shape guard (the #716 D-2 mandate) ─────────────────

describe("isA2p10dlcData guards the loaded asset shape", () => {
  it("accepts the served asset and the module registry", () => {
    expect(isA2p10dlcData(A2P_ASSET)).toBe(true);
    expect(isA2p10dlcData(MODULE_A2P_DATA)).toBe(true);
  });

  it("rejects the D-2 payload: a 200 with body {}", () => {
    expect(isA2p10dlcData({})).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["empty statuses", { statuses: [], sourceLabels: A2P_SOURCE_LABELS, steps: A2P_10DLC_STEPS }],
    ["a missing self-reported label", { statuses: A2P_STATUSES, sourceLabels: { provider_api: "Read from your provider" }, steps: A2P_10DLC_STEPS }],
    ["empty steps", { statuses: A2P_STATUSES, sourceLabels: A2P_SOURCE_LABELS, steps: [] }],
    [
      "a step field with an unknown required marker",
      {
        statuses: A2P_STATUSES,
        sourceLabels: A2P_SOURCE_LABELS,
        steps: [{ id: "brand", title: "Brand", why: "w", fields: [{ attribute: "a", label: "A", required: "maybe" }] }],
      },
    ],
    [
      "a step missing its why",
      {
        statuses: A2P_STATUSES,
        sourceLabels: A2P_SOURCE_LABELS,
        steps: [{ id: "brand", title: "Brand", fields: [] }],
      },
    ],
  ])("rejects %s", (_label, payload) => {
    expect(isA2p10dlcData(payload)).toBe(false);
  });
});

// ── 1d. Deposit clock: served table computes exactly as the module ──────

describe("computeDepositDeadlineFrom over the served asset matches the bundled table", () => {
  it("agrees for every encoded state, both deduction branches", () => {
    for (const state of Object.keys(DEPOSIT_RETURN_RULES)) {
      for (const hasDeductions of [true, false]) {
        const args = { moveOutDate: "2026-11-02", state, hasDeductions };
        expect(computeDepositDeadlineFrom(DEPOSIT_ASSET, args)).toEqual(
          computeDepositDeadline(args),
        );
      }
    }
  });

  it("agrees on the refusals: unencoded state, missing state, bad date", () => {
    for (const args of [
      { moveOutDate: "2026-11-02", state: "KY", hasDeductions: true },
      { moveOutDate: "2026-11-02", state: null, hasDeductions: false },
      { moveOutDate: "2026-02-30", state: "TX", hasDeductions: true },
      { moveOutDate: null, state: "CA", hasDeductions: false },
    ]) {
      expect(computeDepositDeadlineFrom(DEPOSIT_ASSET, args)).toEqual(
        computeDepositDeadline(args),
      );
    }
  });
});

// ── 1e. Deposit rules shape guard (the #716 D-2 mandate) ────────────────

describe("isDepositReturnRulesData guards the loaded asset shape", () => {
  it("accepts the served asset and the module table", () => {
    expect(isDepositReturnRulesData(DEPOSIT_ASSET)).toBe(true);
    expect(isDepositReturnRulesData(DEPOSIT_RETURN_RULES)).toBe(true);
  });

  it("rejects the D-2 payload: a 200 with body {}", () => {
    expect(isDepositReturnRulesData({})).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "rules"],
    [
      "a rule missing its citation",
      { TX: { state: "TX", deadlineDays: 30, itemizedStatementRequired: true } },
    ],
    [
      "a rule with a non-numeric deadline",
      {
        TX: {
          state: "TX",
          deadlineDays: "30",
          itemizedStatementRequired: true,
          citation: "Tex. Prop. Code §92.103(a), §92.104(c)",
        },
      },
    ],
    [
      "a rule keyed under the wrong state",
      {
        TX: {
          state: "CA",
          deadlineDays: 21,
          itemizedStatementRequired: true,
          citation: "Cal. Civ. Code §1950.5(g)",
        },
      },
    ],
  ])("rejects %s", (_label, payload) => {
    expect(isDepositReturnRulesData(payload)).toBe(false);
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

  it("the rent roll's deposit clock loads the rules through the validated loader", () => {
    expect(DEPOSIT_RETURN_RULES_URL).toBe("/deposit-return-rules.json");
    expect(read("client/src/lib/static-data.ts")).toContain(
      'export const DEPOSIT_RETURN_RULES_URL = "/deposit-return-rules.json"',
    );
    expect(read("client/src/lib/deposit-return-rules.ts")).toContain(
      "isDepositReturnRulesData",
    );
    const page = stripComments(read("client/src/pages/rent-roll.tsx"));
    expect(page).toContain("useDepositReturnRules()");
    expect(page).toContain("computeDepositDeadlineFrom(rules, {");
    // The bundled-table entry points must NOT come back into the client:
    // they are what drags the table into the chunk.
    expect(page).not.toContain("DEPOSIT_RETURN_RULES");
    expect(page).not.toContain("computeDepositDeadline({");
    expect(page).not.toContain("getDepositReturnRule(");
  });

  it("the rent roll's deposit clock renders a VISIBLE error on loader failure, never a silently-empty clock", () => {
    const page = stripComments(read("client/src/pages/rent-roll.tsx"));
    expect(page).toContain("rulesError");
    expect(page).toMatch(/<p role="alert"/);
    expect(page).toContain('data-testid="deposit-rules-load-error"');
  });

  it("the sub-processor consumers load the list through the validated loader", () => {
    expect(SUB_PROCESSORS_URL).toBe("/sub-processors.json");
    expect(read("client/src/lib/static-data.ts")).toContain(
      'export const SUB_PROCESSORS_URL = "/sub-processors.json"',
    );
    expect(read("client/src/lib/sub-processors.ts")).toContain(
      "isSubProcessorsData",
    );
    for (const rel of [
      "client/src/pages/security.tsx",
      "client/src/pages/sub-processors.tsx",
      "client/src/pages/privacy.tsx",
    ]) {
      expect(stripComments(read(rel))).toContain("useSubProcessors()");
    }
    // The list itself must NOT come back into the client as a value
    // import — that is what dragged it into the chunks. (privacy.tsx
    // still value-imports subProcessorRowsHtml, the module's pure
    // markup builder, and runs it over the LOADED list.)
    for (const rel of [
      "client/src/pages/security.tsx",
      "client/src/pages/sub-processors.tsx",
    ]) {
      expect(stripComments(read(rel))).not.toContain("SUB_PROCESSORS");
    }
    const privacy = stripComments(read("client/src/pages/privacy.tsx"));
    expect(privacy).toContain(
      "subProcessorRowsHtml(subProcessors.processors)",
    );
    expect(privacy).not.toContain("subProcessorRowsHtml()");
  });

  it("the sub-processor consumers render a VISIBLE error on loader failure, never a silently shorter list", () => {
    const security = stripComments(read("client/src/pages/security.tsx"));
    expect(security).toMatch(/<p role="alert"/);
    expect(security).toContain(
      'data-testid="security-sub-processors-load-error"',
    );
    const list = stripComments(read("client/src/pages/sub-processors.tsx"));
    expect(list).toMatch(/<p role="alert"/);
    expect(list).toContain('data-testid="sub-processors-load-error"');
    const privacy = stripComments(read("client/src/pages/privacy.tsx"));
    expect(privacy).toMatch(/<p role="alert"/);
    expect(privacy).toContain(
      'data-testid="privacy-sub-processors-load-error"',
    );
  });

  it("the note-tape consumers load the catalogue through the validated loader", () => {
    expect(NOTE_TAPE_FIELDS_URL).toBe("/note-tape-fields.json");
    expect(read("client/src/lib/static-data.ts")).toContain(
      'export const NOTE_TAPE_FIELDS_URL = "/note-tape-fields.json"',
    );
    expect(read("client/src/lib/note-tape-fields.ts")).toContain(
      "isNoteTapeFields",
    );
    const importer = stripComments(
      read("client/src/components/notes/NoteTapeImport.tsx"),
    );
    expect(importer).toContain("useNoteTapeFields()");
    // The catalogue itself must NOT come back into the client as a
    // value import — that is what dragged it into the chunks.
    expect(importer).not.toContain("NOTE_TAPE_FIELDS");
    const panels = stripComments(
      read("client/src/components/notes/NoteRecordPanels.tsx"),
    );
    expect(panels).toContain("useNoteTapeFields()");
    expect(panels).not.toContain("NOTE_TAPE_FIELD");
  });

  it("the note-tape consumers render a VISIBLE state on loader failure or delay, never a silently field-less surface", () => {
    const importer = stripComments(
      read("client/src/components/notes/NoteTapeImport.tsx"),
    );
    expect(importer).toContain('data-testid="note-tape-fields-load-error"');
    expect(importer).toContain('data-testid="note-tape-fields-loading"');
    const panels = stripComments(
      read("client/src/components/notes/NoteRecordPanels.tsx"),
    );
    expect(panels).toContain('data-testid="note-record-fields-load-error"');
    expect(panels).toMatch(/role="alert"/);
  });

  it("the A2P guide loads the registry through the validated loader", () => {
    expect(A2P_10DLC_URL).toBe("/a2p-10dlc.json");
    expect(read("client/src/lib/static-data.ts")).toContain(
      'export const A2P_10DLC_URL = "/a2p-10dlc.json"',
    );
    expect(read("client/src/lib/a2p-10dlc.ts")).toContain("isA2p10dlcData");
    const guide = stripComments(
      read("client/src/components/growth/A2pRegistrationGuide.tsx"),
    );
    expect(guide).toContain("useA2p10dlc()");
    // The registry itself must NOT come back into the client as a
    // value import — that is what dragged it into the chunks.
    expect(guide).not.toContain("A2P_10DLC_STEPS");
    expect(guide).not.toContain("A2P_SOURCE_LABELS");
    expect(guide).not.toContain("A2P_STATUSES");
  });

  it("the A2P guide renders a VISIBLE error on loader failure, never a silently empty checklist", () => {
    const guide = stripComments(
      read("client/src/components/growth/A2pRegistrationGuide.tsx"),
    );
    expect(guide).toContain('data-testid="a2p-registry-load-error"');
    expect(guide).toMatch(/role="alert"/);
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
      "/deposit-return-rules.json",
      "/sub-processors.json",
      "/note-tape-fields.json",
      "/a2p-10dlc.json",
    ]) {
      expect(src).toContain(`"${url}"`);
    }
    expect(src).toContain("isStaticDataPath");
  });
});
