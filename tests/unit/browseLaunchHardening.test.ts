/**
 * R-14 / F-1 — Chromium is launched without the app's secrets, with process
 * isolation, and with the sandbox on unless an operator opts out explicitly.
 *
 * Behavioural tests of the two exported helpers, plus a source census of
 * browserAutomation.ts (comments stripped first, so a comment recording what
 * was removed cannot satisfy or trip a predicate).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { stripComments } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

// browserAutomation imports the db; the helpers under test are pure.
vi.mock("../../server/db", () => ({ db: {} }));

import { isChromiumSandboxDisabled, scrubbedBrowserEnv } from "../../server/services/browserAutomation";

const SRC = readFileSync(path.join(__dirname, "../../server/services/browserAutomation.ts"), "utf8");
const CODE = stripComments(SRC);

describe("scrubbedBrowserEnv", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/node",
    PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium",
    DATABASE_URL: "postgres://secret",
    FIELD_ENCRYPTION_KEY: "k".repeat(64),
    STRIPE_SECRET: "sk_live_x",
    OPENAI_API_KEY: "sk-x",
    SESSION_TOKEN: "t",
  } as NodeJS.ProcessEnv;

  it("drops every non-allowlisted variable", () => {
    const out = scrubbedBrowserEnv(source);
    expect(Object.keys(out).sort()).toEqual(["HOME", "PATH", "PUPPETEER_EXECUTABLE_PATH"]);
    for (const k of ["DATABASE_URL", "FIELD_ENCRYPTION_KEY", "STRIPE_SECRET", "OPENAI_API_KEY", "SESSION_TOKEN"]) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it("defaults HOME to /home/node when absent", () => {
    expect(scrubbedBrowserEnv({ PATH: "/usr/bin" } as NodeJS.ProcessEnv).HOME).toBe("/home/node");
  });
});

describe("isChromiumSandboxDisabled", () => {
  it("is false unless the value is exactly \"1\"", () => {
    expect(isChromiumSandboxDisabled({} as NodeJS.ProcessEnv)).toBe(false);
    for (const v of ["0", "true", "yes", "", " 1", "1 "]) {
      expect(isChromiumSandboxDisabled({ ACREOS_CHROMIUM_NO_SANDBOX: v } as NodeJS.ProcessEnv), v).toBe(false);
    }
    expect(isChromiumSandboxDisabled({ ACREOS_CHROMIUM_NO_SANDBOX: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("browserAutomation.ts source census", () => {
  it("has no --single-process or --no-zygote", () => {
    expect(CODE).not.toContain("--single-process");
    expect(CODE).not.toContain("--no-zygote");
  });

  it("passes --no-sandbox only behind the escape hatch", () => {
    const idx = CODE.indexOf("--no-sandbox");
    expect(idx).toBeGreaterThan(-1);
    const before = CODE.slice(Math.max(0, idx - 400), idx);
    expect(before).toContain("isChromiumSandboxDisabled()");
  });

  it("launches with the scrubbed env", () => {
    expect(CODE).toMatch(/env:\s*scrubbedBrowserEnv\(\)/);
  });

  it("has no fail-open request path and uses evaluateBrowseRequest", () => {
    expect(SRC).not.toContain("Request check error, allowing");
    expect(CODE).toContain("evaluateBrowseRequest(reqUrl)");
    // The handler's catch must not call continue().
    const start = CODE.indexOf('page.on("request"');
    const end = CODE.indexOf("page.goto(", start);
    const handler = CODE.slice(start, end);
    const catchAt = handler.indexOf("catch (err)");
    expect(catchAt).toBeGreaterThan(-1);
    expect(handler.slice(catchAt)).not.toContain(".continue(");
  });
});
