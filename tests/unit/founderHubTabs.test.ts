/**
 * Founder hub tabs are URL-CONTROLLED — fleet-6 verifier catch (F1 slice 3).
 *
 * Both consolidation hubs (Controls at /founder/autopilot/control, telemetry
 * at /founder/admin/telemetry) are Radix Tabs pages whose tabs are deep-linked
 * as `?tab=` from the command palette, the sidebar overflow, founder home, and
 * legacy-route redirects. An UNCONTROLLED `<Tabs defaultValue=…>` reads the
 * URL only at mount, so navigating to a sibling tab of the SAME pathname
 * (palette → "Recovery console" while already on the hub) changed the URL and
 * visibly did nothing. The hubs must stay controlled BOTH ways: the URL
 * drives `value`, and a manual tab click rewrites the URL via onValueChange —
 * so the visible tab and the address bar can never disagree.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

const HUBS: Array<{ file: string; basePath: string; defaultTab: string }> = [
  {
    file: "client/src/pages/founder/autopilot-control.tsx",
    basePath: "/founder/autopilot/control",
    defaultTab: "control",
  },
  {
    file: "client/src/pages/founder/admin/telemetry.tsx",
    basePath: "/founder/admin/telemetry",
    defaultTab: "observatory",
  },
];

describe("founder consolidation hubs — tabs controlled by the URL, both directions", () => {
  for (const hub of HUBS) {
    it(`${hub.basePath} drives its Tabs from ?tab= and writes tab clicks back to the URL`, () => {
      const src = read(hub.file);

      // Controlled: value comes from the URL on every render, not just mount.
      expect(src).toMatch(/<Tabs\s[^>]*value=\{tab\}/);
      expect(src).toMatch(/onValueChange=/);
      // The uncontrolled form must not come back on the page-level hub.
      expect(src).not.toMatch(/<Tabs\s[^>]*defaultValue=/);

      // The URL rewrite targets THIS hub's own pathname (replace, no history
      // spam), and the default tab keeps a clean URL with no querystring.
      expect(src).toContain(`${hub.basePath}?tab=`);
      expect(src).toMatch(/\{\s*replace:\s*true,?\s*\}/);
      expect(src).toContain(`"${hub.defaultTab}"`);

      // Still URL-driven: the tab derives from useSearch, so palette links,
      // redirects, and back/forward all land on the right tab.
      expect(src).toContain("useSearch()");
      expect(src).toMatch(/new URLSearchParams\(search\)\.get\("tab"\)/);
    });
  }
});
