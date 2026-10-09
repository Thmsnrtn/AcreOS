// @vitest-environment jsdom
/**
 * A tab may only claim to control a panel that exists.
 *
 * Radix's <Tabs.Trigger> always emits `aria-controls={contentId}`. Surfaces in
 * this app use <Tabs> as a segmented FILTER over one shared list and declare no
 * <TabsContent> at all — the Inbox channel/status strips and the Tasks status
 * strip — so the selected trigger pointed at an id that was not in the
 * document. axe reports that as `aria-valid-attr-value`, impact CRITICAL, and a
 * screen reader announces "controls <panel>" for a panel nobody can reach.
 *
 * The fix is in the shared component (client/src/components/ui/tabs.tsx), not
 * in the pages: <Tabs> keeps a registry of the values that have a declared
 * <TabsContent>, and a trigger whose value has none omits aria-controls.
 *
 * WHAT THIS PINS, and why it is behavioural rather than a source scan. The
 * defect is a DOM property — "every aria-controls on a selected tab resolves
 * to an element" — so the test mounts the real component and runs the real axe
 * rule over the rendered DOM. Renaming the registry, inlining it, or swapping
 * the mechanism cannot keep this green unless the property still holds.
 *
 * FALSIFICATION. The first case mounts the SAME markup through bare Radix and
 * requires axe to find the violation there. If jsdom, axe, or the rule id ever
 * stop being able to see this defect, that canary goes red instead of the real
 * cases going vacuously green.
 *
 * POPULATION. The fix only covers tabs that render through the shared wrapper.
 * The last block parses every client/src module and asserts that nothing else
 * imports @radix-ui/react-tabs (a second wrapper, or a page importing Radix
 * directly, would ship the old behaviour), with a floor on how many modules use
 * the wrapper so a parser that stops matching cannot pass over nothing.
 *
 * Mutation probe (must go RED): in tabs.tsx make TabsTrigger ignore the
 * registry (`const noPanel = false`) — the filter-shaped cases fail.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import axe from "axe-core";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../client/src/components/ui/tabs";
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

/** Runs the one axe rule this defect is filed under, and proves it ran. */
async function ariaValueViolations() {
  const r = await axe.run(container, {
    runOnly: { type: "rule", values: ["aria-valid-attr-value"] },
  });
  const evaluated = [...r.passes, ...r.violations, ...r.incomplete].filter(
    (x) => x.id === "aria-valid-attr-value",
  );
  // Vacuity: zero violations means nothing if axe found no node to check.
  const nodesChecked = evaluated.reduce((n, x) => n + x.nodes.length, 0);
  expect(nodesChecked, "axe evaluated no node for aria-valid-attr-value").toBeGreaterThan(0);
  return r.violations.flatMap((v) => v.nodes.map((n) => n.html));
}

const selectedTab = () => container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');

/** Every aria-controls on a SELECTED tab must name an element in the document. */
function danglingControls(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[role="tab"][aria-controls]')]
    .filter((t) => t.getAttribute("aria-selected") === "true")
    .filter((t) => !document.getElementById(t.getAttribute("aria-controls")!))
    .map((t) => t.outerHTML);
}

describe("canary — the defect is visible to this harness", () => {
  it("bare Radix tabs used as a filter DO violate aria-valid-attr-value", async () => {
    await render(
      <TabsPrimitive.Root value="all">
        <TabsPrimitive.List>
          <TabsPrimitive.Trigger value="all">All</TabsPrimitive.Trigger>
          <TabsPrimitive.Trigger value="open">Open</TabsPrimitive.Trigger>
        </TabsPrimitive.List>
        <ul><li>shared list</li></ul>
      </TabsPrimitive.Root>,
    );
    expect(danglingControls().length, "bare Radix no longer emits a dangling aria-controls").toBe(1);
    expect(
      (await ariaValueViolations()).length,
      "axe in jsdom cannot see a dangling aria-controls — every assertion below would be vacuous",
    ).toBeGreaterThan(0);
  });
});

