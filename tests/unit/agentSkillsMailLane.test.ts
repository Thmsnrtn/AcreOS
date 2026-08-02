import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * INV-RAILS-1 regression guard (founder decision 2026-07-17). The agent-skills
 * `sendEmail` skill — which emails counterparties (its own example targets
 * seller@example.com) — omitted `purpose`, so it defaulted to the 'system' lane
 * and fronted the platform @acreos.io identity for customer deal mail. The
 * counterparty lane must be set explicitly so the send rides the org's own BYO
 * identity (or refuses) instead of the platform sender.
 *
 * Source-level assertion, matching the repo's other lane/honesty ratchets:
 * the emailService.sendEmail call inside the sendEmail skill must set
 * purpose: "counterparty".
 */
describe("agent-skills sendEmail rides the counterparty lane", () => {
  const src = readFileSync(
    resolve(__dirname, "../../server/services/agent-skills.ts"),
    "utf8",
  );

  it("sets purpose: 'counterparty' on the skill's emailService.sendEmail call", () => {
    const skillStart = src.indexOf("const sendEmailSkill");
    expect(skillStart).toBeGreaterThan(-1);
    // Scope the search to the skill definition so we don't match an unrelated call.
    const skillRegion = src.slice(skillStart, skillStart + 2500);
    expect(skillRegion).toMatch(/emailService\.sendEmail\(/);
    expect(skillRegion).toMatch(/purpose:\s*["']counterparty["']/);
  });
});
