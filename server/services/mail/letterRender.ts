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
 * see Dockerfile). Untrusted HTML: JavaScript is disabled and every
 * sub-resource request is aborted unless it is an https URL that passes the
 * SSRF guard (or an inline data: URL), so a letter cannot make the server
 * fetch a private address. Any failure throws; the caller refuses the send.
 */
import fs from "node:fs";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";

/** Lob's letter page size. */
const LOB_LETTER_PAGE = { width: "8.5in", height: "11in" } as const;

const RENDER_TIMEOUT_MS = 20_000;

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

/** Render `html` to a US-Letter PDF. Throws when it cannot. */
export async function renderLetterHtmlToPdf(html: string): Promise<Buffer> {
  const started = clock.nowMs();
  const puppeteer = (await import("puppeteer-core")).default;
  const { checkOperatorUrl } = await import("../providers/ssrf-guard");
  const browser = await puppeteer.launch({
    executablePath: chromiumPath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote"],
  });
  const timer = setTimeout(() => void browser.close().catch(() => undefined), RENDER_TIMEOUT_MS);
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank" || (url.startsWith("https://") && checkOperatorUrl(url).ok)) {
        void req.continue();
      } else {
        void req.abort();
      }
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
    clearTimeout(timer);
    await browser.close().catch(() => undefined);
  }
}