describe("the shared Tabs never points a tab at a missing panel", () => {
  it("filter-shaped: no TabsContent at all (the Inbox / Tasks shape)", async () => {
    await render(
      <Tabs value="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="done">Done</TabsTrigger>
        </TabsList>
        <ul><li>shared list</li></ul>
      </Tabs>,
    );
    expect(selectedTab(), "no selected tab rendered").not.toBeNull();
    expect(danglingControls()).toEqual([]);
    expect(await ariaValueViolations()).toEqual([]);
  });

  it("two filter strips over one list (Inbox's channel + status pair)", async () => {
    await render(
      <div>
        <Tabs value="email">
          <TabsList>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="sms">SMS</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value="unread">
          <TabsList>
            <TabsTrigger value="unread">Unread</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <ul><li>shared list</li></ul>
      </div>,
    );
    expect(container.querySelectorAll('[role="tab"][aria-selected="true"]').length).toBe(2);
    expect(danglingControls()).toEqual([]);
    expect(await ariaValueViolations()).toEqual([]);
  });

  it("panel-shaped: a real panel keeps its aria-controls, and it resolves", async () => {
    await render(
      <Tabs value="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel a</TabsContent>
        <TabsContent value="b">panel b</TabsContent>
      </Tabs>,
    );
    const tab = selectedTab()!;
    const controls = tab.getAttribute("aria-controls");
    // The fix must not over-correct: stripping aria-controls from REAL tabs
    // would silence axe and lose the tab→panel relationship for every reader.
    expect(controls, "a tab with a real panel lost its aria-controls").toBeTruthy();
    const panel = document.getElementById(controls!);
    expect(panel?.getAttribute("role")).toBe("tabpanel");
    expect(panel?.textContent).toBe("panel a");
    // Inactive tabs with a declared (unmounted) panel keep theirs too.
    const other = container.querySelector('[role="tab"][aria-selected="false"]')!;
    expect(other.getAttribute("aria-controls")).toBeTruthy();
    expect(await ariaValueViolations()).toEqual([]);
  });

  it("mixed: only the values without a panel drop aria-controls", async () => {
    await render(
      <Tabs value="none">
        <TabsList>
          <TabsTrigger value="with">With</TabsTrigger>
          <TabsTrigger value="none">None</TabsTrigger>
        </TabsList>
        <TabsContent value="with">panel</TabsContent>
      </Tabs>,
    );
    const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(tabs.find((t) => t.textContent === "With")!.getAttribute("aria-controls")).toBeTruthy();
    expect(tabs.find((t) => t.textContent === "None")!.hasAttribute("aria-controls")).toBe(false);
    expect(danglingControls()).toEqual([]);
    expect(await ariaValueViolations()).toEqual([]);
  });

  it("a panel that unmounts takes its aria-controls with it", async () => {
    const View = ({ show }: { show: boolean }) => (
      <Tabs value="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        {show ? <TabsContent value="a">panel</TabsContent> : null}
      </Tabs>
    );
    await render(<View show />);
    expect(selectedTab()!.getAttribute("aria-controls")).toBeTruthy();
    await render(<View show={false} />);
    expect(selectedTab()!.hasAttribute("aria-controls")).toBe(false);
    expect(danglingControls()).toEqual([]);
  });
});

describe("population — every tab in the client renders through the shared wrapper", () => {
  const CLIENT_SRC = path.resolve(__dirname, "../../client/src");
  const WRAPPER = "components/ui/tabs.tsx";

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
    }
    return out;
  }

  /** Module specifiers a file imports, read from the parse — comments never match. */
  function importsOf(file: string): string[] {
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    const specs: string[] = [];
    const visit = (n: ts.Node) => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        specs.push(n.moduleSpecifier.text);
      } else if (
        ts.isCallExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ImportKeyword &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0])
      ) {
        specs.push(n.arguments[0].text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return specs;
  }

  const files = walk(CLIENT_SRC);
  const rel = (f: string) => path.relative(CLIENT_SRC, f).split(path.sep).join("/");

  it("only the wrapper imports @radix-ui/react-tabs", () => {
    expect(files.length, "client/src walk found almost nothing").toBeGreaterThan(500);
    const direct = files.filter((f) => importsOf(f).includes("@radix-ui/react-tabs")).map(rel);
    // Per-member vacuity: if the parser stopped seeing imports, the wrapper
    // itself would vanish from this list and "no other importer" would be free.
    expect(direct, "the import parser no longer sees the wrapper's own Radix import").toContain(WRAPPER);
    expect(
      direct.filter((f) => f !== WRAPPER),
      "a module imports Radix Tabs directly. Its triggers bypass the panel " +
        "registry and will emit aria-controls for panels that do not exist. " +
        "Import from @/components/ui/tabs instead.",
    ).toEqual([]);
  });

  it("the wrapper is what the app actually uses (population floor)", () => {
    const users = files.filter((f) =>
      importsOf(f).some((s) => s === "@/components/ui/tabs" || /(^|\/)ui\/tabs$/.test(s)),
    );
    // 64 modules on 2026-10-07. Far below that is a parser that stopped
    // matching, not a codebase that stopped using tabs.
    expect(users.length).toBeGreaterThan(40);
    expect(users.map(rel), "inbox is the reported surface and must be in the population").toContain("pages/inbox.tsx");
    expect(users.map(rel), "tasks is the reported surface and must be in the population").toContain("pages/tasks.tsx");
  });
});
