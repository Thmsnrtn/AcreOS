// @vitest-environment jsdom
/**
 * Settings → Pax page — the client half of AUTONOMY_SPEC.md §3a (wave 1 D).
 *
 * WHAT THIS PROVES, and how each claim is falsified:
 *
 *   1. "What Pause stops" is rendered FROM `UNATTENDED_PATHS` — not from a
 *      list typed on the page. The registry is mocked with one extra
 *      member (`probe_registry_row`); the page must render it. An inline
 *      list, however faithful a copy, cannot. (Probe: type the list inline.)
 *   2. The stance labels and sentences come from the glossary: the rendered
 *      text equals `PAX_STANCE_COPY`, AND the page source carries no inline
 *      literal of either label. (Probe: type "Ask before sending" inline.)
 *   3. True zeros render as zeros — every "right now" / "runs on its own"
 *      number is printed as `0`, never hidden or dashed. (Probe: `n || "—"`.)
 *   4. A member (canChangeStance:false) reads "Ask an owner to change this"
 *      and the stance control + org switches are disabled. (Probe: drop the
 *      gating.)
 *   5. Pause asks only "until when" and POSTs the chosen key; a paused org
 *      shows the glossary status line with the holder's name; a refused
 *      controls read renders an error with retry and NO stance.
 *   6. Scheduled-prompt skips render neutral, never "Error"; the row's
 *      Pause PATCHes the real route (the old tab POSTed a /toggle that did
 *      not exist).
 *   7. Source contracts for the deletions this agent owns, and the two
 *      cadences the page prints are pinned to the job roster.
 *
 * No @testing-library (not in devDeps) — react-dom/client + act, the
 * statementsPanel / privacyRights pattern. Mock boundary: `apiRequest`,
 * `useToast`, `PageShell`, and the registry module for the probe row.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const PAGE_REL = "client/src/pages/settings/pax-controls.tsx";
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ── Mocks (hoisted; consts below are only read when the factories run) ────

/** Injected into the registry: the page must render it or it is not reading the registry. */
const PROBE_PATH = {
  id: "probe_registry_row",
  label: "Probe row from the registry",
  file: "server/probe.ts",
  fn: "probe",
  stance: { ask_before_sending: "runs", ask_before_everything: "runs" },
  whilePaused: "held until the pause lifts",
  pauseStops: true,
  pausedReason: "probe",
  switch: null,
  customerVisible: true,
};

vi.mock("@shared/pax-controls", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../shared/pax-controls")>();
  return { ...mod, UNATTENDED_PATHS: [...mod.UNATTENDED_PATHS, PROBE_PATH] };
});

vi.mock("@/components/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "page-shell-stub" }, children),
}));

const toasts: Array<{ title?: string; description?: string; variant?: string }> = [];
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: { title?: string; description?: string; variant?: string }) => { toasts.push(t); } }),
}));

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return {
    apiRequest,
    queryClient: new QC({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
  };
});

const { PaxControls } = await import("../../client/src/pages/settings/pax-controls");
const { queryClient } = await import("../../client/src/lib/queryClient");
const { UNATTENDED_PATHS, OFFERED_STANCES } = await import("../../shared/pax-controls");
const { PAX_STANCE_COPY, PAX_PAUSE_COPY, PAX_PAGE_COPY, PAX_FIXED_RULES, PAX_LABELS } = await import(
  "../../shared/pax-glossary"
);

// ── Fixtures ───────────────────────────────────────────────────────────────

type Controls = Record<string, unknown>;

