/**
 * Real-UI persona walks: a layperson founder and three customer personas use
 * the REAL client (Playwright + Chromium) on a phone and a desktop viewport,
 * against a world a simulated year left behind.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers SIM_BASE_URL=http://localhost:<port> \
 *   WALK_OUT=<dir> WALK_CUSTOMERS=<metrics.json of the year seed> \
 *     npx tsx tests/simulation/walks/persona-walks.ts
 *
 * Per task it measures TIME-TO-ANSWER: from the start page, the walker clicks
 * the visible navigation (by accessible name, the way a person reads it) until
 * the answer is on screen, or gives up after its click budget — a dead end.
 *   founder: the six Letter questions (evals/letterQuestions.ts — one list);
 *   customers: their core jobs (import a list, send postcards, read replies,
 *   record a payment, see late payments, invite and watch a VA).
 * On EVERY page visited: axe-core (serious + critical), unlabelled controls,
 * jargon (walks/vocabulary.ts), empty states with no call to action.
 * It only reads the screen and clicks navigation; it never submits a form.
 */
import { chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LETTER_QUESTIONS } from "../evals/letterQuestions";
import { JARGON } from "./vocabulary";
import { personaCookieValue, E2E_FOUNDER_COOKIE } from "../../../server/auth/testAuth";

