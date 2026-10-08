// @vitest-environment jsdom
/**
 * Every select trigger has an accessible name.
 *
 * Radix renders <Select.Trigger> as `<button role="combobox">`. A combobox does
 * not take its name from its content, so the visible "All sources" inside a
 * filter select is NOT its name: with no <Label htmlFor>, wrapping <label>,
 * aria-label or aria-labelledby it is announced as an unnamed control. The
 * 2026-10 crawl measured that as axe `button-name`, CRITICAL — 130 nodes on 9
 * routes (analytics, properties, tenants, maintenance and five founder pages),
 * every one a filter select written `<SelectTrigger><SelectValue/></SelectTrigger>`.
 *
 * The fix is in client/src/components/ui/select.tsx: an unlabelled trigger
 * names itself from the value it shows (aria-labelledby → its own value span). A caller's
 * label always wins, and the fallback must never override one.
 *
 * Behavioural, not a scan: mounts the real component and runs axe's own
 * `button-name` rule. The canary mounts bare Radix and requires axe to SEE
 * the defect, so jsdom/axe losing the ability to detect it cannot read as a
 * pass. The population block asserts nothing else imports Radix Select.
 *
 * Mutation probe (must go RED): in select.tsx set `const selfName = false`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as SelectPrimitive from "@radix-ui/react-select";
import axe from "axe-core";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../client/src/components/ui/select";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
  });
}

async function unnamedButtons(): Promise<string[]> {
  const r = await axe.run(container, { runOnly: { type: "rule", values: ["button-name"] } });
  const evaluated = [...r.passes, ...r.violations, ...r.incomplete]
    .filter((x) => x.id === "button-name")
    .reduce((n, x) => n + x.nodes.length, 0);
  expect(evaluated, "axe evaluated no button for button-name").toBeGreaterThan(0);
  return r.violations.flatMap((v) => v.nodes.map((n) => n.html));
}

const trigger = () => container.querySelector<HTMLElement>('[role="combobox"]')!;

const items = (
  <SelectContent>
    <SelectItem value="all">All sources</SelectItem>
    <SelectItem value="mail">Mail</SelectItem>
  </SelectContent>
);

describe("canary — the defect is visible to this harness", () => {
  it("a bare Radix trigger with only a value inside IS unnamed to axe", async () => {
    await render(
      <SelectPrimitive.Root value="all">
        <SelectPrimitive.Trigger>
          <SelectPrimitive.Value placeholder="Source" />
        </SelectPrimitive.Trigger>
      </SelectPrimitive.Root>,
    );
    expect(
      (await unnamedButtons()).length,
      "axe no longer flags an unlabelled combobox trigger — the cases below would be vacuous",
    ).toBeGreaterThan(0);
  });
});

describe("the shared SelectTrigger is never unnamed", () => {
  it("the filter shape — no label anywhere — names itself from its own text", async () => {
    await render(
      <Select value="all">
        <SelectTrigger data-testid="filter-source">
          <SelectValue placeholder="Source" />
        </SelectTrigger>
        {items}
      </Select>,
    );
    const t = trigger();
    const by = t.getAttribute("aria-labelledby");
    expect(by, "unlabelled trigger has no fallback name").toBeTruthy();
    // It must resolve, to the value span INSIDE this trigger.
    const named = document.getElementById(by!);
    expect(named && t.contains(named), "aria-labelledby does not resolve inside the trigger").toBe(true);
    expect(named!.textContent).toBe("All sources");
    expect(await unnamedButtons()).toEqual([]);
  });

  it("a <label htmlFor> is never overridden by the fallback", async () => {
    await render(
      <div>
        <label htmlFor="status-filter">Status</label>
        <Select value="all">
          <SelectTrigger id="status-filter">
            <SelectValue />
          </SelectTrigger>
          {items}
        </Select>
      </div>,
    );
    const t = trigger();
    expect(t.id).toBe("status-filter");
    // aria-labelledby beats <label for> in name computation, so setting it here
    // would silently replace "Status" with the current value.
    expect(t.hasAttribute("aria-labelledby"), "fallback overrode a real <label>").toBe(false);
    expect(await unnamedButtons()).toEqual([]);
  });

  it("an explicit aria-label passes through untouched", async () => {
    await render(
      <Select value="all">
        <SelectTrigger aria-label="Filter by source">
          <SelectValue />
        </SelectTrigger>
        {items}
      </Select>,
    );
    const t = trigger();
    expect(t.getAttribute("aria-label")).toBe("Filter by source");
    expect(t.hasAttribute("aria-labelledby")).toBe(false);
    expect(await unnamedButtons()).toEqual([]);
  });

  it("an explicit aria-labelledby passes through untouched", async () => {
    await render(
      <div>
        <span id="lbl">Agent</span>
        <Select value="all">
          <SelectTrigger aria-labelledby="lbl">
            <SelectValue />
          </SelectTrigger>
          {items}
        </Select>
      </div>,
    );
    expect(trigger().getAttribute("aria-labelledby")).toBe("lbl");
    expect(await unnamedButtons()).toEqual([]);
  });

  it("the trigger holds the 44px touch floor on phones and coarse pointers", () => {
    // Class-level: jsdom has no layout. The crawl measured 36px triggers.
    const src = fs.readFileSync(path.resolve(__dirname, "../../client/src/components/ui/select.tsx"), "utf8");
    expect(src).toMatch(/max-sm:h-11/);
    expect(src).toMatch(/pointer-coarse:h-11/);
  });
});

describe("population — every select renders through the shared trigger", () => {
  const CLIENT_SRC = path.resolve(__dirname, "../../client/src");
  const WRAPPER = "components/ui/select.tsx";
  const files: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(f);
    }
  })(CLIENT_SRC);
  const rel = (f: string) => path.relative(CLIENT_SRC, f).split(path.sep).join("/");
  const importsOf = (f: string): string[] => {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    const out: string[] = [];
    const visit = (n: ts.Node) => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  };

  it("only the wrapper imports @radix-ui/react-select, and the app uses the wrapper", () => {
    expect(files.length).toBeGreaterThan(500);
    const direct = files.filter((f) => importsOf(f).includes("@radix-ui/react-select")).map(rel);
    expect(direct, "the parser no longer sees the wrapper's own Radix import").toContain(WRAPPER);
    expect(
      direct.filter((f) => f !== WRAPPER),
      "a module imports Radix Select directly; its trigger bypasses the name fallback",
    ).toEqual([]);
    const users = files.filter((f) => importsOf(f).includes("@/components/ui/select")).map(rel);
    // ~200 modules on 2026-10-07; far below means the parser stopped matching.
    expect(users.length).toBeGreaterThan(100);
    for (const reported of ["pages/founder/feed.tsx", "pages/founder/agent-queue.tsx", "pages/founder/feedback-inbox.tsx"]) {
      expect(users, `${reported} is a reported surface and must be in the population`).toContain(reported);
    }
  });
});