function controls(overrides: Record<string, unknown> = {}): Controls {
  return {
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    stance: "ask_before_sending",
    canChangeStance: true,
    canResume: true,
    switches: { leadScoring: true, borrowerReminders: true, inboxDrafts: true },
    rightNow: { waiting: 0, changedTodayOnItsOwn: 0, rulesRunning: { workflows: 0, sequences: 0, scheduledPrompts: 0 } },
    runsOnItsOwn: {
      workflows: { active: 0, live: 0, lastRanAt: null },
      sequences: { activeEnrollments: 0, lastSendAt: null },
      scheduledPrompts: [],
      leadScoring: { lastRanAt: null, rescoredToday: 0 },
      borrowerReminders: { waiting: 0 },
      fixedRules: { emailsUsedToday: 0, emailLimit: 50, textsUsedToday: 0, textLimit: 20 },
    },
    timezone: "America/Chicago",
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Route the mock by (method, url). Each call gets a FRESH Response (bodies are one-shot). */
function serve(current: () => Controls, extra?: (method: string, url: string, body?: unknown) => Response | undefined) {
  apiRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
    const handled = extra?.(method, url, body);
    if (handled) return handled;
    if (method === "GET" && url === "/api/pax/controls") return json(current());
    if (method === "GET" && url.startsWith("/api/pax/receipts")) return json({ items: [], nextCursor: null });
    if (method === "GET" && url === "/api/byok") return json({ channels: [] });
    if (method === "GET" && url === "/api/mailbox") return json({ mailboxes: [] });
    throw new Error(`unexpected ${method} ${url}`);
  });
}

// ── Harness ────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount() {
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(PaxControls)));
  });
  await flush();
}

const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
const qq = (sel: string) => Array.from(container.querySelectorAll(sel)) as HTMLElement[];
const text = (sel: string) => q(sel)?.textContent ?? "";