const BASE = process.env.SIM_BASE_URL ?? "http://localhost:5400";
const OUT = process.env.WALK_OUT ?? "walk-out";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { key: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { key: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
] as const;

interface Task { who: string; question: string; start: string; /** Names a person would click, in order of preference. */ via: string[]; target: RegExp }
const FOUNDER_DOOR_NAMES = ["The Letter", "Decisions", "Controls", "Story"];
const FOUNDER_TASKS: Task[] = LETTER_QUESTIONS.map((q) => ({ who: "founder", question: q.question, start: "/founder", via: FOUNDER_DOOR_NAMES, target: q.onScreen }));
const CUSTOMER_TASKS: Record<string, Task[]> = {
  // Targets are the words of the CONTROL that does the job (Pax's own place facts
  // name them: paxProductFacts.ts PLACES), not a word that merely appears nearby.
  land_flipper: [
    { who: "land flipper", question: "Import my list of owners", start: "/today", via: ["Deals", "Leads", "Import"], target: /import csv|import tax list|import leads/i },
    { who: "land flipper", question: "Send postcards to my leads", start: "/today", via: ["Deals", "Outreach", "Campaigns", "New campaign"], target: /direct mail|postcards?\b/i },
    { who: "land flipper", question: "Read what sellers texted back", start: "/today", via: ["Inbox"], target: /\binbox\b[\s\S]{0,400}(repl|message|conversation)/i },
  ],
  note_investor: [
    { who: "note investor", question: "Record a borrower payment", start: "/today", via: ["Finance", "Notes"], target: /record payment/i },
    { who: "note investor", question: "See which notes are late", start: "/today", via: ["Finance", "Notes", "Delinquent"], target: /delinquen|past due|days late/i },
  ],
  va_team: [
    { who: "VA-run team", question: "Invite my VA", start: "/today", via: ["Settings", "Organization", "Team", "Members"], target: /invite (a )?(member|teammate|team member|user)|send invit/i },
    { who: "VA-run team", question: "See what my VA did today", start: "/today", via: ["Activity", "Settings"], target: /team activity|activity log|what your team did/i },
  ],
};
const CLICK_BUDGET = 4;

interface PageAudit { url: string; viewport: string; axeSerious: number; axeCritical: number; axeRules: string[]; unlabelled: string[]; jargon: Record<string, number>; emptyNoCta: string[] }
const audits = new Map<string, PageAudit>();

async function audit(page: Page, viewport: string, customer: boolean): Promise<void> {
  const url = page.url().replace(BASE, "").split("?")[0];
  const key = `${url}|${viewport}|${customer ? "c" : "f"}`;
  if (audits.has(key)) return;
  let serious = 0, critical = 0;
  const rules: string[] = [];
  try {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    for (const v of r.violations) {
      if (v.impact === "serious") serious += v.nodes.length;
      if (v.impact === "critical") critical += v.nodes.length;
      if (v.impact === "serious" || v.impact === "critical") rules.push(`${v.id} (${v.nodes.length})`);
    }
  } catch (e) { rules.push(`axe failed: ${String(e).slice(0, 80)}`); }
  const dom = await page.evaluate(() => {
    const unlabelled: string[] = [];
    document.querySelectorAll("button,a[href],[role=button],input,select,textarea").forEach((el) => {
      const h = el as HTMLElement;
      const r = h.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const name = (h.innerText || h.getAttribute("aria-label") || h.getAttribute("title") || h.getAttribute("placeholder") || "").trim();
      const labelled = !!h.getAttribute("aria-labelledby") || (h.id && document.querySelector(`label[for="${h.id}"]`)) || h.closest("label");
      if (!name && !labelled) unlabelled.push(`${h.tagName.toLowerCase()}${h.getAttribute("data-testid") ? `[data-testid=${h.getAttribute("data-testid")}]` : ""}`);
    });
    const emptyNoCta: string[] = [];
    document.querySelectorAll("p,h2,h3,div,span").forEach((el) => {
      const t = ((el as HTMLElement).innerText || "").trim();
      if (t.length > 120 || !/^(no .{1,60} yet|nothing (here|to show)|you (don't|do not) have any)/i.test(t)) return;
      const box = el.closest("section,article,[class*=card],[class*=empty],main") ?? el.parentElement;
      if (box && !box.querySelector("button,a[href]")) emptyNoCta.push(t.slice(0, 80));
    });
    return { unlabelled: unlabelled.slice(0, 20), emptyNoCta: [...new Set(emptyNoCta)].slice(0, 10), text: document.body.innerText };
  });
  const jargon: Record<string, number> = {};
  for (const term of JARGON) {
    if (customer && /^(pax|deploy|agent)$/i.test(term)) continue; // customer door names and their own vocabulary
    const n = (dom.text.match(new RegExp(`\\b${term.split(/[-_]/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[-_ ]")}s?\\b`, "gi")) ?? []).length;
    if (n) jargon[term] = n;
  }
  audits.set(key, { url, viewport, axeSerious: serious, axeCritical: critical, axeRules: rules, unlabelled: dom.unlabelled, jargon, emptyNoCta: dom.emptyNoCta });
}

let shot = 0;
async function visibleText(page: Page): Promise<string> {
  const t = await page.evaluate(() => document.body.innerText).catch(() => "");
  try { writeFileSync(join(OUT, `text-${String(++shot).padStart(3, "0")}.txt`), `${page.url()}\n\n${t}`); } catch { /* evidence only */ }
  return t;
}

async function walkTask(page: Page, t: Task, viewport: string, customer: boolean) {
  const t0 = Date.now();
  const clicks: string[] = [];
  await page.goto(`${BASE}${t.start}`, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await audit(page, viewport, customer);
  if (t.target.test(await visibleText(page))) return { ...base(t, viewport), answered: true, seconds: (Date.now() - t0) / 1000, clicks };
  for (const name of t.via) {
    if (clicks.length >= CLICK_BUDGET) break;
    let target = null;
    for (const role of ["link", "tab", "button", "menuitem"] as const) {
      const el = page.getByRole(role, { name: new RegExp(`^\\s*${name}\\b`, "i") }).first();
      if (await el.isVisible().catch(() => false)) { target = el; break; }
    }
    if (!target) {
      // On a phone a door may sit behind the menu.
      const menu = page.getByRole("button", { name: /menu|more|open navigation/i }).first();
      if (await menu.isVisible().catch(() => false)) { await menu.click().catch(() => {}); clicks.push("menu"); await page.waitForTimeout(500); }
      const again = page.getByRole("link", { name: new RegExp(`^\\s*${name}\\b`, "i") }).first();
      if (!(await again.isVisible().catch(() => false))) continue;
      await again.click().catch(() => {});
    } else await target.click().catch(() => {});
    clicks.push(name);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await audit(page, viewport, customer);
    if (t.target.test(await visibleText(page))) return { ...base(t, viewport), answered: true, seconds: (Date.now() - t0) / 1000, clicks };
  }
  return { ...base(t, viewport), answered: false, seconds: (Date.now() - t0) / 1000, clicks, deadEnd: page.url().replace(BASE, "") };
}
const base = (t: Task, viewport: string) => ({ who: t.who, question: t.question, viewport });

async function main() {
  const customers: Array<{ slug: string; persona: string; churned: boolean }> = process.env.WALK_CUSTOMERS && existsSync(process.env.WALK_CUSTOMERS)
    ? JSON.parse(readFileSync(process.env.WALK_CUSTOMERS, "utf8")).customerList ?? []
    : [];
  const people: Array<{ who: string; cookie: string; tasks: Task[]; customer: boolean }> = [{ who: "founder", cookie: E2E_FOUNDER_COOKIE, tasks: FOUNDER_TASKS, customer: false }];
  for (const persona of ["land_flipper", "note_investor", "va_team"]) {
    const c = customers.find((x) => x.persona === persona && !x.churned) ?? customers.find((x) => x.persona === persona);
    if (c) people.push({ who: persona, cookie: personaCookieValue(c.slug), tasks: CUSTOMER_TASKS[persona], customer: true });
  }
  const browser = await chromium.launch();
  const results: any[] = [];
  for (const vp of VIEWPORTS) {
    for (const p of people) {
      const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor });
      await ctx.addCookies([{ name: "__session", value: p.cookie, url: BASE }]);
      const page = await ctx.newPage();
      for (const t of p.tasks) {
        const r = await walkTask(page, t, vp.key, p.customer);
        results.push(r);
        console.log(`  [${vp.key}] ${t.who}: "${t.question}" → ${r.answered ? `${r.seconds.toFixed(1)} s` : `DEAD END at ${(r as any).deadEnd}`} via ${r.clicks.join(" > ") || "(start page)"}`);
      }
      await page.screenshot({ path: join(OUT, `${p.who}-${vp.key}.png`), fullPage: true }).catch(() => {});
      await ctx.close();
    }
  }
  await browser.close();
  const pages = [...audits.values()];
  const summary = {
    personas: people.map((p) => p.who),
    pages: pages.length,
    axeViolations: pages.reduce((a, p) => a + p.axeSerious + p.axeCritical, 0),
    axeByRule: pages.flatMap((p) => p.axeRules).reduce((a: Record<string, number>, r) => { const k = r.replace(/ \(\d+\)$/, ""); a[k] = (a[k] ?? 0) + Number(/\((\d+)\)/.exec(r)?.[1] ?? 1); return a; }, {}),
    unlabelled: pages.reduce((a, p) => a + p.unlabelled.length, 0),
    deadEnds: results.filter((r) => !r.answered).length,
    emptyStatesWithoutCta: pages.flatMap((p) => p.emptyNoCta.map((e) => `${p.url}: ${e}`)),
    jargonPages: pages.filter((p) => Object.keys(p.jargon).length).map((p) => ({ url: p.url, viewport: p.viewport, jargon: p.jargon })),
    timeToAnswer: results,
    audits: pages,
  };
  writeFileSync(join(OUT, "walks.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ pages: summary.pages, axe: summary.axeViolations, unlabelled: summary.unlabelled, deadEnds: summary.deadEnds, emptyNoCta: summary.emptyStatesWithoutCta.length }));
}
main().catch((e) => { console.error(e); process.exit(1); });
