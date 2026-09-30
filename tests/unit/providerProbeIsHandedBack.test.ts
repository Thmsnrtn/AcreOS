/**
 * A claimed half-open probe that makes no vendor call must be handed back
 * (audit of 92bf405). Between `breaker.shouldAllow` and `provider.lookup` the
 * registry has exits — a cache hit, a BYOK key that did not resolve — and
 * every one of them used to leave the breaker half_open with no probe in
 * flight, refusing every caller of every org.
 *
 * The population is every `return` / `continue` in that span, enumerated from
 * the source, so a new exit added without a release is the thing that fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const SRC = stripComments(
  readFileSync(resolve(__dirname, "../../server/services/providers/provider-registry.ts"), "utf8"),
);

describe("every exit between the breaker gate and the vendor call hands the probe back", () => {
  it("each return/continue after the gate (other than the denied branch) releases a claimed probe", () => {
    const gateAt = SRC.indexOf("const gate = await this.breaker.shouldAllow(provider.name);");
    const lookupAt = SRC.indexOf("await provider.lookup(", gateAt);
    expect(gateAt).toBeGreaterThan(0);
    expect(lookupAt).toBeGreaterThan(gateAt);
    const span = SRC.slice(gateAt, lookupAt);

    // The denied branch holds no probe — it is the one exit that must NOT release.
    const denied = span.match(/if \(!gate\.allowed\) \{[\s\S]*?continue;\s*\}/);
    expect(denied).not.toBeNull();
    const afterDenied = span.slice((denied!.index ?? 0) + denied![0].length);

    const exits = [...afterDenied.matchAll(/\b(return\b[^;]*;|continue;)/g)];
    // Vacuity: the cache-hit return and the unresolved-BYOK continue.
    expect(exits.length).toBeGreaterThanOrEqual(2);
    for (const e of exits) {
      const before = afterDenied.slice(Math.max(0, (e.index ?? 0) - 120), e.index);
      expect(before, `exit "${e[0]}" does not release the probe`).toMatch(
        /if \(gate\.probe\) this\.breaker\.releaseProbe\(provider\.name\);\s*$/,
      );
    }
  });
});
