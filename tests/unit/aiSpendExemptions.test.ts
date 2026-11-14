/**
 * P1-5 / I-5 R2 — the metering exemptions are a NAMED decision, not
 * silence. Pins the registry in server/services/aiSpendExemptions.ts to
 * reality in both directions:
 *   - every exempt site exists and carries the exemption marker naming
 *     its key (a reader at the call site can find the decision);
 *   - every still-baselined Whisper/DALL·E file in the gateway ratchet
 *     is covered by an exemption entry (no unmetered site is unnamed);
 *   - the metered embedding files are NOT exempt (they left the
 *     baseline by being metered, not by being excused).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { AI_SPEND_EXEMPTIONS, AI_SPEND_EXEMPTION_MARKER } from "../../server/services/aiSpendExemptions";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("aiSpendExemptions — the named R2 exemptions", () => {
  it("every exemption names a reason and a revisit trigger (a decision, not a shrug)", () => {
    expect(AI_SPEND_EXEMPTIONS.length).toBeGreaterThan(0);
    for (const ex of AI_SPEND_EXEMPTIONS) {
      expect(ex.reason.length, ex.key).toBeGreaterThan(40);
      expect(ex.revisitWhen.length, ex.key).toBeGreaterThan(20);
      expect(ex.sites.length, ex.key).toBeGreaterThan(0);
    }
  });

  it("every exempt site exists and carries the marker naming its key", () => {
    for (const ex of AI_SPEND_EXEMPTIONS) {
      for (const site of ex.sites) {
        const text = read(site);
        expect(text, `${site} missing`).toBeTruthy();
        expect(text, `${site} carries no exemption marker`).toContain(AI_SPEND_EXEMPTION_MARKER);
        expect(text, `${site} marker does not name ${ex.key}`).toContain(ex.key);
      }
    }
  });

  it("the gateway ratchet's remaining audio/image baselines are exactly the exempt sites", () => {
    const gateway = read("tests/unit/modelCallsGoThroughTheGateway.test.ts");
    const exemptSites = new Set(AI_SPEND_EXEMPTIONS.flatMap((e) => [...e.sites]));
    for (const site of exemptSites) {
      expect(gateway, `${site} is exempt but no longer baselined — remove the stale exemption`).toContain(`"${site}"`);
    }
    // And the converse: the baselined audio/image files are all exempt-named.
    for (const f of ["server/services/voiceCallAI.ts", "server/routes-ai.ts", "server/routes-field-scout.ts", "server/services/adCreativeService.ts"]) {
      expect(exemptSites.has(f), `${f} is baselined but NOT named in the exemption registry`).toBe(true);
    }
  });

  it("embeddings are metered, not exempt", () => {
    const exemptSites = new Set(AI_SPEND_EXEMPTIONS.flatMap((e) => [...e.sites]));
    expect(exemptSites.has("server/services/embeddingClient.ts")).toBe(false);
    expect(exemptSites.has("server/services/dealPatternCloning.ts")).toBe(false);
    expect(read("server/services/embeddingClient.ts")).toContain("meteredEmbeddingsCreate");
    expect(read("server/services/dealPatternCloning.ts")).toContain("meteredEmbeddingsCreate");
  });
});
