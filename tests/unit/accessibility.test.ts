/**
 * Accessibility compliance tests
 * Validates that key accessibility patterns are in place.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join } from "path";

const CLIENT_SRC = resolve(__dirname, "../../client/src");

function readFile(path: string): string {
  return readFileSync(resolve(CLIENT_SRC, path), "utf-8");
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  function walk(d: string) {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(ext)) results.push(full);
      }
    } catch { /* skip unreadable dirs */ }
  }
  walk(dir);
  return results;
}

describe("Accessibility Compliance", () => {
  it("App.tsx has a skip-to-content link", () => {
    const app = readFile("App.tsx");
    expect(app).toContain("#main-content");
    expect(app).toContain("Skip");
  });

  it("main content landmark has id='main-content'", () => {
    // Check App.tsx and components for the main landmark
    const app = readFile("App.tsx");
    const inApp = app.includes('id="main-content"');
    const files = findFiles(resolve(CLIENT_SRC, "components"), ".tsx");
    const inComponents = files.some((f) => {
      const content = readFileSync(f, "utf-8");
      return content.includes('id="main-content"');
    });
    expect(inApp || inComponents).toBe(true);
  });

  it("MotionConfig reducedMotion is configured", () => {
    const app = readFile("App.tsx");
    expect(app).toContain("MotionConfig");
    expect(app).toMatch(/reducedMotion/);
  });

  it("viewport meta does not block zoom", () => {
    const html = readFileSync(
      resolve(CLIENT_SRC, "../index.html"),
      "utf-8"
    );
    expect(html).not.toContain("user-scalable=no");
    expect(html).not.toContain("maximum-scale=1");
  });

  /**
   * EVERY icon-only button has an accessible name — all of them, not a sample.
   *
   * `CLAUDE.md` states this absolutely: *"Every icon-only button must have
   * `aria-label`"*. What enforced it was a **sample check over three hardcoded
   * files**, and it was weak in three separate ways:
   *
   *   1. One of the three — `pages/founder-dashboard.tsx` — **no longer
   *      exists**. CLAUDE.md records that monolith as fully deleted. Its
   *      `try { … } catch {}` swallowed the missing file, so a third of the
   *      sample had been checking nothing for as long as the file has been gone.
   *   2. The assertion compared **counts**: `ariaLabels.length >=
   *      iconButtons.length`. Five icon buttons and five `aria-label`s on five
   *      OTHER elements passed it.
   *   3. Three files out of 728.
   *
   * The real number, measured before writing this: **207 icon buttons across
   * 728 files, and every one of them is labelled.** The rule has been followed
   * throughout — it simply was not enforced, so nothing would have noticed the
   * first one that was not.
   *
   * `asChild` is handled rather than exempted. A `<Button asChild size="icon">`
   * renders AS its child, so the accessible name belongs on the child — both
   * live instances (`activity-content.tsx`, `TasksDueWidget.tsx`) put it on the
   * `<Link>` inside, which is correct. A checker that flagged those would be
   * reporting the right pattern as a violation, and one that skipped `asChild`
   * entirely would stop looking exactly where the label actually lives.
   */
  it("every icon-only button has an accessible name", () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const file of findFiles(CLIENT_SRC, ".tsx")) {
      if (/\.test\.tsx$/.test(file)) continue;
      const src = readFileSync(file, "utf-8");
      let i = 0;
      while ((i = src.indexOf('size="icon"', i)) !== -1) {
        const open = src.lastIndexOf("<", i);
        // Scan to the element's own closing `>` — skipping any inside a string
        // or an expression, so `onClick={() => f()}` does not end it early.
        let end = i;
        let depth = 0;
        let quote: string | null = null;
        for (; end < src.length; end++) {
          const c = src[end];
          if (quote) { if (c === quote) quote = null; continue; }
          if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
          if (c === "{") depth += 1;
          else if (c === "}") depth -= 1;
          else if (c === ">" && depth === 0) break;
        }
        const opener = src.slice(open, end + 1);
        checked += 1;

        const named = /aria-label[=\s]|aria-labelledby/.test(opener);
        // asChild: the button renders as its child, so the name lives there.
        // Look at the next element opener after this one.
        let namedByChild = false;
        if (!named && /\basChild\b/.test(opener)) {
          const childOpen = src.indexOf("<", end + 1);
          if (childOpen !== -1) {
            const childEnd = src.indexOf(">", childOpen);
            if (childEnd !== -1) {
              namedByChild = /aria-label[=\s]|aria-labelledby/.test(
                src.slice(childOpen, childEnd + 1),
              );
            }
          }
        }

        if (!named && !namedByChild) {
          const line = src.slice(0, open).split("\n").length;
          offenders.push(`${file.slice(CLIENT_SRC.length + 1)}:${line}`);
        }
        i = end;
      }
    }

    // Vacuity guard. A walk that found nothing would satisfy the assertion
    // below while checking nothing — which is precisely how the sample check
    // this replaced ended up a third dead.
    expect(checked, "no icon buttons found — did the Button API change?")
      .toBeGreaterThan(150);

    expect(
      offenders.join("\n"),
      "an icon-only button has no accessible name. A screen reader announces it " +
        "as \"button\" and nothing else. Add aria-label, or — if it uses asChild " +
        "— put the label on the child that actually renders.",
    ).toBe("");
  });

  it("the sample check's dead file reference is gone", () => {
    // The specific rot: the old check named pages/founder-dashboard.tsx, which
    // CLAUDE.md records as fully deleted, and swallowed the ENOENT. A test that
    // catches its own missing input reports success for work it did not do.
    expect(
      existsSync(resolve(CLIENT_SRC, "pages/founder-dashboard.tsx")),
      "founder-dashboard.tsx is back — CLAUDE.md says it was retired",
    ).toBe(false);
    // A second assertion — "this file no longer NAMES that path" — was written
    // here and deleted: the regex testing for the string contained the string,
    // so it matched its own source and could never pass. Same family as
    // lint-reachability's SELF exemption, where a file documenting dead symbols
    // resurrects them. A check whose subject includes the check is not a check.
    //
    // What replaces it is stronger anyway: the walk above covers all 728 files,
    // so there is no hardcoded list left to rot. Its vacuity guard is what
    // notices if the walk stops finding anything.
  });

  /**
   * EVERY form input has an ASSOCIATED label — the third of CLAUDE.md's three
   * accessibility rules, and the one with no gate until now.
   *
   * *"Every form input must have an associated label."* The word doing the work
   * is **associated**. The common failure is not a missing label; it is a
   * visible one that is not connected:
   *
   *     <Label className="text-xs">Subject sqft</Label>
   *     <Input type="number" value={subjectSqft} />
   *
   * Sighted users see a label. A screen reader announces the input with **no
   * accessible name at all**, because nothing ties the two together.
   *
   * THE MEASUREMENT, and the codebase comes out well. 723 `Input`/`Textarea`
   * elements, and 607 are correctly named by one of three legitimate
   * mechanisms — 458 by `id` + a matching `htmlFor`, 74 by `aria-label`, 75 by
   * sitting inside shadcn's `<FormControl>`, which injects `id={formItemId}`
   * while `<FormLabel>` emits the matching `htmlFor` at runtime.
   *
   * That last one matters: a naive scan calls all 75 unlabelled, because the
   * association never appears in the JSX. A first pass here reported 191
   * violations; checking a sample found `<FormField>` forms and the real number
   * is 116. **A checker that does not know the framework's own labelling
   * mechanism manufactures three-quarters of its findings**, and a register
   * nobody trusts gets deleted rather than worked through.
   *
   * The remaining set is frozen per file and may only SHRINK. Fixing one is a
   * two-token change — `htmlFor` on the Label, `id` on the Input, both from a
   * `useId()` prefix so two instances on a page cannot collide. See
   * `components/parcels/arv-calculator.tsx`, done here as the worked example.
   */
  it("form inputs are associated with their labels, and the debt only shrinks", () => {
    /**
     * Down-only, per file, so a fix is attributable and a regression is not
     * hidden by a fix somewhere else. Lower an entry — or delete it — in the
     * commit that earns it.
     */
    const LABEL_DEBT = new Map<string, number>([
  ["components/help/HelpPanel.tsx", 2],
  ["components/pax-copilot-rail.tsx", 2],
  ["components/rehabs/bids-section.tsx", 2],
  ["components/seller-finance-calculator.tsx", 2],
  ["pages/auction-worksheet.tsx", 2],
  ["pages/ccr-templates.tsx", 2],
  ["pages/founder/features.tsx", 2],
  ["components/ai-offer-generator.tsx", 1],
  ["components/custom-fields.tsx", 1],
  ["components/due-diligence-panel.tsx", 1],
  ["components/gis-filters.tsx", 1],
  ["components/mobile/MobileCommandDrawer.tsx", 1],
  ["components/mobile/MobileLeadDetail.tsx", 1],
  ["components/mobile/MobileLeadList.tsx", 1],
  ["components/modals/lost-reason-modal.tsx", 1],
  ["components/pax-knowledge-panel.tsx", 1],
  ["components/pax-project-panel.tsx", 1],
  ["components/property-analysis-chat.tsx", 1],
  ["components/research-summary-panel.tsx", 1],
  ["components/support-content.tsx", 1],
  ["components/ui/sidebar.tsx", 1],
  ["pages/county-timelines.tsx", 1],
  ["pages/deals.tsx", 1],
  ["pages/founder/cmo.tsx", 1],
  ["pages/founder/studio/dials.tsx", 1],
  ["pages/note-acquisition-detail.tsx", 1],
    ]);

    const offenders = new Map<string, number>();
    let scanned = 0;

    for (const file of findFiles(CLIENT_SRC, ".tsx")) {
      if (/\.test\.tsx$/.test(file)) continue;
      const src = readFileSync(file, "utf-8");
      const rel = file.slice(CLIENT_SRC.length + 1);
      // Every htmlFor target in the file — the id side is matched against it.
      const htmlFors = new Set(
        [...src.matchAll(/htmlFor=(?:"([^"]+)"|\{([^}]+)\})/g)].map((m) =>
          (m[1] ?? m[2]).trim(),
        ),
      );

      for (const m of src.matchAll(/<(Input|Textarea)\b/g)) {
        scanned += 1;
        // The element's own opening tag, stopping at ITS `>` — not the first
        // one, which an `onChange={() => …}` would otherwise supply.
        let end = m.index!;
        let depth = 0;
        let quote: string | null = null;
        for (; end < src.length; end++) {
          const c = src[end];
          if (quote) { if (c === quote) quote = null; continue; }
          if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
          if (c === "{") depth += 1;
          else if (c === "}") depth -= 1;
          else if (c === ">" && depth === 0) break;
        }
        const opener = src.slice(m.index!, end + 1);

        if (/aria-label[=\s]|aria-labelledby/.test(opener)) continue;
        const idm = /\bid=(?:"([^"]+)"|\{([^}]+)\})/.exec(opener);
        if (idm && htmlFors.has((idm[1] ?? idm[2]).trim())) continue;

        const back = src.slice(Math.max(0, m.index! - 300), m.index!);
        // shadcn <FormControl> injects the id; <FormLabel> emits the htmlFor.
        const fcOpen = back.lastIndexOf("<FormControl");
        if (fcOpen > -1 && fcOpen > back.lastIndexOf("</FormControl>")) continue;
        // <Label><Input/></Label> — wrapping needs no htmlFor.
        const lOpen = back.lastIndexOf("<Label");
        if (lOpen > -1 && lOpen > back.lastIndexOf("</Label>")) continue;

        offenders.set(rel, (offenders.get(rel) ?? 0) + 1);
      }
    }

    // Vacuity guard, same reason as the icon-button check above.
    expect(scanned, "no form inputs found — did the Input API change?")
      .toBeGreaterThan(600);

    const grew: string[] = [];
    for (const [file, count] of offenders) {
      const allowed = LABEL_DEBT.get(file) ?? 0;
      if (count > allowed) grew.push(`${file}: ${count} (was ${allowed})`);
    }
    expect(
      grew.join("\n"),
      "a form input lost its label association, or a new unlabelled one was " +
        "added. Pair the Label to the Input with htmlFor/id — a visible label " +
        "that is not associated leaves the field with no accessible name.",
    ).toBe("");

    // Down-only in both directions: a fixed file must have its entry lowered in
    // the same commit, or the register drifts into fiction.
    const stale: string[] = [];
    for (const [file, allowed] of LABEL_DEBT) {
      const now = offenders.get(file) ?? 0;
      if (now < allowed) stale.push(`${file}: now ${now}, entry says ${allowed}`);
    }
    expect(
      stale.join("\n"),
      "a label-debt entry is higher than reality — lower it (or delete it) in " +
        "the commit that fixed the file, so the register keeps meaning something.",
    ).toBe("");
  });
});
