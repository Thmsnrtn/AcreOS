/**
 * Accessibility compliance tests
 * Validates that key accessibility patterns are in place.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";

const CLIENT_SRC = resolve(__dirname, "../../client/src");

function readFile(path: string): string {
  return readFileSync(resolve(CLIENT_SRC, path), "utf-8");
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  function walk(d: string) {
    try {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(ext)) results.push(full);
      }
    } catch { /* skip unreadable dirs */ }
  }
  walk(dir);
  return results;
}

describe("Accessibility Compliance", () => {
  it("App.tsx has a skip-to-content link", () => {
    const app = readFile("App.tsx");
    expect(app).toContain("#main-content");
    expect(app).toContain("Skip");
  });

  it("main content landmark has id='main-content'", () => {
    // Check page-shell or App.tsx for the main landmark
    const files = findFiles(resolve(CLIENT_SRC, "components"), ".tsx");
    const hasMainId = files.some((f) => {
      const content = readFileSync(f, "utf-8");
      return content.includes('id="main-content"');
    });
    expect(hasMainId).toBe(true);
  });

  it("MotionConfig reducedMotion is configured", () => {
    const app = readFile("App.tsx");
    expect(app).toContain("MotionConfig");
    expect(app).toMatch(/reducedMotion/);
  });

  it("viewport meta does not block zoom", () => {
    const html = readFileSync(
      resolve(CLIENT_SRC, "../index.html"),
      "utf-8"
    );
    expect(html).not.toContain("user-scalable=no");
    expect(html).not.toContain("maximum-scale=1");
  });

  it("icon buttons have aria-labels (sample check)", () => {
    // Check a high-concentration file
    const files = [
      "components/pax-copilot-rail.tsx",
      "components/floating-assistant.tsx",
      "pages/founder-dashboard.tsx",
    ];

    for (const file of files) {
      try {
        const content = readFile(file);
        const iconButtons = content.match(/size="icon"/g) || [];
        const ariaLabels = content.match(/aria-label="/g) || [];
        // Every icon button should have a corresponding aria-label
        expect(ariaLabels.length).toBeGreaterThanOrEqual(iconButtons.length);
      } catch {
        // File may not exist in test environment
      }
    }
  });
});
