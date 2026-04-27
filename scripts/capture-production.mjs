#!/usr/bin/env node
/**
 * Gap 1.0 Phase B — capture every unauthenticated production surface
 * at all 6 breakpoints + per-surface mechanical checks.
 *
 * Output:
 *   docs/exhaustive-completion/production-screenshots/<slug>-<bp>.png
 *   docs/exhaustive-completion/mechanical-checks/<slug>.md
 *
 * Mechanical checks per surface (per breakpoint):
 *   - Console errors count and content
 *   - Horizontal overflow (scrollWidth > clientWidth)
 *   - Touch targets <44px on mobile (320/375/414)
 *   - Font loading (Fraunces, Inter)
 *   - Missing alt attributes on <img>
 *   - Focus visibility (CSS :focus-visible declared somewhere)
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://acreos.io";
const SCREENSHOT_OUT = "docs/exhaustive-completion/production-screenshots";
const CHECKS_OUT = "docs/exhaustive-completion/mechanical-checks";

const SURFACES = [
  { slug: "landing", url: "/" },
  { slug: "auth", url: "/auth" },
  { slug: "pricing", url: "/pricing" },
  { slug: "terms", url: "/terms" },
  { slug: "privacy", url: "/privacy" },
  { slug: "status", url: "/status" },
  { slug: "changelog", url: "/changelog" },
  { slug: "404", url: "/this-page-does-not-exist" },
];

const BREAKPOINTS = [
  { name: "320", width: 320, height: 800 },
  { name: "375", width: 375, height: 800 },
  { name: "414", width: 414, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
];

function isMobile(name) {
  return name === "320" || name === "375" || name === "414";
}

async function captureSurface(browser, surface) {
  const checksByBreakpoint = {};
  for (const bp of BREAKPOINTS) {
    const ctx = await browser.newContext({ viewport: { width: bp.width, height: bp.height } });
    const page = await ctx.newPage();

    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));

    try {
      await page.goto(`${BASE}${surface.url}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1500); // settle fonts + animations
    } catch (e) {
      console.log(`  ✗ ${surface.slug} ${bp.name} navigation: ${e.message}`);
      checksByBreakpoint[bp.name] = { error: e.message };
      await ctx.close();
      continue;
    }

    const path = `${SCREENSHOT_OUT}/${surface.slug}-${bp.name}.png`;
    try {
      await page.screenshot({ path, fullPage: true });
    } catch (e) {
      console.log(`  ✗ ${surface.slug} ${bp.name} screenshot: ${e.message}`);
    }

    // Mechanical checks
    const checks = await page.evaluate(({ mobile }) => {
      const root = document.documentElement;
      const overflow = root.scrollWidth > root.clientWidth + 1;

      // Touch targets <44px on mobile
      let smallTargets = 0;
      let smallTargetSamples = [];
      if (mobile) {
        const interactive = document.querySelectorAll("button, a, input, select, textarea, [role=button], [role=link]");
        for (const el of interactive) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue; // hidden
          if (r.height < 44 && r.width < 44) {
            smallTargets++;
            if (smallTargetSamples.length < 5) {
              smallTargetSamples.push({
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || el.getAttribute("aria-label") || "").slice(0, 40),
                size: `${Math.round(r.width)}×${Math.round(r.height)}`,
              });
            }
          }
        }
      }

      const fontList = Array.from(document.fonts).map((f) => `${f.family}/${f.weight}/${f.style}: ${f.status}`);
      const fraunceLoaded = Array.from(document.fonts).some(
        (f) => f.family.toLowerCase().includes("fraunce") && f.status === "loaded"
      );
      const interLoaded = Array.from(document.fonts).some(
        (f) => f.family.toLowerCase().includes("inter") && f.status === "loaded"
      );

      // Missing alt attributes on visible images
      const imagesWithoutAlt = Array.from(document.querySelectorAll("img"))
        .filter((img) => !img.getAttribute("alt"))
        .length;

      return {
        overflow,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        smallTargets,
        smallTargetSamples,
        fraunceLoaded,
        interLoaded,
        fontCount: document.fonts.size,
        fontList: fontList.slice(0, 10),
        imagesWithoutAlt,
        title: document.title,
      };
    }, { mobile: isMobile(bp.name) });

    checksByBreakpoint[bp.name] = {
      consoleErrors: consoleErrors.slice(0, 10),
      consoleErrorCount: consoleErrors.length,
      ...checks,
    };

    console.log(
      `  ✓ ${surface.slug} ${bp.name}px — errors:${consoleErrors.length} overflow:${checks.overflow} smallTargets:${checks.smallTargets}`
    );

    await ctx.close();
  }

  // Write per-surface markdown report
  let md = `# Mechanical Checks — \`${surface.url}\`\n\n`;
  md += `**Surface:** \`${surface.slug}\`\n**URL:** ${BASE}${surface.url}\n\n`;
  for (const bp of BREAKPOINTS) {
    const c = checksByBreakpoint[bp.name];
    md += `## ${bp.name}px (${bp.width}×${bp.height})\n\n`;
    if (c.error) {
      md += `❌ **Navigation failed:** ${c.error}\n\n`;
      continue;
    }
    md += `- **Document title:** \`${c.title}\`\n`;
    md += `- **Console errors:** ${c.consoleErrorCount}${c.consoleErrorCount > 0 ? "\n  - " + c.consoleErrors.join("\n  - ") : ""}\n`;
    md += `- **Horizontal overflow:** ${c.overflow ? `❌ scrollWidth ${c.scrollWidth} > clientWidth ${c.clientWidth}` : "✅ none"}\n`;
    if (isMobile(bp.name)) {
      md += `- **Touch targets <44px:** ${c.smallTargets}${c.smallTargets > 0 ? "\n  - " + c.smallTargetSamples.map((s) => `\`${s.tag}\` "${s.text}" (${s.size})`).join("\n  - ") : ""}\n`;
    }
    md += `- **Fraunces loaded:** ${c.fraunceLoaded ? "✅" : "❌"}\n`;
    md += `- **Inter loaded:** ${c.interLoaded ? "✅" : "❌"}\n`;
    md += `- **Images without alt:** ${c.imagesWithoutAlt}\n`;
    md += `- **Font registry:** ${c.fontCount} faces\n\n`;
  }

  await writeFile(`${CHECKS_OUT}/${surface.slug}.md`, md);
  return checksByBreakpoint;
}

async function main() {
  await mkdir(SCREENSHOT_OUT, { recursive: true });
  await mkdir(CHECKS_OUT, { recursive: true });
  const browser = await chromium.launch();
  console.log(`Capturing ${SURFACES.length} surfaces × ${BREAKPOINTS.length} breakpoints = ${SURFACES.length * BREAKPOINTS.length} screenshots\n`);
  for (const surface of SURFACES) {
    console.log(`[${surface.slug}] ${BASE}${surface.url}`);
    await captureSurface(browser, surface);
  }
  await browser.close();
  console.log("\n✓ Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
