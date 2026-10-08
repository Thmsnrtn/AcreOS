/**
 * Accessibility compliance tests
 * Validates that key accessibility patterns are in place.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments as stripJsComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

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
     * EMPTY, and that is the point.
     *
     * This landed at 116 (unit 68) and was worked to zero across units 69–74.
     * A per-file register was the right shape while the debt existed — it made
     * each fix attributable and stopped a regression hiding behind a fix
     * somewhere else. At zero it becomes something stronger: an absolute, like
     * the icon-button check above.
     *
     * Do NOT re-add an entry to make a build pass. Every case has one of five
     * answers, all of them two tokens: htmlFor/id with a literal id; the same
     * with an indexed id inside a map; aria-label where there is no visible
     * label; an aria-label EACH where a row of fields shares one heading; or
     * FormControl wrapping the control itself.
     */
    const LABEL_DEBT = new Map<string, number>([]);

    const offenders = new Map<string, number>();
    /**
     * What the prop-spreading exemption above actually skipped.
     *
     * Counted, not trusted. With the register at zero, WIDENING an exemption
     * removes nothing visible and the suite stays green — two mutations proved
     * exactly that before this list existed. An exemption that cannot be seen is
     * an exemption that can grow.
     */
    const primitives: string[] = [];
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

        // A primitive under components/ui that SPREADS its props defines no
        // content — it renders whatever the caller passes, including the
        // accessible name. Putting an aria-label here would name every instance
        // identically and silently override the caller's. `SidebarInput` is the
        // only one, and the responsibility is genuinely at the call site.
        const forward = src.slice(m.index!, Math.min(src.length, m.index! + 400));
        if (rel.startsWith("components/ui/") && /\{\.\.\.props\}/.test(forward)) {
          primitives.push(`${rel}:${src.slice(0, m.index!).split("\n").length}`);
          continue;
        }

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

    expect(
      primitives.join(", "),
      "the prop-spreading-primitive exemption changed. It exists for exactly " +
        "one control — SidebarInput, which renders whatever the caller passes, " +
        "so an aria-label here would name every instance identically and " +
        "override the call site. If a second primitive genuinely needs it, add " +
        "it here deliberately; if this list grew by accident, the exemption was " +
        "widened and real inputs are now being skipped.",
    ).toBe("components/ui/sidebar.tsx:328");

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

  /**
   * `<FormControl>` must wrap the CONTROL, not a layout wrapper around it.
   *
   * It is a Radix `Slot`: it forwards `id={formItemId}`, `aria-describedby` and
   * `aria-invalid` to its **immediate child**. `<FormLabel>` emits
   * `htmlFor={formItemId}` to match. So this is correct:
   *
   *     <FormControl><Input {...field} /></FormControl>
   *
   * and this silently is not:
   *
   *     <FormControl>
   *       <div className="relative">
   *         <DollarSign … />
   *         <Input {...field} />     ← gets NO id
   *       </div>
   *     </FormControl>
   *
   * The `id` lands on the `<div>`, the label's `htmlFor` points at that `<div>`,
   * and the input has no accessible name. Fourteen sites across four files were
   * in this state; the fix moves `<FormControl>` inside the wrapper, which
   * renders identically because a Slot renders AS its child either way.
   *
   * WORTH RECORDING: the label check above EXEMPTS anything inside
   * `<FormControl>`, on the correct general ground that the framework names it.
   * All fourteen of these passed that exemption. **A gate's exemption is an
   * assumption, and this one needed its own check** — which is the same lesson
   * as the register that could not tell a caller-supplied id from a freshly
   * inserted one, arriving from the other side.
   */
  it("FormControl wraps the control itself, not a layout div around it", () => {
    const offenders: string[] = [];
    let wrappers = 0;

    // Components that legitimately receive the Slot's props: real form controls
    // and trigger elements that render one.
    const CONTROLS =
      /^(Input|Textarea|Select|SelectTrigger|Checkbox|Switch|RadioGroup|RadioGroupItem|Slider|Button|Command|Popover|PopoverTrigger|Toggle|ToggleGroup|Calendar|SearchableSelect|MultiSelect|DatePicker|PhoneInput|CurrencyInput|PropertyCombobox)$/;
    // PropertyCombobox (DEFECT-0168) forwards id, aria-describedby and
    // aria-invalid to its trigger button — pinned in
    // propertyReadsAreNotTheFirstHundred.test.ts.

    for (const file of findFiles(CLIENT_SRC, ".tsx")) {
      if (/\.test\.tsx$/.test(file)) continue;
      const src = readFileSync(file, "utf-8");
      for (const m of src.matchAll(/<FormControl>\s*\n\s*<(\w+)/g)) {
        wrappers += 1;
        if (CONTROLS.test(m[1])) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${file.slice(CLIENT_SRC.length + 1)}:${line} — <${m[1]}>`);
      }
    }

    expect(wrappers, "no <FormControl> usages found — did the form API change?")
      .toBeGreaterThan(50);

    expect(
      offenders.join("\n"),
      "<FormControl> wraps a layout element. It is a Radix Slot, so its " +
        "id/aria props land on THAT element and the FormLabel's htmlFor points " +
        "at it — the control inside keeps no accessible name. Move " +
        "<FormControl> inside the wrapper so it wraps the control directly; it " +
        "renders identically.",
    ).toBe("");
  });
});

/**
 * RULE 2 OF CLAUDE.md's ACCESSIBILITY STANDARDS, which had no gate.
 *
 *   > Every interactive element must have visible focus state
 *
 * Rules 1 (icon-button `aria-label`) and 3 (form-input label association) are
 * both absolutes above, with zero debt. Rule 2 was the one nobody checked, and
 * the obvious way to check it is WRONG IN THIS CODEBASE.
 *
 * WHY `outline-none` IS NOT THE SMELL HERE
 * ----------------------------------------
 * `client/src/index.css` carries a global safety net:
 *
 *     *:focus-visible {
 *       @apply outline-none ring-2 ring-primary/40 ring-offset-2 …;
 *     }
 *
 * **It removes the outline from EVERYTHING** and replaces it with a ring. So a
 * component writing `focus-visible:outline-none` is agreeing with a decision the
 * stylesheet already made — 241 occurrences across 154 files, and the dominant
 * form is `focus-visible:outline-none focus-visible:ring-2`, which is correct.
 * Freezing those as debt would have been a register of 241 non-defects.
 *
 * The dangerous pattern is the inverse, and it is rare: **zeroing the RING.**
 * `focus-visible:ring-0` (or `focus:ring-0`) sets `--tw-ring-shadow` to a
 * zero-width ring at higher specificity than the global rule, and the outline is
 * already gone — so the element ends up with NO focus indicator at all. A
 * keyboard user tabs into it and nothing changes on screen.
 *
 * There were exactly two, both found by measuring instead of assuming:
 *   - `comment-thread.tsx` — the comment textarea. Zeroed to get a borderless
 *     inline look; a 1px ring keeps the look and keeps the field findable.
 *   - `pax-copilot-rail.tsx` — the model-override `SelectTrigger`, same reason.
 *
 * Both fixed. This is an ABSOLUTE, like rules 1 and 3: there is no register,
 * because two occurrences is not a debt, it is a bug that was fixed.
 */
describe("every interactive element keeps a visible focus state", () => {
  /** The global rule this whole check depends on. */
  const css = readFileSync(resolve(CLIENT_SRC, "index.css"), "utf-8");

  it("the global focus-visible rule still swaps outline for a ring", () => {
    // The premise. If index.css stopped removing the outline globally, bare
    // `outline-none` in a component would become a real defect and `ring-0`
    // would become survivable — the opposite of what this file asserts. Pinning
    // the premise means the reasoning cannot quietly go stale.
    const at = css.indexOf("*:focus-visible {");
    expect(at, "the global *:focus-visible rule is gone").toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf("}", at));
    expect(body, "the global rule no longer removes the outline").toContain("outline-none");
    expect(body, "the global rule no longer supplies a ring").toMatch(/ring-\d/);
  });

  it("nothing zeroes its focus ring", () => {
    // ABSOLUTE — no register. With the outline globally removed, a zeroed ring
    // leaves an element with no focus indicator whatsoever.
    const offenders: string[] = [];
    for (const file of findFiles(CLIENT_SRC, ".tsx")) {
      if (/\.test\.tsx$/.test(file)) continue;
      const src = stripJsComments(readFileSync(file, "utf-8"));
      for (const m of src.matchAll(/focus(?:-visible)?:ring-0(?![\w-])/g)) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${file.slice(CLIENT_SRC.length + 1)}:${line}`);
      }
    }
    expect(
      offenders.join("\n"),
      "an element zeroes its focus ring. index.css removes the outline from " +
        "EVERYTHING at :focus-visible and substitutes a ring, so `ring-0` here " +
        "means no focus indicator at all — a keyboard user tabs in and nothing " +
        "changes on screen. If the ring is too heavy for the design, use " +
        "`focus-visible:ring-1` and `ring-offset-0`; do not remove it.",
    ).toBe("");
  });

  it("a component that removes the outline itself supplies its own indicator", () => {
    // The narrower version of the naive check: a class string that kills the
    // outline and mentions no focus-state styling at all. contentEditable
    // regions are the realistic case — they are focusable, they are not
    // buttons, and they are easy to style as plain text.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is not incidental. The first run of
    // this check flagged pax-artifact.tsx AFTER it had been fixed: the fix came
    // with an explanatory comment containing a backtick-quoted
    // focus:outline-none, and the scanner reads backtick strings as class
    // strings. That is the sixth time in this program that a comment describing
    // a defect has tripped the detector for that defect, which is why every
    // source scan here starts by removing them.
    const KILL = /focus(?:-visible)?:outline-none/;
    const INDICATOR =
      /focus(?:-visible)?:(?:ring-\d|ring-\[|shadow-|border-|bg-|underline|outline-\[|outline-2)/;
    const offenders: string[] = [];
    let inspected = 0;
    for (const file of findFiles(CLIENT_SRC, ".tsx")) {
      if (/\.test\.tsx$/.test(file)) continue;
      const src = stripJsComments(readFileSync(file, "utf-8"));
      for (const m of src.matchAll(/"([^"\n]{0,4000})"|`([^`]{0,4000})`/g)) {
        const cls = m[1] ?? m[2] ?? "";
        if (!KILL.test(cls)) continue;
        inspected += 1;
        if (INDICATOR.test(cls)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${file.slice(CLIENT_SRC.length + 1)}:${line}`);
      }
    }
    expect(inspected, "no focus:outline-none class strings found — did the styling change?")
      .toBeGreaterThan(100);
    expect(
      offenders.join("\n"),
      "a class string removes the focus outline and supplies no focus " +
        "indicator of its own. The global *:focus-visible ring in index.css " +
        "usually covers this, which is why it is worth being explicit: an " +
        "element that opts out of the outline should say what replaces it.",
    ).toBe("");
  });

  /**
   * The landing's "Beta" micro-label must clear WCAG AA.
   *
   * It read `var(--acr-brand, #C2531C)` on a 10% brand tint — MEASURED 3.96:1,
   * against the 4.5:1 that 10px/600 text requires. The landing carries no
   * prefers-color-scheme or [data-theme] block, so that is the only theme it
   * has; there was no dark mode to blame it on.
   *
   * It survived because the beta tier was EMPTY until the OD-5 demotions, so
   * the badge rendered zero times. Demoting twelve verticals put a failing
   * label on the public landing twelve times over — the reason this is pinned
   * rather than just fixed. Contrast is computed here, not asserted as a
   * hardcoded number, so changing either colour re-derives the verdict.
   */
  it("the landing Beta badge meets WCAG AA on its own background", () => {
    const css = readFileSync(
      resolve(CLIENT_SRC, "pages/landing/landing.css"),
      "utf-8",
    );
    const badge = css.slice(css.indexOf(".lp-positioning-chip-badge"));
    const decl = badge.slice(0, badge.indexOf("}"));

    const fgHex = decl.match(/color:\s*var\([^,]+,\s*(#[0-9A-Fa-f]{6})\)/)?.[1];
    const bgRgba = decl.match(/background:\s*var\([^,]+,\s*rgba\(([^)]+)\)\)/)?.[1];
    expect(fgHex, "could not parse the badge colour — the scan broke").toBeTruthy();
    expect(bgRgba, "could not parse the badge background — the scan broke").toBeTruthy();

    const hex = (h: string): [number, number, number] => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
    const parts = bgRgba!.split(",").map((n) => Number(n.trim()));
    const alpha = parts[3];
    // The chip sits on --acr-surface; its fallback is the light ground.
    const surface: [number, number, number] = [255, 252, 246];
    const composite = parts
      .slice(0, 3)
      .map((c, i) => Math.round(c * alpha + surface[i] * (1 - alpha))) as [number, number, number];

    const lin = (c: number) => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const lum = ([r, g, b]: [number, number, number]) =>
      0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const a = lum(hex(fgHex!));
    const b = lum(composite);
    const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

    expect(
      Number(contrast.toFixed(2)),
      `Beta badge ${fgHex} on rgba(${bgRgba}) composites to ` +
        `rgb(${composite.join(",")}) at ${contrast.toFixed(2)}:1. WCAG AA needs ` +
        "4.5:1 for 10px text. Darken the foreground token.",
    ).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * Icon-only controls are named — read from a PARSE, over every shape.
 *
 * The `size="icon"` scan above is a text search for one spelling. The 2026-10
 * axe crawl found unnamed controls it could not see, because they were not
 * spelled that way:
 *
 *   - a chevron toggle `<Button size="sm">{open ? <ChevronUp/> : <ChevronDown/>}`
 *     (marketplace bids) — icon-only, no `size="icon"`;
 *   - toolbar buttons whose label sits in `<span className="hidden md:inline">`
 *     with nothing in its place — icon-only on a phone (properties Export /
 *     Import / Fetch parcels);
 *   - the collapsed sidebar's icon links, named only by a tooltip (a tooltip is
 *     a DESCRIPTION, rendered in a portal, never a name);
 *   - and labels that were filled mechanically with the glyph's own component
 *     name: `aria-label="Clock"` on a reset-to-now button, `aria-label=
 *     "Tooltip"` on Sign out. Present, so every presence check passed; wrong,
 *     so a listener heard "Tooltip, button".
 *
 * tests/helpers/iconOnlyControls.ts walks the TypeScript AST of every client
 * module, so comments never count as a name, and models Tailwind's breakpoint
 * visibility so `hidden sm:inline` + `sm:hidden` (a short label in place of a
 * long one) is NOT flagged while `hidden md:inline` alone is.
 *
 * POPULATION: every .tsx under client/src. Floors on files, controls visited
 * and icon-only controls found, and a per-SHAPE floor so a parser that stops
 * recognising one shape fails here instead of reading as "that shape is
 * clean". Each shape also has a canary fixture below that MUST be flagged.
 */
describe("icon-only controls are named (AST walk, every shape)", () => {
  // Imported lazily so the sweep above does not pay for the TS parser twice.
  const load = () => import("../helpers/iconOnlyControls");

  const files = findFiles(CLIENT_SRC, ".tsx").filter((f) => !/\.test\.tsx$/.test(f));

  it("every icon-only control in client/src has a real accessible name", async () => {
    const { scanSource } = await load();
    let visited = 0;
    const shapes: Record<string, number> = {};
    const unnamed: string[] = [];
    const junk: string[] = [];
    const opaque: string[] = [];
    let iconOnly = 0;
    for (const file of files) {
      const rel = file.slice(CLIENT_SRC.length + 1);
      const r = scanSource(rel, readFileSync(file, "utf-8"));
      visited += r.visited;
      iconOnly += r.iconOnly.length;
      for (const c of r.iconOnly) {
        for (const s of c.shapes) shapes[s] = (shapes[s] ?? 0) + 1;
        if (!c.named) unnamed.push(`${rel}:${c.line} <${c.tag}> [${c.shapes.join(",")}]`);
        if (c.junkLabel) junk.push(`${rel}:${c.line} aria-label="${c.label}"`);
      }
      for (const c of r.opaque) opaque.push(`${rel}:${c.line}`);
    }

    // Population floors — measured 2026-10-08: 711 files, 2,453 controls
    // visited, 346 icon-only. Far below means the walk or the parser broke.
    expect(files.length, "client/src walk found almost nothing").toBeGreaterThan(600);
    expect(visited, "controls visited").toBeGreaterThan(2000);
    expect(iconOnly, "icon-only controls found").toBeGreaterThan(300);
    // Per-shape vacuity: each shape the canaries prove the walker CAN see must
    // also be present in the real code, or it is no longer being read there.
    const SHAPE_FLOORS: Record<string, number> = {
      "size-icon": 150,
      "icon-children": 80,
      "conditional-icon": 30,
      "responsive-label": 5,
      "as-child": 5,
      trigger: 5,
      link: 2,
    };
    for (const [shape, floor] of Object.entries(SHAPE_FLOORS)) {
      expect(shapes[shape] ?? 0, `shape "${shape}" — the walker stopped recognising it`).toBeGreaterThanOrEqual(floor);
    }

    expect(
      unnamed.join("\n"),
      "an icon-only control has no accessible name. Add aria-label (what it DOES, " +
        "not what the glyph is called), or an sr-only span. A tooltip is not a name.",
    ).toBe("");
    expect(
      junk.join("\n"),
      "an aria-label is the name of a component inside the control (the icon, " +
        "the Tooltip). Name the action instead.",
    ).toBe("");
    // Spread props could be carrying the name; the walker cannot read them.
    // Zero on 2026-10-08 — if this grows, check each by hand, then decide.
    expect(opaque.join("\n"), "unnamed icon-only controls whose name may arrive via {...spread}").toBe("");
  });

  /**
   * One fixture per shape the gate relies on, each hiding the defect. Every
   * one must be flagged; each NAMED twin must not. If the walker stops seeing a
   * shape, its canary goes red on its own.
   */
  const CANARIES: Array<{ shape: string; bad: string; good: string }> = [
    {
      shape: "size-icon",
      bad: `import { X } from "lucide-react"; export const A = () => <Button size="icon" onClick={() => f()}><X /></Button>;`,
      good: `import { X } from "lucide-react"; export const A = () => <Button size="icon" aria-label="Close" onClick={() => f()}><X /></Button>;`,
    },
    {
      shape: "icon-children",
      bad: `import { Trash2 } from "lucide-react"; export const A = () => <button type="button"><Trash2 className="h-4 w-4" /></button>;`,
      good: `import { Trash2 } from "lucide-react"; export const A = () => <button type="button" aria-label="Delete"><Trash2 /></button>;`,
    },
    {
      shape: "conditional-icon",
      bad: `import { ChevronUp, ChevronDown } from "lucide-react"; export const A = ({ o }) => <Button size="sm">{o ? <ChevronUp /> : <ChevronDown />}</Button>;`,
      good: `import { ChevronUp, ChevronDown } from "lucide-react"; export const A = ({ o }) => <Button size="sm" aria-label={o ? "Hide" : "Show"}>{o ? <ChevronUp /> : <ChevronDown />}</Button>;`,
    },
    {
      shape: "responsive-label",
      bad: `import { Download } from "lucide-react"; export const A = () => <Button><Download /><span className="hidden md:inline">Export</span></Button>;`,
      // A short label in place of the long one is NOT icon-only at any width.
      good: `import { Download } from "lucide-react"; export const A = () => <Button><Download /><span className="hidden md:inline">Export CSV</span><span className="md:hidden">Export</span></Button>;`,
    },
    {
      shape: "as-child",
      bad: `import { Phone } from "lucide-react"; export const A = () => <Button asChild size="sm"><a href="tel:1"><Phone /></a></Button>;`,
      // Slot merges the parent's props onto the child, so a name on either counts.
      good: `import { Phone } from "lucide-react"; export const A = () => <Button asChild size="sm" aria-label="Call"><a href="tel:1"><Phone /></a></Button>;`,
    },
    {
      shape: "trigger",
      bad: `import { MoreHorizontal } from "lucide-react"; export const A = () => <DropdownMenuTrigger><MoreHorizontal /></DropdownMenuTrigger>;`,
      good: `import { MoreHorizontal } from "lucide-react"; export const A = () => <DropdownMenuTrigger><MoreHorizontal /><span className="sr-only">More actions</span></DropdownMenuTrigger>;`,
    },
    {
      shape: "link",
      // Named only by a tooltip: the TooltipContent is a portal, not content.
      bad: `import { Home } from "lucide-react"; export const A = () => <Tooltip><TooltipTrigger asChild><Link href="/"><Home /></Link></TooltipTrigger><TooltipContent>Home</TooltipContent></Tooltip>;`,
      good: `import { Home } from "lucide-react"; export const A = () => <Tooltip><TooltipTrigger asChild><Link href="/" aria-label="Home"><Home /></Link></TooltipTrigger><TooltipContent>Home</TooltipContent></Tooltip>;`,
    },
  ];

  for (const c of CANARIES) {
    it(`canary — shape "${c.shape}" is flagged unnamed, and its named twin is not`, async () => {
      const { scanSource } = await load();
      const bad = scanSource("fixture.tsx", c.bad);
      expect(bad.iconOnly.length, `the walker did not see the ${c.shape} control at all`).toBe(1);
      expect(bad.iconOnly[0].shapes, "classified under the wrong shape").toContain(c.shape);
      expect(bad.iconOnly[0].named, `an unnamed ${c.shape} control read as named`).toBe(false);
      const good = scanSource("fixture.tsx", c.good);
      expect(good.iconOnly.every((x) => x.named), `a named ${c.shape} control read as unnamed`).toBe(true);
    });
  }

  it("canary — a comment is never a name, and a glyph's own name is junk", async () => {
    const { scanSource } = await load();
    const commented = scanSource(
      "fixture.tsx",
      `import { X } from "lucide-react"; export const A = () => <Button size="icon">{/* aria-label="Close" */}<X /></Button>;`,
    );
    expect(commented.iconOnly.map((x) => x.named)).toEqual([false]);
    const junk = scanSource(
      "fixture.tsx",
      `import { Clock } from "lucide-react"; export const A = () => <Button aria-label="Clock" title="Reset to current time" size="sm"><Clock /></Button>;`,
    );
    expect(junk.iconOnly.map((x) => x.junkLabel)).toEqual([true]);
    // ...but a label that matches its icon is not junk by itself.
    const home = scanSource(
      "fixture.tsx",
      `import { Home } from "lucide-react"; export const A = () => <Link href="/" aria-label="Home"><Home /></Link>;`,
    );
    expect(home.iconOnly.map((x) => x.junkLabel)).toEqual([false]);
    const tooltipJunk = scanSource(
      "fixture.tsx",
      `import { LogOut } from "lucide-react"; export const A = () => <button aria-label="Tooltip"><Tooltip><TooltipTrigger asChild><LogOut /></TooltipTrigger><TooltipContent>Sign out</TooltipContent></Tooltip></button>;`,
    );
    expect(tooltipJunk.iconOnly.map((x) => [x.named, x.junkLabel])).toEqual([[true, true]]);
  });
});

/**
 * Interactive primitives hold the 44px touch floor on phones AND on any coarse
 * pointer.
 *
 * The crawl's most common touch-target failure was not a page: it was the
 * shared tab trigger (32px), select trigger (36px), input (36px), toast action
 * (32px) and the button `sm` size (42px wide for a short label). Each is fixed
 * once, in its primitive, by a `max-sm:` arm (narrow viewports) and a
 * `pointer-coarse:` arm (a 768px iPad still has a finger).
 *
 * POPULATION: (1) every `size` variant of every `cva()` in components/ui —
 * enumerated from the parse, so a new size added without the floor fails;
 * (2) a registry of the non-cva primitives, each of which must be found and
 * must yield class strings (per-member vacuity).
 */
describe("interactive primitives hold the 44px touch floor", () => {
  const UI = resolve(CLIENT_SRC, "components/ui");
  const FLOOR = /^(?:min-)?h-(?:11|12|14|16|\[44px\])$/;
  const WFLOOR = /^(?:min-)?w-(?:11|12|14|16|\[44px\])$/;
  const ARMS = ["max-sm", "pointer-coarse"] as const;

  /** For a class list, which arms lack a 44px height (and width, if fixed-width). */
  function missingArms(classes: string): string[] {
    const tok = classes.split(/\s+/).filter(Boolean);
    const fixedWidth = tok.some((t) => /^w-\d+$/.test(t));
    // A base (unprefixed) 44px+ size holds the floor at every width already.
    const baseH = tok.some((t) => FLOOR.test(t));
    const baseW = tok.some((t) => WFLOOR.test(t));
    const out: string[] = [];
    for (const arm of ARMS) {
      const armTok = tok.filter((t) => t.startsWith(`${arm}:`)).map((t) => t.slice(arm.length + 1));
      if (!baseH && !armTok.some((t) => FLOOR.test(t))) out.push(`${arm} height`);
      if (fixedWidth && !baseW && !armTok.some((t) => WFLOOR.test(t))) out.push(`${arm} width`);
    }
    return out;
  }

  async function sizeVariants(file: string, src: string) {
    const ts = (await import("typescript")).default;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out: Array<{ key: string; classes: string }> = [];
    const visit = (n: import("typescript").Node) => {
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "cva") {
        const cfg = n.arguments[1];
        if (cfg && ts.isObjectLiteralExpression(cfg)) {
          const variants = cfg.properties.find((p) => p.name?.getText(sf) === "variants");
          if (variants && ts.isPropertyAssignment(variants) && ts.isObjectLiteralExpression(variants.initializer)) {
            const size = variants.initializer.properties.find((p) => p.name?.getText(sf) === "size");
            if (size && ts.isPropertyAssignment(size) && ts.isObjectLiteralExpression(size.initializer)) {
              for (const p of size.initializer.properties) {
                if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) {
                  out.push({ key: p.name.getText(sf), classes: p.initializer.text });
                }
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  /** The string literals inside one named component's declaration. */
  async function componentClasses(file: string, src: string, name: string) {
    const ts = (await import("typescript")).default;
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let decl: import("typescript").Node | undefined;
    const find = (n: import("typescript").Node) => {
      if ((ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name?.getText(sf) === name) decl = n;
      else ts.forEachChild(n, find);
    };
    find(sf);
    if (!decl) return null;
    const lits: string[] = [];
    const visit = (n: import("typescript").Node) => {
      if (ts.isStringLiteralLike(n)) lits.push(n.text);
      ts.forEachChild(n, visit);
    };
    visit(decl);
    // The class list is the literal carrying the element's display/size tokens.
    return lits.find((l) => /(^|\s)(inline-)?flex(\s|$)/.test(l)) ?? null;
  }

  it("every cva size variant in components/ui holds the floor", async () => {
    const failures: string[] = [];
    let n = 0;
    for (const f of findFiles(UI, ".tsx")) {
      for (const v of await sizeVariants(f, readFileSync(f, "utf-8"))) {
        n += 1;
        const miss = missingArms(v.classes);
        if (miss.length) failures.push(`${f.slice(UI.length + 1)} size.${v.key}: missing ${miss.join(", ")}`);
      }
    }
    // button (4) + toggle (3) + sidebar menu button (3) on 2026-10-08.
    expect(n, "cva size variants found").toBeGreaterThanOrEqual(10);
    expect(failures.join("\n"), "a size variant is under 44px on touch. Add max-sm:/pointer-coarse: min-h-11 (and min-w-11 if it is fixed-width).").toBe("");
  });

  const PRIMITIVES: Array<[file: string, component: string]> = [
    ["tabs.tsx", "TabsTrigger"],
    ["select.tsx", "SelectTrigger"],
    ["input.tsx", "Input"],
    ["toast.tsx", "ToastAction"],
  ];

  it("the registered non-cva primitives hold the floor", async () => {
    const failures: string[] = [];
    for (const [file, component] of PRIMITIVES) {
      const classes = await componentClasses(file, readFileSync(resolve(UI, file), "utf-8"), component);
      expect(classes, `${file} ${component}: declaration or its class list not found`).toBeTruthy();
      const miss = missingArms(classes!);
      if (miss.length) failures.push(`${file} ${component}: missing ${miss.join(", ")}`);
    }
    expect(failures.join("\n")).toBe("");
  });

  it("canary — the checker flags a variant or primitive without the floor", async () => {
    expect(missingArms("h-9 px-3")).toEqual(["max-sm height", "pointer-coarse height"]);
    expect(missingArms("h-9 w-9 max-sm:h-11 pointer-coarse:h-11")).toEqual(["max-sm width", "pointer-coarse width"]);
    expect(missingArms("min-h-8 max-sm:min-h-11 pointer-coarse:min-h-11")).toEqual([]);
    // A floor in a comment or on another arm does not count.
    expect(missingArms("h-8 md:min-h-11 sm:h-11")).toEqual(["max-sm height", "pointer-coarse height"]);
    const v = await sizeVariants(
      "f.tsx",
      `const x = cva("a", { variants: { size: { sm: "h-8", lg: "h-12 max-sm:h-12 pointer-coarse:h-12" } } })`,
    );
    expect(v.map((x) => [x.key, missingArms(x.classes).length > 0])).toEqual([["sm", true], ["lg", false]]);
    const c = await componentClasses(
      "f.tsx",
      `const TabsTrigger = React.forwardRef((p, r) => <T className={cn("inline-flex h-8 items-center", p.className)} />)`,
      "TabsTrigger",
    );
    expect(missingArms(c!)).toEqual(["max-sm height", "pointer-coarse height"]);
  });
});
