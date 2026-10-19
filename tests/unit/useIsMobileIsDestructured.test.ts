/**
 * `useIsMobile()` returns an OBJECT ({ isMobile, isTablet, isKeyboardOpen,
 * isDesktop }). Four components assigned it whole — `const isMobile =
 * useIsMobile()` — and then branched on it, and an object is always truthy:
 * every desktop got the phone layout. The visible symptom (found in the
 * Fieldstone redesign's first real-app screenshots, 2026-10-18) was the team
 * chat bubble parked over the navigation rail's "Sign Out"; DriveMode, the
 * founder dock and the sample-parcel sheet were wrong the same way.
 * TypeScript accepts it — an object in a boolean position type-checks.
 *
 * Population: every client source file. Mutation probe: restore
 * `const isMobile = useIsMobile();` in team-chat-dock.tsx.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const CLIENT = path.resolve(__dirname, "../../client/src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(f);
  }
  return out;
}

describe("useIsMobile() is destructured, never used as a boolean", () => {
  const files = walk(CLIENT);
  const callers = files.filter((f) => /\buse(IsMobile|Mobile)\(\)/.test(fs.readFileSync(f, "utf8")));

  it("reads a real population", () => {
    expect(files.length).toBeGreaterThan(600);
    expect(callers.length, "no useIsMobile() callers found — the scan broke").toBeGreaterThan(20);
  });

  it("no caller binds the whole return value to a name", () => {
    const offenders: string[] = [];
    for (const f of callers) {
      const src = stripComments(fs.readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*use(?:IsMobile|Mobile)\(\)/g)) {
        offenders.push(`${path.relative(CLIENT, f)}: const ${m[1]} = useIsMobile()`);
      }
    }
    expect(offenders, "destructure it: const { isMobile } = useIsMobile()").toEqual([]);
  });
});
