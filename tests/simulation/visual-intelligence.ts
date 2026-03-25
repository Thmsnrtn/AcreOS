/**
 * Layer 5: LLM Visual Intelligence
 *
 * Uses Claude Vision API to analyze screenshots with three modes:
 *   1. Page-by-page analysis — score each page for visual quality
 *   2. Flow analysis — evaluate multi-step user journeys
 *   3. Cross-device comparison — flag inconsistencies across breakpoints
 *
 * Produces structured JSON reports with scores and recommendations.
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ──

interface PageScore {
  page: string;
  overall: number;         // 0–100
  layout: number;          // 0–100
  hierarchy: number;       // 0–100
  consistency: number;     // 0–100
  readability: number;     // 0–100
  issues: string[];
  strengths: string[];
}

interface FlowScore {
  flow: string;
  steps: string[];
  continuity: number;      // 0–100 — visual consistency between steps
  progressClarity: number; // 0–100 — can user tell where they are
  issues: string[];
}

interface DeviceComparison {
  page: string;
  devices: string[];
  layoutShift: "none" | "minor" | "major" | "broken";
  contentParity: number;   // 0–100 — same info accessible on all
  issues: string[];
}

interface VisualReport {
  timestamp: string;
  mode: "pages" | "flows" | "cross-device";
  pages?: PageScore[];
  flows?: FlowScore[];
  comparisons?: DeviceComparison[];
  summary: {
    avgScore: number;
    criticalIssues: string[];
    topStrengths: string[];
  };
}

// ── Screenshot Discovery ──

const SCREENSHOT_DIR = path.resolve(__dirname, "screenshots");

function discoverScreenshots(): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  if (!fs.existsSync(SCREENSHOT_DIR)) return groups;

  const files = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith(".png"));
  for (const file of files) {
    // Group by page name: e.g. "sidebar-missing-dashboard-desktop-chrome.png"
    // Extract the logical page from the filename
    const parts = file.replace(".png", "").split("-");
    const key = parts.slice(0, -1).join("-"); // strip device suffix
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(path.join(SCREENSHOT_DIR, file));
  }
  return groups;
}

function readImageBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString("base64");
}

// ── Claude Vision Client ──

function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for visual intelligence");
  return new Anthropic({ apiKey });
}

// ── Mode 1: Page-by-Page Analysis ──

async function analyzePages(screenshots: Map<string, string[]>): Promise<PageScore[]> {
  const client = createClient();
  const scores: PageScore[] = [];

  // Pick one representative screenshot per page (prefer desktop-chrome)
  const pages = new Map<string, string>();
  for (const [key, files] of screenshots) {
    const desktop = files.find(f => f.includes("desktop-chrome")) || files[0];
    if (desktop) pages.set(key, desktop);
  }

  for (const [pageName, filePath] of pages) {
    if (!fs.existsSync(filePath)) continue;

    const base64 = readImageBase64(filePath);
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: base64 },
          },
          {
            type: "text",
            text: `Analyze this screenshot of a real estate investment platform page "${pageName}".

Score each dimension 0–100 and list issues/strengths. Return ONLY valid JSON:
{
  "overall": <number>,
  "layout": <number>,
  "hierarchy": <number>,
  "consistency": <number>,
  "readability": <number>,
  "issues": ["..."],
  "strengths": ["..."]
}

Dimensions:
- layout: alignment, spacing, grid consistency, no overlapping elements
- hierarchy: clear visual hierarchy, primary actions stand out, logical grouping
- consistency: consistent styling, colors match a system, icons uniform
- readability: text legible, sufficient contrast, appropriate font sizes
- overall: weighted average of all dimensions`,
          },
        ],
      }],
    });

    try {
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const json = JSON.parse(text.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
      scores.push({
        page: pageName,
        overall: json.overall ?? 0,
        layout: json.layout ?? 0,
        hierarchy: json.hierarchy ?? 0,
        consistency: json.consistency ?? 0,
        readability: json.readability ?? 0,
        issues: json.issues ?? [],
        strengths: json.strengths ?? [],
      });
    } catch {
      scores.push({
        page: pageName,
        overall: 0, layout: 0, hierarchy: 0, consistency: 0, readability: 0,
        issues: ["Failed to parse Claude Vision response"],
        strengths: [],
      });
    }
  }

  return scores;
}

// ── Mode 2: Flow Analysis ──

const FLOWS: { name: string; steps: string[] }[] = [
  {
    name: "lead-to-deal",
    steps: ["dashboard", "leads", "deals", "deal-feed"],
  },
  {
    name: "property-evaluation",
    steps: ["properties", "deal-feed", "finance"],
  },
  {
    name: "portfolio-review",
    steps: ["dashboard", "portfolio-health", "analytics", "freedom-meter"],
  },
];

async function analyzeFlows(screenshots: Map<string, string[]>): Promise<FlowScore[]> {
  const client = createClient();
  const results: FlowScore[] = [];

  for (const flow of FLOWS) {
    // Gather screenshots for each step in the flow
    const stepImages: { step: string; base64: string }[] = [];
    for (const step of flow.steps) {
      // Find a screenshot matching this step
      for (const [key, files] of screenshots) {
        if (key.includes(step)) {
          const desktop = files.find(f => f.includes("desktop-chrome")) || files[0];
          if (desktop && fs.existsSync(desktop)) {
            stepImages.push({ step, base64: readImageBase64(desktop) });
            break;
          }
        }
      }
    }

    if (stepImages.length < 2) {
      results.push({
        flow: flow.name,
        steps: flow.steps,
        continuity: 0,
        progressClarity: 0,
        issues: [`Only ${stepImages.length} of ${flow.steps.length} steps had screenshots`],
      });
      continue;
    }

    const content: Anthropic.Messages.ContentBlockParam[] = [];
    for (const img of stepImages) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: img.base64 },
      });
      content.push({
        type: "text",
        text: `Step: ${img.step}`,
      });
    }

    content.push({
      type: "text",
      text: `These screenshots show a user flow called "${flow.name}" through a real estate investment platform.
Steps in order: ${flow.steps.join(" → ")}

Evaluate the visual continuity and progress clarity across these steps. Return ONLY valid JSON:
{
  "continuity": <0-100>,
  "progressClarity": <0-100>,
  "issues": ["..."]
}

- continuity: Do the screens feel like the same app? Consistent nav, colors, patterns?
- progressClarity: Can the user tell where they are in the flow? Is there breadcrumb/highlight/state change?`,
    });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [{ role: "user", content }],
    });

    try {
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const json = JSON.parse(text.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
      results.push({
        flow: flow.name,
        steps: flow.steps,
        continuity: json.continuity ?? 0,
        progressClarity: json.progressClarity ?? 0,
        issues: json.issues ?? [],
      });
    } catch {
      results.push({
        flow: flow.name,
        steps: flow.steps,
        continuity: 0,
        progressClarity: 0,
        issues: ["Failed to parse Claude Vision response"],
      });
    }
  }

  return results;
}

// ── Mode 3: Cross-Device Comparison ──

async function analyzeCrossDevice(screenshots: Map<string, string[]>): Promise<DeviceComparison[]> {
  const client = createClient();
  const results: DeviceComparison[] = [];

  // Group screenshots by page across devices
  const pageDevices = new Map<string, { device: string; path: string }[]>();
  for (const [key, files] of screenshots) {
    for (const file of files) {
      const basename = path.basename(file, ".png");
      // Extract page and device from filename pattern: {test-name}-{device}
      const devicePatterns = [
        "desktop-chrome", "desktop-firefox", "desktop-1280", "desktop-ultrawide",
        "ipad-portrait", "ipad-landscape", "ipad-pro",
        "iphone-14", "iphone-se", "pixel-5", "galaxy-s9",
        "tiny-phone", "short-wide",
      ];
      let matchedDevice = "unknown";
      let pageName = basename;
      for (const dp of devicePatterns) {
        if (basename.endsWith(`-${dp}`)) {
          matchedDevice = dp;
          pageName = basename.slice(0, -(dp.length + 1));
          break;
        }
      }

      if (!pageDevices.has(pageName)) pageDevices.set(pageName, []);
      pageDevices.get(pageName)!.push({ device: matchedDevice, path: file });
    }
  }

  // Compare pages that have screenshots from multiple devices
  for (const [pageName, deviceList] of pageDevices) {
    if (deviceList.length < 2) continue;

    // Pick up to 4 device screenshots to keep token usage reasonable
    const selected = deviceList.slice(0, 4);
    const content: Anthropic.Messages.ContentBlockParam[] = [];

    for (const item of selected) {
      if (!fs.existsSync(item.path)) continue;
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: readImageBase64(item.path) },
      });
      content.push({
        type: "text",
        text: `Device: ${item.device}`,
      });
    }

    content.push({
      type: "text",
      text: `These screenshots show the same page "${pageName}" across different devices/viewports.

Compare them for responsive design quality. Return ONLY valid JSON:
{
  "layoutShift": "none" | "minor" | "major" | "broken",
  "contentParity": <0-100>,
  "issues": ["..."]
}

- layoutShift: How much does the layout change unexpectedly across devices?
- contentParity: Is the same information accessible on all devices? (100 = identical info)
- issues: List any problems (truncation, overlap, missing elements, unreadable text)`,
    });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      messages: [{ role: "user", content }],
    });

    try {
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const json = JSON.parse(text.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
      results.push({
        page: pageName,
        devices: selected.map(s => s.device),
        layoutShift: json.layoutShift ?? "unknown",
        contentParity: json.contentParity ?? 0,
        issues: json.issues ?? [],
      });
    } catch {
      results.push({
        page: pageName,
        devices: selected.map(s => s.device),
        layoutShift: "broken",
        contentParity: 0,
        issues: ["Failed to parse Claude Vision response"],
      });
    }
  }

  return results;
}

// ── Report Generation ──

function buildReport(
  mode: "pages" | "flows" | "cross-device",
  data: { pages?: PageScore[]; flows?: FlowScore[]; comparisons?: DeviceComparison[] },
): VisualReport {
  let avgScore = 0;
  const criticalIssues: string[] = [];
  const topStrengths: string[] = [];

  if (mode === "pages" && data.pages) {
    avgScore = data.pages.length > 0
      ? Math.round(data.pages.reduce((s, p) => s + p.overall, 0) / data.pages.length)
      : 0;
    for (const p of data.pages) {
      if (p.overall < 60) criticalIssues.push(`${p.page}: overall score ${p.overall}/100`);
      topStrengths.push(...p.strengths.slice(0, 1).map(s => `${p.page}: ${s}`));
    }
  }

  if (mode === "flows" && data.flows) {
    const scores = data.flows.map(f => (f.continuity + f.progressClarity) / 2);
    avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    for (const f of data.flows) {
      if (f.continuity < 60) criticalIssues.push(`${f.flow}: poor visual continuity (${f.continuity})`);
      criticalIssues.push(...f.issues.slice(0, 1).map(i => `${f.flow}: ${i}`));
    }
  }

  if (mode === "cross-device" && data.comparisons) {
    avgScore = data.comparisons.length > 0
      ? Math.round(data.comparisons.reduce((s, c) => s + c.contentParity, 0) / data.comparisons.length)
      : 0;
    for (const c of data.comparisons) {
      if (c.layoutShift === "broken" || c.layoutShift === "major") {
        criticalIssues.push(`${c.page}: ${c.layoutShift} layout shift across ${c.devices.join(", ")}`);
      }
    }
  }

  return {
    timestamp: new Date().toISOString(),
    mode,
    ...data,
    summary: {
      avgScore,
      criticalIssues: criticalIssues.slice(0, 10),
      topStrengths: topStrengths.slice(0, 5),
    },
  };
}

// ── Main Entry Points ──

export async function runPageAnalysis(): Promise<VisualReport> {
  const screenshots = discoverScreenshots();
  const pages = await analyzePages(screenshots);
  return buildReport("pages", { pages });
}

export async function runFlowAnalysis(): Promise<VisualReport> {
  const screenshots = discoverScreenshots();
  const flows = await analyzeFlows(screenshots);
  return buildReport("flows", { flows });
}

export async function runCrossDeviceAnalysis(): Promise<VisualReport> {
  const screenshots = discoverScreenshots();
  const comparisons = await analyzeCrossDevice(screenshots);
  return buildReport("cross-device", { comparisons });
}

export async function runFullVisualIntelligence(): Promise<VisualReport[]> {
  const reports = await Promise.allSettled([
    runPageAnalysis(),
    runFlowAnalysis(),
    runCrossDeviceAnalysis(),
  ]);

  return reports
    .filter((r): r is PromiseFulfilledResult<VisualReport> => r.status === "fulfilled")
    .map(r => r.value);
}

// ── CLI Entry ──

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] || "all";
  const REPORT_DIR = path.resolve(__dirname, "reports");
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

  (async () => {
    console.log(`🔍 Running visual intelligence (mode: ${mode})...`);

    let reports: VisualReport[];
    switch (mode) {
      case "pages":
        reports = [await runPageAnalysis()];
        break;
      case "flows":
        reports = [await runFlowAnalysis()];
        break;
      case "cross-device":
        reports = [await runCrossDeviceAnalysis()];
        break;
      default:
        reports = await runFullVisualIntelligence();
    }

    for (const report of reports) {
      const filename = `visual-${report.mode}-${Date.now()}.json`;
      fs.writeFileSync(path.join(REPORT_DIR, filename), JSON.stringify(report, null, 2));
      console.log(`  ${report.mode}: avg score ${report.summary.avgScore}/100 → ${filename}`);
      if (report.summary.criticalIssues.length > 0) {
        console.log(`  ⚠ Critical: ${report.summary.criticalIssues.join("; ")}`);
      }
    }

    console.log("✅ Visual intelligence complete.");
  })();
}
