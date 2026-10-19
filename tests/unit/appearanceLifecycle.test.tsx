// @vitest-environment jsdom
/**
 * The appearance lifecycle, exercised through the REAL providers in a DOM.
 *
 * Covers the behaviour the Fieldstone redesign specified, not the source:
 *   - a fresh browser lands on Fieldstone + Match device and follows the OS
 *     live (no reload); an explicit Light/Dark ignores later OS changes;
 *   - a stored retired colorway boots migrated, and the next write drops the
 *     retired fontPairing/density/motion keys from storage;
 *   - a SLOW server read cannot undo a choice made after load, but still
 *     supplies fields the person did not touch;
 *   - adjacent colorway + mode changes batch into ONE PATCH carrying both;
 *   - logged-out pages make no preferences call at all;
 *   - the accessibility provider alone owns data-density / data-motion: the
 *     reading density survives the theme provider mounting (it used to be
 *     overwritten with "adaptive"), device reduced-motion applies without any
 *     setting, and a legacy "reduced" choice is carried over.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const apiRequestSpy = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...a: unknown[]) => apiRequestSpy(...(a as [])) }));
vi.mock("@/lib/clientLogger", () => ({ clientLogger: { info() {}, warn() {}, error() {}, debug() {} } }));

import { ThemeProvider, useTheme } from "../../client/src/contexts/theme-context";
import { AccessibilityProvider } from "../../client/src/contexts/accessibility-context";

// ── a controllable matchMedia ────────────────────────────────────────────────
const media: Record<string, { matches: boolean; listeners: Set<() => void> }> = {};
function mq(query: string) {
  media[query] ??= { matches: false, listeners: new Set() };
  const entry = media[query];
  return {
    get matches() { return entry.matches; },
    media: query,
    addEventListener: (_: string, fn: () => void) => entry.listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => entry.listeners.delete(fn),
  };
}
function setDevice(query: string, matches: boolean) {
  media[query] ??= { matches, listeners: new Set() };
  media[query].matches = matches;
  for (const fn of media[query].listeners) fn();
}
const DARK_Q = "(prefers-color-scheme: dark)";
const MOTION_Q = "(prefers-reduced-motion: reduce)";

let container: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useTheme> | null = null;
function Probe() {
  api = useTheme();
  return null;
}
async function mount() {
  await act(async () => {
    root.render(
      <ThemeProvider>
        <AccessibilityProvider>
          <Probe />
        </AccessibilityProvider>
      </ThemeProvider>,
    );
  });
}
const html = () => document.documentElement;
const stored = () => JSON.parse(localStorage.getItem("acreos-theme-config") ?? "null");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  for (const k of Object.keys(media)) delete media[k];
  (window as unknown as { matchMedia: typeof mq }).matchMedia = mq;
  localStorage.clear();
  document.cookie.split(";").forEach((c) => {
    document.cookie = c.split("=")[0].trim() + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });
  html().className = "";
  for (const a of ["data-theme", "data-density", "data-motion"]) html().removeAttribute(a);
  apiRequestSpy.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("defaults and device following", () => {
  it("a fresh browser is Fieldstone + Match device and follows the OS live", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await mount();
    expect(api!.themeConfig).toEqual({ theme: "fieldstone", mode: "auto" });
    expect(html().getAttribute("data-theme")).toBe("fieldstone");
    expect(html().classList.contains("dark")).toBe(false);
    await act(async () => setDevice(DARK_Q, true));
    expect(html().classList.contains("dark"), "Match device must follow the OS without a reload").toBe(true);
    // Logged out (no session cookie): no preferences call was made.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an explicit Light wins over later OS changes until Match device is chosen", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await mount();
    await act(async () => api!.setThemeConfig({ mode: "light" }));
    await act(async () => setDevice(DARK_Q, true));
    expect(html().classList.contains("dark")).toBe(false);
    await act(async () => api!.setThemeConfig({ mode: "auto" }));
    expect(html().classList.contains("dark")).toBe(true);
  });
});

describe("stored values and migration", () => {
  it("boots a retired colorway migrated, keeps its mode, and drops retired keys on write", async () => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem("acreos-theme-config", JSON.stringify({ theme: "homestead", mode: "dark", fontPairing: "modern", density: "compact", motion: "full" }));
    await mount();
    expect(api!.themeConfig).toEqual({ theme: "bedrock", mode: "dark" });
    expect(html().getAttribute("data-theme")).toBe("bedrock");
    expect(html().classList.contains("dark")).toBe(true);
    await act(async () => api!.setThemeConfig({ theme: "meridian" }));
    expect(stored()).toEqual({ theme: "meridian", mode: "dark" });
  });

  it("an existing Bedrock selection stays Bedrock", async () => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem("acreos-theme-config", JSON.stringify({ theme: "bedrock", mode: "light" }));
    await mount();
    expect(html().getAttribute("data-theme")).toBe("bedrock");
  });

  it("rejects an invalid value instead of storing it", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await mount();
    await act(async () => api!.setThemeConfig({ theme: "quarry" as never }));
    // A retired id passed in is normalized, never stored as itself.
    expect(api!.themeConfig.theme).toBe("fieldstone");
    await act(async () => api!.setThemeConfig({ theme: "neon" as never }));
    expect(api!.themeConfig.theme).toBe("fieldstone");
  });
});

describe("server sync", () => {
  it("a slow server read cannot undo a fresh choice, but fills untouched fields", async () => {
    document.cookie = "__session=e2e; path=/";
    let resolveRead!: (v: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((r) => { resolveRead = r; })),
    );
    await mount();
    // The person picks Bedrock while the GET is still in flight.
    await act(async () => api!.setThemeConfig({ theme: "bedrock" }));
    await act(async () => {
      resolveRead({ ok: true, status: 200, json: async () => ({ theme: "meridian", mode: "dark" }) });
    });
    expect(api!.themeConfig.theme, "the late server read overwrote a fresh choice").toBe("bedrock");
    expect(api!.themeConfig.mode, "an untouched field still hydrates from the server").toBe("dark");
    expect(stored()).toEqual({ theme: "bedrock", mode: "dark" });
  });

  it("adjacent colorway + mode changes batch into one PATCH carrying both", async () => {
    document.cookie = "__session=e2e; path=/";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    await mount();
    await act(async () => {
      api!.setThemeConfig({ theme: "meridian" });
      api!.setThemeConfig({ mode: "dark" });
    });
    expect(apiRequestSpy).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(apiRequestSpy).toHaveBeenCalledTimes(1);
    expect(apiRequestSpy).toHaveBeenCalledWith("PATCH", "/api/me/preferences", { theme: "meridian", mode: "dark" });
  });

  it("a server row holding a retired colorway hydrates as its successor", async () => {
    document.cookie = "__session=e2e; path=/";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ theme: "nocturne", mode: "light" }) })));
    await mount();
    expect(api!.themeConfig).toEqual({ theme: "fieldstone", mode: "light" });
  });
});

describe("accessibility owns reading density and motion", () => {
  it("the reading density survives the theme provider mounting", async () => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem("acreos:accessibility-prefs:v1", JSON.stringify({ readingDensity: "spacious" }));
    await mount();
    expect(html().getAttribute("data-density")).toBe("spacious");
  });

  it("device reduced-motion applies with no setting, and follows the device live", async () => {
    vi.stubGlobal("fetch", vi.fn());
    setDevice(MOTION_Q, true);
    await mount();
    expect(html().getAttribute("data-motion")).toBe("reduced");
    await act(async () => setDevice(MOTION_Q, false));
    expect(html().getAttribute("data-motion")).toBe("full");
  });

  it("a legacy Appearance 'reduced' motion choice is carried into Accessibility", async () => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem("acreos-theme-config", JSON.stringify({ theme: "bedrock", mode: "auto", motion: "reduced" }));
    await mount();
    expect(html().getAttribute("data-motion")).toBe("reduced");
    expect(JSON.parse(localStorage.getItem("acreos:accessibility-prefs:v1")!).reduceMotion).toBe(true);
  });
});
