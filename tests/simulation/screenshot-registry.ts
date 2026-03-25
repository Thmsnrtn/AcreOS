/**
 * Screenshot Registry
 *
 * Indexes all simulation screenshots, groups by page/device/layer,
 * and generates an HTML gallery for visual review.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ──

interface ScreenshotEntry {
  path: string;
  filename: string;
  layer: string;       // "layout" | "perceptual" | "behavioral" | "cognitive" | "visual" | "other"
  page: string;        // extracted page name
  device: string;      // extracted device name
  timestamp: number;   // file mtime
}

interface RegistryIndex {
  generated: string;
  totalScreenshots: number;
  byLayer: Record<string, ScreenshotEntry[]>;
  byPage: Record<string, ScreenshotEntry[]>;
  byDevice: Record<string, ScreenshotEntry[]>;
}

// ── Constants ──

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");
const REPORT_DIR = path.resolve(__dirname, "reports");

const DEVICE_PATTERNS = [
  "desktop-chrome", "desktop-firefox", "desktop-1280", "desktop-ultrawide",
  "ipad-portrait", "ipad-landscape", "ipad-pro",
  "iphone-14", "iphone-se", "pixel-5", "galaxy-s9",
  "tiny-phone", "short-wide",
];

const LAYER_PREFIXES: Record<string, string> = {
  "sidebar-": "layout",
  "overflow-": "layout",
  "artifact-": "layout",
  "nav-error-": "layout",
  "perceptual-": "perceptual",
  "behavioral-": "behavioral",
  "cognitive-": "cognitive",
  "visual-": "visual",
};

// ── Registry Builder ──

function detectLayer(filename: string): string {
  for (const [prefix, layer] of Object.entries(LAYER_PREFIXES)) {
    if (filename.startsWith(prefix)) return layer;
  }
  return "other";
}

function detectDevice(filename: string): string {
  for (const dp of DEVICE_PATTERNS) {
    if (filename.includes(dp)) return dp;
  }
  return "unknown";
}

function extractPage(filename: string, layer: string, device: string): string {
  let name = filename.replace(".png", "");
  // Strip known layer prefixes
  for (const prefix of Object.keys(LAYER_PREFIXES)) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  // Strip device suffix
  if (device !== "unknown") {
    const idx = name.lastIndexOf(`-${device}`);
    if (idx > 0) name = name.slice(0, idx);
  }
  return name || "unknown";
}

export function buildRegistry(): RegistryIndex {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    return { generated: new Date().toISOString(), totalScreenshots: 0, byLayer: {}, byPage: {}, byDevice: {} };
  }

  const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith(".png"));
  const entries: ScreenshotEntry[] = [];

  for (const file of files) {
    const fullPath = path.join(SCREENSHOT_DIR, file);
    const stat = fs.statSync(fullPath);
    const layer = detectLayer(file);
    const device = detectDevice(file);
    const page = extractPage(file, layer, device);

    entries.push({
      path: fullPath,
      filename: file,
      layer,
      page,
      device,
      timestamp: stat.mtimeMs,
    });
  }

  // Group by various dimensions
  const byLayer: Record<string, ScreenshotEntry[]> = {};
  const byPage: Record<string, ScreenshotEntry[]> = {};
  const byDevice: Record<string, ScreenshotEntry[]> = {};

  for (const entry of entries) {
    (byLayer[entry.layer] ??= []).push(entry);
    (byPage[entry.page] ??= []).push(entry);
    (byDevice[entry.device] ??= []).push(entry);
  }

  return {
    generated: new Date().toISOString(),
    totalScreenshots: entries.length,
    byLayer,
    byPage,
    byDevice,
  };
}

// ── HTML Gallery Generator ──

export function generateGallery(registry: RegistryIndex): string {
  const relPath = (absPath: string) => path.relative(REPORT_DIR, absPath);

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AcreOS Simulation Screenshot Gallery</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #fff; }
    .meta { color: #888; font-size: 0.85rem; margin-bottom: 2rem; }
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .tab { padding: 0.5rem 1rem; border-radius: 6px; background: #1a1a1a; border: 1px solid #333; cursor: pointer; font-size: 0.85rem; color: #ccc; }
    .tab.active { background: #2563eb; border-color: #2563eb; color: white; }
    .section { margin-bottom: 2rem; }
    .section-title { font-size: 1.1rem; margin-bottom: 1rem; color: #93c5fd; border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
    .card { background: #1a1a1a; border-radius: 8px; overflow: hidden; border: 1px solid #333; }
    .card img { width: 100%; height: auto; display: block; }
    .card .label { padding: 0.75rem; font-size: 0.8rem; }
    .card .label .name { color: #fff; font-weight: 500; }
    .card .label .meta-info { color: #888; font-size: 0.75rem; margin-top: 0.25rem; }
    .empty { color: #666; font-style: italic; padding: 2rem; text-align: center; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .stat { background: #1a1a1a; border-radius: 8px; padding: 1rem; border: 1px solid #333; text-align: center; }
    .stat .number { font-size: 1.5rem; font-weight: 700; color: #2563eb; }
    .stat .label { font-size: 0.75rem; color: #888; margin-top: 0.25rem; }
  </style>
</head>
<body>
  <h1>AcreOS Simulation Screenshot Gallery</h1>
  <p class="meta">Generated ${registry.generated} — ${registry.totalScreenshots} screenshots</p>

  <div class="stats">
    <div class="stat">
      <div class="number">${registry.totalScreenshots}</div>
      <div class="label">Total Screenshots</div>
    </div>
    <div class="stat">
      <div class="number">${Object.keys(registry.byLayer).length}</div>
      <div class="label">Test Layers</div>
    </div>
    <div class="stat">
      <div class="number">${Object.keys(registry.byPage).length}</div>
      <div class="label">Pages Captured</div>
    </div>
    <div class="stat">
      <div class="number">${Object.keys(registry.byDevice).length}</div>
      <div class="label">Devices</div>
    </div>
  </div>
`;

  // By Layer sections
  html += `<h2 style="margin-bottom: 1rem; color: #93c5fd;">By Layer</h2>\n`;
  for (const [layer, entries] of Object.entries(registry.byLayer).sort()) {
    html += `<div class="section">
  <div class="section-title">${layer} (${entries.length})</div>
  <div class="grid">\n`;
    for (const entry of entries.sort((a, b) => a.filename.localeCompare(b.filename))) {
      html += `    <div class="card">
      <img src="${relPath(entry.path)}" alt="${entry.filename}" loading="lazy" />
      <div class="label">
        <div class="name">${entry.page}</div>
        <div class="meta-info">${entry.device} — ${entry.layer}</div>
      </div>
    </div>\n`;
    }
    html += `  </div>\n</div>\n`;
  }

  // By Device sections
  html += `<h2 style="margin: 2rem 0 1rem; color: #93c5fd;">By Device</h2>\n`;
  for (const [device, entries] of Object.entries(registry.byDevice).sort()) {
    html += `<div class="section">
  <div class="section-title">${device} (${entries.length})</div>
  <div class="grid">\n`;
    for (const entry of entries.sort((a, b) => a.filename.localeCompare(b.filename))) {
      html += `    <div class="card">
      <img src="${relPath(entry.path)}" alt="${entry.filename}" loading="lazy" />
      <div class="label">
        <div class="name">${entry.page}</div>
        <div class="meta-info">${entry.layer}</div>
      </div>
    </div>\n`;
    }
    html += `  </div>\n</div>\n`;
  }

  html += `</body>\n</html>`;
  return html;
}

// ── CLI Entry ──

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  console.log("📸 Building screenshot registry...");
  const registry = buildRegistry();

  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  // Write JSON index
  fs.writeFileSync(
    path.join(REPORT_DIR, "screenshot-registry.json"),
    JSON.stringify(registry, null, 2),
  );

  // Write HTML gallery
  const gallery = generateGallery(registry);
  fs.writeFileSync(path.join(REPORT_DIR, "gallery.html"), gallery);

  console.log(`  ${registry.totalScreenshots} screenshots indexed`);
  console.log(`  ${Object.keys(registry.byLayer).length} layers, ${Object.keys(registry.byPage).length} pages, ${Object.keys(registry.byDevice).length} devices`);
  console.log(`  Gallery: tests/simulation/reports/gallery.html`);
  console.log("✅ Registry complete.");
}
