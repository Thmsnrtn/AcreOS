/**
 * Decisions door — plain-language + answerability lock (2026-07-27).
 *
 * /founder/decisions calls itself "the single most important page for
 * can-I-trust-this-system", yet it used to render raw agent codenames
 * ("sophie_csm"), raw scores ("72% conf", "87/100"), and — critically —
 * gave the Needs-you bucket NO way to answer a card: the only components
 * that could answer (SwipeDecisionCard) were unmounted dead code, so
 * shadow_promotion_request and outcome_check_in cards were unanswerable
 * anywhere in the app.
 *
 * This suite locks in the resolution as source-shape contracts (same
 * pattern as mobileNavFixedDoors.test.ts):
 *   1. Codenames only ever pass through a translation call.
 *   2. Confidence and urgency render as plain words, never raw numbers.
 *   3. Needs-you answers POST the approve route with an EXPLICIT chosen
 *      option key (a sibling change moves the server default for promotion
 *      cards from 'grant' to 'hold' — implicit defaults are forbidden).
 *   4. Granting a promotion is a two-tap confirm, restated in plain words.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { naturalConfidence } from "@/lib/trust-language";

const CLIENT = path.resolve(__dirname, "../../client/src");
const pageSrc = fs.readFileSync(path.join(CLIENT, "pages/founder-decisions.tsx"), "utf-8");
const trustSrc = fs.readFileSync(path.join(CLIENT, "lib/trust-language.ts"), "utf-8");

describe("Decisions door — agent codenames are translated, never raw", () => {
  it("never renders row.ownerAgentCodename directly as JSX", () => {
    // The raw token must not appear as a bare JSX expression…
    expect(pageSrc).not.toContain("{row.ownerAgentCodename}");
  });

  it("every rendered use of ownerAgentCodename goes through the translation helper", () => {
    // …and the only value-position use is inside the translation call.
    expect(pageSrc).toContain("agentDisplayLabel(row.ownerAgentCodename)");
    // The helper is backed by the trust-language maps, with a
    // strip-underscores fallback so a raw token can never leak.
    expect(pageSrc).toMatch(/function agentDisplayLabel[\s\S]*AGENT_ROLES\[codename\]/);
  });
});

describe("Decisions door — plain-words scores, no raw numbers", () => {
  it("confidence renders as plain words (no '% conf' literal)", () => {
    expect(pageSrc).not.toContain("% conf");
    expect(pageSrc).toContain("naturalConfidence(row.sophieConfidenceScore)");
  });

  it("urgency renders as plain words (no 'NN/100' render)", () => {
    expect(pageSrc).not.toContain("urgencyScore}/100");
    expect(pageSrc).toContain("naturalUrgency(row.urgencyScore)");
  });

  it("trust-language owns the confidence mapping and it behaves as documented", () => {
    expect(trustSrc).toContain("export function naturalConfidence");
    expect(naturalConfidence(90)).toBe("very sure");
    expect(naturalConfidence(85)).toBe("very sure");
    expect(naturalConfidence(72)).toBe("fairly sure");
    expect(naturalConfidence(60)).toBe("fairly sure");
    expect(naturalConfidence(40)).toBe("not sure");
  });

  it("severity is worded plainly but never softened — risk badge stays keyed on the raw level", () => {
    expect(pageSrc).toContain("naturalRisk(row.riskLevel)");
    expect(pageSrc).toContain("riskBadgeClass(row.riskLevel)");
  });
});

describe("Decisions door — Needs-you cards are answerable", () => {
  it("posts the decisions-inbox approve route with an EXPLICIT chosen option key", () => {
    // The approve call itself…
    expect(pageSrc).toMatch(
      /apiRequest\(\s*"POST",\s*`\/api\/founder\/intelligence\/decisions-inbox\/\$\{id\}\/approve`/,
    );
    // …always carries the explicit option key (never a bare {} that would
    // fall through to the server's default action).
    expect(pageSrc).toMatch(/chosenOption:\s*optionKey/);
  });

  it("reads the card's options from the context bundle and renders them as tap targets", () => {
    expect(pageSrc).toContain("readOptions(row.contextBundle)");
    expect(pageSrc).toContain("min-h-11");
  });
});

describe("Decisions door — promotion grants are two-tap and restated in plain words", () => {
  it("the grant tap arms first and requires a confirming second tap", () => {
    expect(pageSrc).toContain("armedOption");
    expect(pageSrc).toContain("Tap again to confirm");
    // Arming is scoped to the promotion grant specifically.
    expect(pageSrc).toMatch(/shadow_promotion_request/);
    expect(pageSrc).toMatch(/opt\.key === "grant"[\s\S]*armedOption !== opt\.key/);
  });

  it("the grant button restates the authority change in Controls-page level words", () => {
    // Same vocabulary as LEVEL_LABEL on autopilot-control.tsx.
    expect(pageSrc).toContain('"Watching only"');
    expect(pageSrc).toContain('"Drafts — you approve"');
    expect(pageSrc).toContain('"Acts — safety-checked"');
    expect(pageSrc).toContain('"Independent — safety-checked"');
    expect(pageSrc).toMatch(/Grant — \$\{domain\} moves from \$\{levelWords\(shadowPromotion\.fromLevel\)\} to \$\{levelWords\(shadowPromotion\.toLevel\)\}/);
  });

  it("the technical expander carries a plain-words promotion summary above the JSON", () => {
    expect(pageSrc).toContain("Technical details");
    expect(pageSrc).toContain("It's asking to go from");
    expect(pageSrc).toContain("decisions where you could compare");
  });
});
