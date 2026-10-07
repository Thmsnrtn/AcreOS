/**
 * Ratchet: organizations.owner_id is users.id. Matching it against
 * users.clerk_user_id (in any spelling or line layout) resolves no owner, so
 * billing mail, dunning, and revenue-protection notices silently go nowhere.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../../server");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// clerkUserId compared with something ending in ownerId / owner_id, within one
// call's arguments, in either argument order.
const BAD = [
  /clerkUserId\s*,\s*[\w.!?]*\bownerId\b/,
  /\bownerId\b[\w.!?]*\s*,\s*[\w.]*clerkUserId\b/,
  /clerk_user_id\s*=\s*\$\{[^}]*ownerId[^}]*\}/,
];
export function offending(src: string): boolean {
  const s = stripComments(src);
  return BAD.some((re) => re.test(s));
}

describe("owner id is a users.id", () => {
  const files = walk(ROOT);
  it("scans a real population", () => expect(files.length).toBeGreaterThan(300));
  it("canaries match every shape (not vacuous)", () => {
    expect(offending("eq(users.clerkUserId, org.ownerId)")).toBe(true);
    expect(offending("eq(users.clerkUserId,\n  ownerId)")).toBe(true);
    expect(offending("eq(org.ownerId, users.clerkUserId)")).toBe(true);
    expect(offending(["s", "ql`clerk_user_id = $", "{org.ownerId}`"].join(""))).toBe(true);
    expect(offending("// eq(users.clerkUserId, org.ownerId)\n")).toBe(false);
    expect(offending("eq(users.id, org.ownerId)")).toBe(false);
  });
  it("no server file compares clerk_user_id with an org owner id", () => {
    const hits = files.filter((f) => offending(fs.readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
