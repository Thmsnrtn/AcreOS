/**
 * A glass / modal surface never strips `position` from an absolutely or
 * fixed-positioned child.
 *
 * `.modal-surface > * { position: relative }` (and the same rule on the four
 * glass primitives) is unlayered and comes after Tailwind's utilities in
 * index.css, so on equal specificity it beat `.absolute`: every dialog's
 * top-left close button fell into flow at the BOTTOM of the dialog. Found in
 * the Fieldstone redesign's real-app screenshots (2026-10-18).
 *
 * Population: every child-lifting rule on the five surface classes.
 * Mutation probe: restore `.modal-surface > * { position: relative; … }`.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const CSS = stripComments(fs.readFileSync(path.resolve(__dirname, "../../client/src/index.css"), "utf8"));
const SURFACES = [".glass-panel", ".liquid-glass", ".liquid-glass-sm", ".liquid-glass-subtle", ".modal-surface"];

describe("surface child rules leave positioned children alone", () => {
  for (const cls of SURFACES) {
    it(cls, () => {
      const esc = cls.replace(/[.-]/g, (c) => "\\" + c);
      const rules = [...CSS.matchAll(new RegExp(`${esc}\\s*>\\s*([^{]+)\\{([^}]*)\\}`, "g"))];
      const lifting = rules.filter((r) => /position:\s*relative/.test(r[2]));
      expect(lifting.length, `${cls} child-lifting rule not found — the parser stopped reading`).toBeGreaterThan(0);
      for (const r of lifting) {
        expect(r[1], `${cls} > ${r[1].trim()} must exclude .absolute/.fixed/.sticky`).toMatch(/:not\(\.absolute\)/);
        expect(r[1]).toMatch(/:not\(\.fixed\)/);
      }
    });
  }
});
