/**
 * Founder user-id resolution is LAZY (PR #529 D6).
 *
 * `isFounderUserId` used to read a Set frozen from FOUNDER_USER_IDS at
 * module first import. Which value the gate honoured then depended on
 * import order: a consumer that set the env after the module had loaded
 * (under vitest's shared process env, whichever test file's module-scope
 * assignment won the race) silently got the wrong answer — the seller-
 * finance gate's founder threshold release flaked exactly this way.
 *
 * This suite pins the cure: the id set is re-read from the env on every
 * call. The module is imported statically at the top of THIS file, before
 * any of the env values below are assigned, so every assertion here is an
 * env-set-after-import observation by construction. Test files run in
 * isolated fork processes (pool: "forks"), so mutating the env inside this
 * file cannot race another file; the original value is restored in
 * afterAll regardless.
 */

import { afterAll, describe, expect, it } from "vitest";
import { isFounderUserId } from "../../server/services/founder";

const ORIGINAL = process.env.FOUNDER_USER_IDS;

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.FOUNDER_USER_IDS;
  else process.env.FOUNDER_USER_IDS = ORIGINAL;
});

describe("isFounderUserId resolves FOUNDER_USER_IDS lazily, per call", () => {
  it("honours an id assigned to the env after the module was imported", () => {
    process.env.FOUNDER_USER_IDS = "lazy-founder-a";
    expect(isFounderUserId("lazy-founder-a")).toBe(true);
    expect(isFounderUserId("lazy-founder-b")).toBe(false);
  });

  it("stops honouring an id once it is removed from the env", () => {
    process.env.FOUNDER_USER_IDS = "lazy-founder-a";
    expect(isFounderUserId("lazy-founder-a")).toBe(true);
    process.env.FOUNDER_USER_IDS = "someone-else";
    expect(isFounderUserId("lazy-founder-a")).toBe(false);
    expect(isFounderUserId("someone-else")).toBe(true);
  });

  it("honours nobody when the env is unset", () => {
    delete process.env.FOUNDER_USER_IDS;
    expect(isFounderUserId("lazy-founder-a")).toBe(false);
    expect(isFounderUserId("someone-else")).toBe(false);
  });

  it("keeps the frozen parse's semantics: comma-split, trimmed, empties dropped", () => {
    process.env.FOUNDER_USER_IDS = "  lazy-founder-a ,, lazy-founder-b ,";
    expect(isFounderUserId("lazy-founder-a")).toBe(true);
    expect(isFounderUserId("lazy-founder-b")).toBe(true);
    expect(isFounderUserId("")).toBe(false);
    expect(isFounderUserId(" lazy-founder-a")).toBe(false);
    expect(isFounderUserId(undefined)).toBe(false);
    expect(isFounderUserId(null)).toBe(false);
  });
});
