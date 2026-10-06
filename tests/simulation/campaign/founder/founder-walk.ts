/**
 * Part B — the layperson founder walk.
 *
 * Opens the four founder doors (The Letter, Decisions, Controls, Story) as the
 * founder (E2E test-auth cookie, server/auth/testAuth.ts) on an iPhone-sized
 * and a desktop viewport, against whatever world state the last scenario left
 * in the sim DB. Saves, per door × viewport: the visible text, a full-page
 * screenshot, word count, jargon hits, and every interactive control smaller
 * than 44×44 CSS px.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *   SIM_BASE_URL=http://localhost:5187 FOUNDER_SIM_OUT=<dir> \
 *     npx tsx tests/simulation/campaign/founder/founder-walk.ts <label>
 *
 * It reads the screen only; it never writes to the app. The six layperson
 * questions are answered by a human/agent reading the saved text — this
 * script records the evidence, it does not grade it.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SIM_BASE_URL ?? "http://localhost:5187";
const OUT = join(process.env.FOUNDER_SIM_OUT ?? "/tmp/founder-sim-out", "walk", process.argv[2] ?? "now");
mkdirSync(OUT, { recursive: true });

const DOORS = [
  { key: "letter", path: "/founder" },
  { key: "decisions", path: "/founder/decisions" },
  { key: "controls", path: "/founder/autopilot/control" },
  { key: "story", path: "/founder/autopilot/story" },
];
const VIEWPORTS = [
  { key: "iphone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { key: "desktop", viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];
/** Terms a non-technical founder would not know. Matched case-insensitively as words. */
const JARGON = [
  "domain", "trust level", "witness", "witnessed", "dispatch", "autonomy", "observe", "draft", "execute_gated", "autonomous_gated",
  "cognition", "reflex", "reflexes", "telemetry", "ETL", "envelope", "shadow", "calibration", "pre-mortem", "premortem", "council",
  "move", "play", "playbook", "cycle", "clean cycle", "ledger", "receipt", "hash", "kernel", "operator", "SLA", "MRR", "CAC", "LTV",
  "runway", "stabilize_reflexes", "grow_owned_channels", "deploy", "ops", "agent", "iris", "soren", "beatrice", "krieger", "sophie",
  "pax", "solene", "hand", "hands", "pending action", "standing order", "ensemble", "cap", "quarantine", "panic", "preflight",
  "governance", "evidence packet", "seam", "tick", "loop", "brain", "sense", "senses", "counterfactual", "efficacy", "bandit",
];

async function main() {
  const browser = await chromium.launch();
  const rows: any[] = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor });
    await ctx.addCookies([{ name: "__session", value: "e2e-founder", url: BASE }]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    for (const door of DOORS) {
      const failed: string[] = [];
      const onResp = (r: any) => { if (r.url().startsWith(BASE) && r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(BASE, "")}`); };
      page.on("response", onResp);
      const t0 = Date.now();
      await page.goto(`${BASE}${door.path}`, { waitUntil: "networkidle", timeout: 45_000 }).catch((e) => errors.push(`goto ${door.path}: ${String(e).slice(0, 120)}`));
      await page.waitForTimeout(2500);
      const finalUrl = page.url().replace(BASE, "");
      const text: string = await page.evaluate(() => document.body.innerText);
      const small = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll("a,button,[role=button],input,select,textarea,[role=tab],[role=switch]").forEach((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.width < 44 || r.height < 44) out.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} "${((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30)}"`);
        });
        return out;
      });
      const words = text.split(/\s+/).filter(Boolean).length;
      const jargon: Record<string, number> = {};
      for (const term of JARGON) {
        const n = (text.match(new RegExp(`\\b${term.split(/[-_]/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[-_ ]")}s?\\b`, "gi")) ?? []).length;
        if (n) jargon[term] = n;
      }
      const base = `${door.key}-${vp.key}`;
      writeFileSync(join(OUT, `${base}.txt`), text);
      await page.screenshot({ path: join(OUT, `${base}.png`), fullPage: true }).catch(() => {});
      page.off("response", onResp);
      rows.push({ door: door.key, viewport: vp.key, path: door.path, finalUrl, loadMs: Date.now() - t0, words, smallControls: small.length, smallSample: small.slice(0, 12), jargon, httpFailures: failed.slice(0, 10), pageErrors: errors.splice(0) });
      console.log(`  ${base}: ${words} words, ${small.length} small controls, jargon=${Object.keys(jargon).length}, http fails=${failed.length}, url=${finalUrl}`);
    }
    await ctx.close();
  }
  await browser.close();
  writeFileSync(join(OUT, "walk.json"), JSON.stringify(rows, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
