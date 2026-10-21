/**
 * Render a letter's HTML to the PDF AcreOS house mail prints — founder decision
 * 2026-10-18 ("render to PDF, then count").
 *
 * The house lane charges per CONFIRMED page, and HTML has no page count until
 * it is laid out. So AcreOS lays it out itself, here, at Lob's letter page
 * size (US Letter, 8.5 × 11 in), counts the PDF's pages, charges for exactly
 * that, and sends Lob THIS PDF — Lob never re-renders the HTML, so the printed
 * piece is the counted piece.
 *
 * Renderer: the repo's existing headless Chromium (puppeteer-core; the
 * production image installs `chromium` and sets PUPPETEER_EXECUTABLE_PATH —
 * see Dockerfile). The HTML is untrusted, so:
 *   - input is capped (MAX_HTML_BYTES) and renders are serialized through a
 *     small semaphore (MAX_CONCURRENT_RENDERS) on ONE reused browser, each in
 *     its own page with a hard timeout — a burst of letters cannot fork a
 *     Chromium per piece;
 *   - JavaScript is disabled;
 *   - every sub-resource is fetched by AcreOS itself through safeHttpsGet
 *     (DNS resolved once, every address public, connection pinned, byte-capped,
 *     no redirects) and handed to the page; anything else (http:, file:,
 *     a blocked address, too many requests) is aborted. Chromium never makes a
 *     network request of its own.
 * Any failure throws; the caller refuses the send.
 */
import fs from "node:fs";
import type { Browser } from "puppeteer-core";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";
import { safeHttpsGet } from "./safeFetch";

/** Lob's letter page size. */
const LOB_LETTER_PAGE = { width: "8.5in", height: "11in" } as const;

const RENDER_TIMEOUT_MS = 20_000;
/**
 * How long the one shared browser may take to come up. puppeteer's own default
 * is 30 s, and a cold Chromium start on a loaded host has taken longer than
 * that (CI on main, 2026-10-20: "Timed out after 30000 ms while waiting for the
 * WS endpoint"), which refused the letter even though nothing was wrong with
 * it. Paid once per browser, not per letter; a render still has
 * RENDER_TIMEOUT_MS once the browser is up.
 */
export const BROWSER_LAUNCH_TIMEOUT_MS = 90_000;
/** The largest letter HTML AcreOS will lay out. */
export const MAX_HTML_BYTES = 512 * 1024;
/** Renders in flight at once, across the whole process. */
export const MAX_CONCURRENT_RENDERS = 2;
const MAX_SUBRESOURCES = 20;
const MAX_SUBRESOURCE_BYTES = 2 * 1024 * 1024;

function chromiumPath(): string {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter((p): p is string => Boolean(p));
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* keep looking */
    }
  }
  throw new Error("no Chromium executable is installed for letter rendering");
}

// ── one browser, a small semaphore ──────────────────────────────────────────

let browserPromise: Promise<Browser> | null = null;

async function browser(): Promise<Browser> {
  if (!browserPromise) {
    const puppeteer = (await import("puppeteer-core")).default;
    browserPromise = puppeteer
      .launch({
        executablePath: chromiumPath(),
        headless: true,
        timeout: BROWSER_LAUNCH_TIMEOUT_MS,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
      })
      .then((b) => {
        b.on("disconnected", () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

/** An idle browser is closed (and relaunched on the next letter). */
const BROWSER_IDLE_MS = 60_000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (inFlight > 0 || !browserPromise) return;
    const closing = browserPromise;
    browserPromise = null;
    void closing.then((b) => b.close()).catch(() => undefined);
  }, BROWSER_IDLE_MS);
  idleTimer.unref?.();
}

let inFlight = 0;
const waiting: Array<() => void> = [];

async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT_RENDERS) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
    if (inFlight === 0) scheduleIdleClose();
  }
}

/** For tests: how many renders are running right now. */
export function rendersInFlight(): number {
  return inFlight;
}

/** Render `html` to a US-Letter PDF. Throws when it cannot. */
export async function renderLetterHtmlToPdf(html: string): Promise<Buffer> {
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new Error(`letter HTML exceeds ${MAX_HTML_BYTES} bytes`);
  }
  return withRenderSlot(async () => {
    const started = clock.nowMs();
    const b = await browser();
    const page = await b.newPage();
    const kill = setTimeout(() => void page.close().catch(() => undefined), RENDER_TIMEOUT_MS);
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      let subresources = 0;
      page.on("request", (req) => {
        void (async () => {
          const url = req.url();
          if (url.startsWith("data:") || url === "about:blank") return req.continue();
          if (!url.startsWith("https://") || ++subresources > MAX_SUBRESOURCES) return req.abort();
          const got = await safeHttpsGet(url, { maxBytes: MAX_SUBRESOURCE_BYTES, timeoutMs: 5_000 });
          if (!got || got.status < 200 || got.status >= 300) return req.abort();
          return req.respond({ status: got.status, contentType: got.contentType || undefined, body: got.body });
        })().catch(() => req.abort().catch(() => undefined));
      });
      await page.setContent(html, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
      const pdf = await page.pdf({
        width: LOB_LETTER_PAGE.width,
        height: LOB_LETTER_PAGE.height,
        printBackground: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
        timeout: RENDER_TIMEOUT_MS,
      });
      logger.info("[letterRender] rendered letter", { metadata: { bytes: pdf.length, ms: clock.nowMs() - started } });
      return Buffer.from(pdf);
    } finally {
      clearTimeout(kill);
      await page.close().catch(() => undefined);
    }
  });
}
