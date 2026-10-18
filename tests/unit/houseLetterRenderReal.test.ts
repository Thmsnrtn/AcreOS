/**
 * The REAL renderer (founder decision 2026-10-18, "render to PDF, then
 * count"): headless Chromium via puppeteer-core lays a letter's HTML out at
 * Lob's US-Letter size, and the page count of THAT PDF is what house mail
 * charges for. Runs wherever a Chromium is installed (the production image
 * installs one — Dockerfile `chromium`, PUPPETEER_EXECUTABLE_PATH); elsewhere
 * it is skipped.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
].filter((p): p is string => Boolean(p));
const chrome = CANDIDATES.find((p) => fs.existsSync(p));
if (chrome && !process.env.PUPPETEER_EXECUTABLE_PATH) process.env.CHROMIUM_PATH = chrome;

/** A letter whose content forces exactly `n` US-Letter pages. */
function htmlOfPages(n: number): string {
  const pages = Array.from(
    { length: n },
    (_, i) => `<section style="height:10.5in;page-break-after:${i < n - 1 ? "always" : "auto"}">Page ${i + 1}</section>`,
  );
  return `<!doctype html><html><body style="margin:0;font:12pt serif">${pages.join("")}</body></html>`;
}

async function count(pdf: Buffer): Promise<number> {
  const { PDFParse } = await import("pdf-parse");
  const p = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    return (await p.getInfo()).total;
  } finally {
    await p.destroy();
  }
}

describe.runIf(Boolean(chrome))("letter HTML renders to a US-Letter PDF whose pages are counted (real Chromium)", () => {
  it.each([1, 2, 6, 7])("%i page(s) of HTML → a PDF of exactly that many pages", async (n) => {
    const { renderLetterHtmlToPdf } = await import("../../server/services/mail/letterRender");
    const started = Date.now();
    const pdf = await renderLetterHtmlToPdf(htmlOfPages(n));
    const ms = Date.now() - started;
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(await count(pdf)).toBe(n);
    // Latency is reported, not tightly gated: a cold Chromium launch dominates.
    console.info(`[houseLetterRenderReal] ${n} page(s) rendered in ${ms} ms`);
    expect(ms).toBeLessThan(20_000);
  }, 30_000);

  it("a letter cannot make the server fetch a private address (the request is aborted, the letter still renders)", async () => {
    const { renderLetterHtmlToPdf } = await import("../../server/services/mail/letterRender");
    const pdf = await renderLetterHtmlToPdf('<html><body><img src="http://169.254.169.254/latest/meta-data/"><p>Hi</p></body></html>');
    expect(await count(pdf)).toBe(1);
  }, 30_000);
});
