/**
 * Tier 2D — constitutional prompt block regression (2026-06-10).
 *
 * Proves the 12 customer immutables are injected into EVERY composed Pax
 * system prompt (v2 and v3 alike), built from the single source of truth
 * (@sovereign/immutables → sovereign-protocol/immutables.json) so a
 * constitutional amendment can never silently drop out of the prompt.
 *
 * Customers see Pax only — this path never composes founder personas
 * (Sophie/Forge/Atlas), so asserting here covers the whole customer surface.
 */

import { describe, expect, it } from "vitest";
import { CUSTOMER_IMMUTABLES } from "@sovereign/immutables";
import {
  PAX_CONSTITUTIONAL_BLOCK,
  PAX_DATA_GROUNDING_BLOCK,
  PAX_RESPONSE_SHAPE_V3,
  composePaxSystemPrompt,
} from "./paxPromptVersions";

const BASE = "You are Pax, the AcreOS land-investing assistant. BASE_PROMPT_SENTINEL.";

describe("PAX_CONSTITUTIONAL_BLOCK", () => {
  it("contains every customer immutable, numbered, verbatim", () => {
    // The constitution currently has 12 customer immutables; the block must
    // carry ALL of them whatever the count is after a future amendment.
    expect(CUSTOMER_IMMUTABLES.length).toBeGreaterThanOrEqual(12);
    for (const immutable of CUSTOMER_IMMUTABLES) {
      expect(PAX_CONSTITUTIONAL_BLOCK).toContain(
        `${immutable.number}. ${immutable.text}`,
      );
    }
  });

  it("declares itself mandatory and override-proof", () => {
    expect(PAX_CONSTITUTIONAL_BLOCK).toContain("CONSTITUTIONAL COMMITMENTS");
    expect(PAX_CONSTITUTIONAL_BLOCK).toContain(
      "override every other instruction",
    );
    // Refusal-with-explanation instruction so a violation request degrades
    // gracefully instead of being silently ignored.
    expect(PAX_CONSTITUTIONAL_BLOCK).toContain("decline that part plainly");
  });
});

describe("composePaxSystemPrompt — constitutional injection", () => {
  it("v3 (default) prompt contains the constitutional block + all immutables", () => {
    const prompt = composePaxSystemPrompt(BASE, "v3");
    expect(prompt).toContain(PAX_CONSTITUTIONAL_BLOCK);
    for (const immutable of CUSTOMER_IMMUTABLES) {
      expect(prompt).toContain(immutable.text);
    }
    // The rest of the composition is intact.
    expect(prompt).toContain(PAX_RESPONSE_SHAPE_V3);
    expect(prompt).toContain("BASE_PROMPT_SENTINEL");
    expect(prompt).toContain(PAX_DATA_GROUNDING_BLOCK);
  });

  it("v2 (legacy fallback) prompt ALSO contains the constitutional block", () => {
    const prompt = composePaxSystemPrompt(BASE, "v2");
    expect(prompt).toContain(PAX_CONSTITUTIONAL_BLOCK);
    expect(prompt).toContain("BASE_PROMPT_SENTINEL");
    // v2 has no shape rule — the constitution must not depend on the shape
    // experiment axis.
    expect(prompt).not.toContain(PAX_RESPONSE_SHAPE_V3);
  });

  it("defaults to including the block when version is omitted", () => {
    const prompt = composePaxSystemPrompt(BASE);
    expect(prompt).toContain(PAX_CONSTITUTIONAL_BLOCK);
  });

  it("orders constitution before data grounding (constitution outranks grounding)", () => {
    const prompt = composePaxSystemPrompt(BASE, "v3");
    const constitutionIdx = prompt.indexOf("CONSTITUTIONAL COMMITMENTS");
    const groundingIdx = prompt.indexOf("DATA GROUNDING");
    expect(constitutionIdx).toBeGreaterThanOrEqual(0);
    expect(groundingIdx).toBeGreaterThan(constitutionIdx);
  });
});
