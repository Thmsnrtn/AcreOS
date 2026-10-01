/**
 * Roadmap W10.1 (empty-on-failure) — the "since you were away" watermark moves
 * only on a read that happened.
 *
 * The Pax rail turned a failed read of pending task results into [] and then
 * advanced `pax-last-seen` anyway, so results finished while the read failed
 * were never shown. The watermark is now written inside the success path.
 * Source-level: the rail is too large to mount for one effect; comments are
 * stripped so the explanation of the fix cannot satisfy the pin.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";

const src = stripComments(readFileSync("client/src/components/pax-copilot-rail.tsx", "utf8"));

describe("pax-last-seen moves only after a successful read", () => {
  it("the watermark write sits in the success path of the pending-results read", () => {
    const at = src.indexOf("/api/ai/scheduled-tasks/pending-results");
    expect(at, "the pending-results read moved").toBeGreaterThan(-1);
    const chain = src.slice(at, src.indexOf(".catch(", at));
    expect(chain).toMatch(/okOrThrow/);
    expect(chain).toMatch(/localStorage\.setItem\("pax-last-seen"/);
    // and nowhere after the catch, in the same effect
    const afterCatch = src.slice(src.indexOf(".catch(", at), src.indexOf("}, [isOpen]);", at));
    expect(afterCatch).not.toMatch(/localStorage\.setItem\("pax-last-seen"/);
  });
});
