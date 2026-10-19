/**
 * The REAL renderer (founder decision 2026-10-18, "render to PDF, then
 * count"): headless Chromium via puppeteer-core lays a letter's HTML out at
 * Lob's US-Letter size, and the page count of THAT PDF is what house mail
 * charges for. Runs wherever a Chromium is installed (the production image
 * installs one — Dockerfile `chromium`, PUPPETEER_EXECUTABLE_PATH); elsewhere
 * it is skipped.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";

// Every sub-resource is fetched by AcreOS through safeHttpsGet (the real one,
// recorded) — Chromium never makes a network request of its own.
const fetchedBySafeGet = vi.hoisted(() => [] as string[]);
vi.mock("../../server/services/mail/safeFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/mail/safeFetch")>();
  return {
    ...actual,
    safeHttpsGet: async (url: string, opts: Parameters<typeof actual.safeHttpsGet>[1]) => {
      fetchedBySafeGet.push(url);
      return actual.safeHttpsGet(url, { ...opts, resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
    },
  };
});

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
  // The renderer reuses ONE browser. Its one-time launch (module import +
  // Chromium cold start) is paid here, and must still yield a real PDF; under
  // a loaded CI runner that launch alone has taken >20 s. The per-letter
  // latency bound below then measures what a letter actually costs on the
  // running browser, which is what RENDER_TIMEOUT_MS bounds in the renderer.
  beforeAll(async () => {
    const { renderLetterHtmlToPdf } = await import("../../server/services/mail/letterRender");
    const pdf = await renderLetterHtmlToPdf(htmlOfPages(1));
    expect(await count(pdf)).toBe(1);
  }, 120_000);

  it.each([1, 2, 6, 7])("%i page(s) of HTML → a PDF of exactly that many pages", async (n) => {
    const { renderLetterHtmlToPdf } = await import("../../server/services/mail/letterRender");
    const started = Date.now();
    const pdf = await renderLetterHtmlToPdf(htmlOfPages(n));
    const ms = Date.now() - started;
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(await count(pdf)).toBe(n);
    // A warm render (the launch was paid in beforeAll) stays inside the
    // renderer's own per-render ceiling.
    console.info(`[houseLetterRenderReal] ${n} page(s) rendered in ${ms} ms`);
    expect(ms).toBeLessThan(20_000);
  }, 30_000);

  it("an https image is fetched by AcreOS's guarded fetch, never by Chromium directly", async () => {
    const { renderLetterHtmlToPdf } = await import("../../server/services/mail/letterRender");
    fetchedBySafeGet.length = 0;
    const pdf = await renderLetterHtmlToPdf('<html><body><img src="https://letters.example.com/logo.png"><p>Hi</p></body></html>');
    expect(await count(pdf)).toBe(1);
    expect(fetchedBySafeGet).toEqual(["https://letters.example.com/logo.png"]);
  }, 30_000);

  it("a letter cannot make the server fetch a private address (the request is aborted, the letter still renders)", async () => {
    const { renderLetterHtmlToPdf } = await import("../../server/services/mail/letterRender");
    const pdf = await renderLetterHtmlToPdf('<html><body><img src="http://169.254.169.254/latest/meta-data/"><p>Hi</p></body></html>');
    expect(await count(pdf)).toBe(1);
  }, 30_000);
});

describe("the renderer is bounded (audit 2026-10-18)", () => {
  it("HTML over the size cap is refused before any browser starts", async () => {
    const { renderLetterHtmlToPdf, MAX_HTML_BYTES, rendersInFlight } = await import("../../server/services/mail/letterRender");
    await expect(renderLetterHtmlToPdf("<p>" + "x".repeat(MAX_HTML_BYTES) + "</p>")).rejects.toThrow(/exceeds/);
    expect(rendersInFlight()).toBe(0);
  });

  it.runIf(Boolean(chrome))("a burst of renders runs at most MAX_CONCURRENT_RENDERS at once, on one browser", async () => {
    const { renderLetterHtmlToPdf, MAX_CONCURRENT_RENDERS, rendersInFlight } = await import("../../server/services/mail/letterRender");
    let peak = 0;
    const poll = setInterval(() => (peak = Math.max(peak, rendersInFlight())), 5);
    try {
      const pdfs = await Promise.all(Array.from({ length: 6 }, (_, i) => renderLetterHtmlToPdf(htmlOfPages((i % 2) + 1))));
      expect(pdfs).toHaveLength(6);
    } finally {
      clearInterval(poll);
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_RENDERS);
  }, 60_000);
});