async function click(el: HTMLElement | null) {
  expect(el, "element to click").not.toBeNull();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

beforeEach(() => {
  toasts.length = 0;
  apiRequest.mockReset();
  queryClient.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

// ── 1. What Pause stops — from the registry ────────────────────────────────

describe("what Pause stops is rendered from UNATTENDED_PATHS", () => {
  it("renders the probe row the test injected into the registry", async () => {
    serve(() => controls());
    await mount();
    const probe = q('[data-testid="pause-stops-probe_registry_row"]');
    expect(probe, "the page did not render the injected registry row — it is not reading UNATTENDED_PATHS").not.toBeNull();
    expect(probe!.textContent).toContain(PROBE_PATH.label);
    expect(probe!.textContent).toContain(PROBE_PATH.whilePaused);
  });

  it("renders every customer-visible member (stops vs keeps) and none of the hidden ones", async () => {
    serve(() => controls());
    await mount();
    let stops = 0;
    let keeps = 0;
    for (const p of UNATTENDED_PATHS) {
      const stopEl = q(`[data-testid="pause-stops-${p.id}"]`);
      const keepEl = q(`[data-testid="pause-keeps-${p.id}"]`);
      if (!p.customerVisible) {
        expect(stopEl, `${p.id} is founder-only and must not render`).toBeNull();
        expect(keepEl, `${p.id} is founder-only and must not render`).toBeNull();
        continue;
      }
      if (p.pauseStops) {
        expect(stopEl, `${p.id} should be under "what Pause stops"`).not.toBeNull();
        expect(keepEl).toBeNull();
        stops += 1;
      } else {
        expect(keepEl, `${p.id} should be under "what it does not stop"`).not.toBeNull();
        expect(stopEl).toBeNull();
        keeps += 1;
      }
    }
    // Vacuity: both lists are non-empty in the real registry.
    expect(stops).toBeGreaterThanOrEqual(5);
    expect(keeps).toBeGreaterThanOrEqual(2);
    expect(text('[data-testid="pax-pause-still-works"]')).toBe(PAX_PAUSE_COPY.stillWorks);
  });

  it("the page source imports the registry and types no path list of its own", () => {
    const src = read(PAGE_REL);
    expect(src).toContain('from "@shared/pax-controls"');
    expect(src).toMatch(/UNATTENDED_PATHS\.filter\(/);
    // A hand-typed copy of the registry would carry its labels as literals.
    for (const p of UNATTENDED_PATHS) {
      if (p.id === PROBE_PATH.id) continue;
      expect(src, `"${p.label}" is typed inline on the page`).not.toContain(`"${p.label}"`);
    }
  });
});

// ── 2. Stance labels from the glossary ─────────────────────────────────────

describe("stance labels and sentences come from the glossary", () => {
  it("renders exactly the offered stances with their glossary labels", async () => {
    serve(() => controls());
    await mount();
    const options = qq('[data-testid^="stance-option-"]');
    expect(options.map((o) => o.getAttribute("data-testid"))).toEqual(
      OFFERED_STANCES.map((s) => `stance-option-${s}`),
    );
    for (const s of OFFERED_STANCES) {
      expect(text(`[data-testid="stance-option-${s}"]`)).toBe(PAX_STANCE_COPY[s].label);
    }
    expect(text('[data-testid="pax-stance-sentence"]')).toBe(PAX_STANCE_COPY.ask_before_sending.sentence);
    expect(text('[data-testid="pax-status-line"]')).toBe(`${PAX_LABELS.active} · ${PAX_STANCE_COPY.ask_before_sending.label}`);
    expect(text('[data-testid="pax-fixed-rule"]')).toBe(PAX_LABELS.fixedRule);
  });

  it("the page source carries no inline stance label — only the glossary import", () => {
    const src = read(PAGE_REL);
    expect(src).toContain('from "@shared/pax-glossary"');
    for (const s of OFFERED_STANCES) {
      const label = PAX_STANCE_COPY[s].label;
      for (const quoted of [`"${label}"`, `'${label}'`, `\`${label}\``, `>${label}<`]) {
        expect(src, `stance label ${quoted} is typed inline`).not.toContain(quoted);
      }
      expect(src).not.toContain(`"${PAX_STANCE_COPY[s].sentence}"`);
    }
  });
});

// ── 3. True zeros ──────────────────────────────────────────────────────────

describe("true zeros render as zeros", () => {
  it("prints every zero from an all-zero controls object", async () => {
    serve(() => controls());
    await mount();
    expect(text('[data-testid="pax-right-now"]')).toContain(
      `${PAX_LABELS.queue}: 0 · Changed on its own today: 0 · Rules running: 0 workflows, 0 sequences, 0 scheduled prompts`,
    );
    expect(text('[data-testid="run-row-workflows-line"]')).toBe(`0 on · 0 live · ${PAX_PAGE_COPY.noRunsYet}`);
    expect(text('[data-testid="run-row-sequences-line"]')).toBe(`0 active enrollments · ${PAX_PAGE_COPY.noSendsYet}`);
    expect(text('[data-testid="run-row-lead-scoring-line"]')).toContain("0 rescored today");
    expect(text('[data-testid="run-row-borrower-reminders-line"]')).toContain("0 waiting");
    expect(text('[data-testid="run-row-fixed-rules-line"]')).toContain("0 of 50 emails and 0 of 20 texts used today");
    expect(text('[data-testid="link-pax-waiting"]')).toContain(`${PAX_LABELS.queue} (0)`);
    // Nothing on the page dashes a zero out.
    expect(text('[data-testid="pax-runs-card"]')).not.toContain("— ");
  });

  it("prints real counts and a relative last-run when rows exist", async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    serve(() =>
      controls({
        rightNow: { waiting: 3, changedTodayOnItsOwn: 12, rulesRunning: { workflows: 4, sequences: 2, scheduledPrompts: 1 } },
        runsOnItsOwn: {
          ...(controls().runsOnItsOwn as Record<string, unknown>),
          workflows: { active: 4, live: 3, lastRanAt: tenMinAgo },
          leadScoring: { lastRanAt: tenMinAgo, rescoredToday: 7 },
          borrowerReminders: { waiting: 2 },
          fixedRules: { emailsUsedToday: 5, emailLimit: 50, textsUsedToday: 1, textLimit: 20 },
        },
      }),
    );
    await mount();
    expect(text('[data-testid="pax-right-now"]')).toContain(
      `${PAX_LABELS.queue}: 3 · Changed on its own today: 12 · Rules running: 4 workflows, 2 sequences, 1 scheduled prompt`,
    );
    expect(text('[data-testid="run-row-workflows-line"]')).toBe(`4 on · 3 live · 1 ${PAX_LABELS.notYetLive.toLowerCase()} · last ran 10m ago`);
    expect(text('[data-testid="run-row-workflows"]')).toContain(PAX_LABELS.notYetLive);
    expect(text('[data-testid="run-row-lead-scoring-line"]')).toBe(
      `${PAX_FIXED_RULES.leadScoringCadence} · scores and stages leads · last ran 10m ago · 7 rescored today`,
    );
    expect(text('[data-testid="run-row-fixed-rules-line"]')).toContain("5 of 50 emails and 1 of 20 texts used today");
    expect(text('[data-testid="link-pax-waiting"]')).toContain(`${PAX_LABELS.queue} (3)`);
  });
});

// ── 4. Members are read-only ───────────────────────────────────────────────

describe("members read the stance; only an owner or admin changes it", () => {
  it("shows the read-only sentence and disables the stance control and the org switches", async () => {
    serve(() => controls({ canChangeStance: false }));
    await mount();
    expect(text('[data-testid="pax-stance-read-only"]')).toBe(PAX_PAGE_COPY.askAnOwner);
    for (const s of OFFERED_STANCES) {
      const btn = q(`[data-testid="stance-option-${s}"]`) as HTMLButtonElement | null;
      expect(btn, s).not.toBeNull();
      expect(btn!.disabled || btn!.getAttribute("data-disabled") !== null, `${s} should be disabled`).toBe(true);
    }
    for (const id of ["switch-lead-scoring", "switch-borrower-reminders", "switch-inbox-drafts"]) {
      const sw = q(`[data-testid="${id}"]`) as HTMLButtonElement | null;
      expect(sw, id).not.toBeNull();
      expect(sw!.disabled, `${id} should be disabled for a member`).toBe(true);
    }
    // Clicking a disabled option must not PATCH.
    await click(q('[data-testid="stance-option-ask_before_everything"]'));
    expect(apiRequest.mock.calls.filter(([m]) => m === "PATCH")).toHaveLength(0);
  });

  it("an owner's change PATCHes the stance and toasts the glossary consequence", async () => {
    let state = controls();
    serve(
      () => state,
      (method, url, body) => {
        if (method === "PATCH" && url === "/api/pax/controls") {
          state = controls({ stance: (body as { stance: string }).stance });
          return json(state);
        }
        return undefined;
      },
    );
    await mount();
    expect(q('[data-testid="pax-stance-read-only"]')).toBeNull();
    await click(q('[data-testid="stance-option-ask_before_everything"]'));
    const patches = apiRequest.mock.calls.filter(([m, u]) => m === "PATCH" && u === "/api/pax/controls");
    expect(patches).toHaveLength(1);
    expect(patches[0][2]).toEqual({ stance: "ask_before_everything" });
    expect(toasts.map((t) => t.title)).toContain(PAX_STANCE_COPY.ask_before_everything.toast);
    expect(text('[data-testid="pax-stance-sentence"]')).toBe(PAX_STANCE_COPY.ask_before_everything.sentence);
  });
});

// ── 5. Pause / paused / refused ────────────────────────────────────────────

describe("pause asks only until-when; paused and refused states are honest", () => {
  it("Pause Pax opens the until-when choice and POSTs the chosen key", async () => {
    let state = controls();
    const until = new Date(Date.now() + 20 * 3600_000).toISOString();
    serve(
      () => state,
      (method, url, body) => {
        if (method === "POST" && url === "/api/pax/pause") {
          state = controls({ paused: true, pausedUntil: until, pausedBy: { userId: "u1", name: "Maria" } });
          return json(state);
        }
        return undefined;
      },
    );
    await mount();
    expect(q('[data-testid="pax-pause-dialog"]')).toBeNull();
    await click(q('[data-testid="button-pax-pause"]'));
    const dialog = document.querySelector('[data-testid="pax-pause-dialog"]');
    expect(dialog, "the until-when dialog").not.toBeNull();
    const options = Array.from(dialog!.querySelectorAll('[data-testid^="button-pause-"]')).map((b) => b.getAttribute("data-testid"));
    expect(options).toEqual(["button-pause-tomorrow_8am", "button-pause-3d", "button-pause-30d"]);
    await click(dialog!.querySelector('[data-testid="button-pause-tomorrow_8am"]') as HTMLElement);
    const posts = apiRequest.mock.calls.filter(([m, u]) => m === "POST" && u === "/api/pax/pause");
    expect(posts).toHaveLength(1);
    expect(posts[0][2]).toMatchObject({ until: "tomorrow_8am" });
    expect(text('[data-testid="pax-status-line"]')).toBe(
      PAX_PAUSE_COPY.statusLine({ until: new Date(until), byName: "Maria", timeZone: "America/Chicago" }),
    );
    expect(toasts[0]?.title).toContain(PAX_LABELS.paused);
  });

  it("a paused org shows the glossary line with the holder, and Resume only for those who may", async () => {
    const until = new Date(Date.now() + 20 * 3600_000).toISOString();
    serve(() => controls({ paused: true, pausedUntil: until, pausedBy: { userId: "u2", name: "Maria" }, canResume: false }));
    await mount();
    const line = text('[data-testid="pax-status-line"]');
    expect(line).toBe(PAX_PAUSE_COPY.statusLine({ until: new Date(until), byName: "Maria", timeZone: "America/Chicago" }));
    expect(line).toContain("Maria");
    expect(q('[data-testid="button-pax-pause"]')).toBeNull();
    expect(q('[data-testid="button-pax-resume"]')).toBeNull();
    expect(text('[data-testid="pax-resume-not-yours"]')).toBe(PAX_PAGE_COPY.resumeNotYours);
    // A 20-hour pause is not the 30-day lift — no "resumes by itself" line.
    expect(q('[data-testid="pax-resumes-by-itself"]')).toBeNull();
  });

  it("the 30-day pause says it lifts by itself, and Resume POSTs for someone who may", async () => {
    const until = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
    let state = controls({ paused: true, pausedUntil: until, pausedBy: { userId: "u1", name: "Dana" }, canResume: true });
    serve(
      () => state,
      (method, url) => {
        if (method === "POST" && url === "/api/pax/resume") {
          state = controls();
          return json(state);
        }
        return undefined;
      },
    );
    await mount();
    expect(text('[data-testid="pax-resumes-by-itself"]')).toBe(PAX_PAUSE_COPY.resumesByItself(new Date(until), "America/Chicago"));
    await click(q('[data-testid="button-pax-resume"]'));
    expect(apiRequest.mock.calls.filter(([m, u]) => m === "POST" && u === "/api/pax/resume")).toHaveLength(1);
    expect(text('[data-testid="pax-status-line"]')).toContain(PAX_LABELS.active);
  });

  it("a controls read the server refused renders the refusal with retry and no stance", async () => {
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/pax/controls") throw new Error(`503: ${PAX_PAUSE_COPY.checkFailedRefusal}`);
      return json({});
    });
    await mount();
    const err = q('[data-testid="pax-controls-error"]');
    expect(err, "error state").not.toBeNull();
    expect(err!.textContent).toContain(PAX_PAUSE_COPY.checkFailedRefusal);
    expect(q('[data-testid="pax-stance-control"]')).toBeNull();
    expect(q('[data-testid="pax-status-line"]')).toBeNull();
  });

  it("shows a skeleton while the controls load", async () => {
    apiRequest.mockImplementation(() => new Promise<never>(() => {}));
    await mount();
    const loading = q('[data-testid="pax-controls-loading"]');
    expect(loading).not.toBeNull();
    expect(loading!.getAttribute("aria-busy")).toBe("true");
  });
});

// ── 6. Scheduled prompts ───────────────────────────────────────────────────

describe("scheduled prompts", () => {
  const prompts = [
    { id: 11, name: "Monday lead pull", isActive: true, lastRunAt: null, lastRunStatus: "skipped_paused", nextRunAt: null },
    { id: 12, name: "Friday recap", isActive: false, lastRunAt: null, lastRunStatus: "error", nextRunAt: null },
    { id: 13, name: "Daily comps", isActive: true, lastRunAt: null, lastRunStatus: "success", nextRunAt: null },
  ];

  it("renders skips as neutral, never as Error, and errors as Error", async () => {
    serve(() => controls({ runsOnItsOwn: { ...(controls().runsOnItsOwn as Record<string, unknown>), scheduledPrompts: prompts } }));
    await mount();
    expect(text('[data-testid="scheduled-prompt-11-status"]')).toBe(PAX_PAGE_COPY.promptSkippedPaused);
    expect(text('[data-testid="scheduled-prompt-11"]')).not.toContain(PAX_PAGE_COPY.promptError);
    expect(text('[data-testid="scheduled-prompt-12-status"]')).toBe(PAX_PAGE_COPY.promptError);
    expect(text('[data-testid="scheduled-prompt-13-status"]')).toBe(PAX_PAGE_COPY.promptOk);
    expect(text('[data-testid="run-row-scheduled-prompts"]')).toContain("2 of 3 on");
  });

  it("Pause on a prompt PATCHes /api/ai/scheduled-tasks/:id { isActive:false } — no /toggle", async () => {
    serve(
      () => controls({ runsOnItsOwn: { ...(controls().runsOnItsOwn as Record<string, unknown>), scheduledPrompts: prompts } }),
      (method, url) => (method === "PATCH" && url === "/api/ai/scheduled-tasks/11" ? json({ success: true }) : undefined),
    );
    await mount();
    await click(q('[data-testid="button-prompt-pause-11"]'));
    const patches = apiRequest.mock.calls.filter(([m, u]) => m === "PATCH" && String(u).startsWith("/api/ai/scheduled-tasks/"));
    expect(patches).toHaveLength(1);
    expect(patches[0][1]).toBe("/api/ai/scheduled-tasks/11");
    expect(patches[0][2]).toEqual({ isActive: false });
    expect(apiRequest.mock.calls.some(([, u]) => String(u).includes("/toggle"))).toBe(false);
    expect(q('[data-testid="button-prompt-resume-12"]')).not.toBeNull();
  });
});

// ── 7. Source contracts ────────────────────────────────────────────────────

describe("source contracts (the deletions this page replaced)", () => {
  const page = read(PAGE_REL);

  it("the page reads only the org-truth routes and prints no Undo", () => {
    expect(page).toContain('"/api/pax/controls"');
    expect(page).toContain('"/api/pax/pause"');
    expect(page).toContain('"/api/pax/resume"');
    expect(page).toContain("/api/pax/receipts");
    expect(page).not.toContain("/api/me/autonomy");
    expect(page).not.toMatch(/\bUndo\b/);
    expect(page).not.toContain("@/components/ui/slider");
    expect(page).not.toMatch(/confiden(?!tial)/i);
  });

  it("the replaced components are gone, with no importer left", () => {
    for (const rel of [
      "client/src/components/settings/autopilot-setup.tsx",
      "client/src/components/settings/autonomy-panel.tsx",
      "client/src/components/ai-settings.tsx",
      "client/src/components/pax-tasks-settings-tab.tsx",
      "client/src/components/workflows-settings-tab.tsx",
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} is back`).toBe(false);
    }
    const settings = read("client/src/pages/settings.tsx");
    for (const gone of ["AutonomyPanel", "AISettings", "PaxTasksSettingsTab", "WorkflowsSettingsTab", "ByokSettings", "feature.autonomy-matrix", "useFlag("]) {
      expect(settings, `settings.tsx still references ${gone}`).not.toContain(gone);
    }
    expect(settings).toContain("PAX_SETTINGS_COPY.bucketLabel");
    expect(settings).toContain("href={PAX_CONTROLS_PATH}");
    // VALID_TABS stays at 7 — no eighth tab (founder question 9).
    const tabs = settings.slice(settings.indexOf("const VALID_TABS = ["), settings.indexOf("] as const;", settings.indexOf("const VALID_TABS = [")));
    expect((tabs.match(/"[a-z-]+"/g) ?? []).length).toBe(7);
    const quickFind = read("client/src/components/settings/SettingsQuickFind.tsx");
    expect(quickFind).not.toContain("Autonomy matrix");
    expect(quickFind).toContain("href: PAX_CONTROLS_PATH");
    const builder = read("client/src/components/workflow-builder.tsx");
    expect(builder).not.toContain("WorkflowBuilderPanel");
  });

  it("the cadences the page prints match the job roster and the send chokepoint", () => {
    const roster = read("server/jobs/jobRegistry.ts");
    expect(roster).toMatch(/name:\s*"lead_nurturing",\s*intervalMs:\s*15 \* MIN/);
    expect(PAX_FIXED_RULES.leadScoringCadence).toBe("every 15 min");
    expect(roster).toMatch(/name:\s*"finance_agent",\s*intervalMs:\s*30 \* MIN/);
    expect(PAX_FIXED_RULES.borrowerRemindersCadence).toBe("every 30 min");
    const tcpa = read("server/services/tcpaCompliance.ts");
    expect(tcpa).toMatch(/local(?:Time)? < 8 \|\| local(?:Time)? >= 21/);
    expect(PAX_FIXED_RULES.textHours).toBe("8 am–9 pm");
  });
});
