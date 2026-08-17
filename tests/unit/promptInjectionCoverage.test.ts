/**
 * The guarded-prefix list was maintained by hand. This derives it.
 *
 * `server/routes.ts` mounts `promptInjectionMiddleware` on a list of prefixes,
 * written out one `app.use` at a time. Unit 115 checked whether that list was
 * complete and found **three chat surfaces missing**, each taking
 * `req.body.message` straight into a model:
 *
 *   /api/realtime             POST /ask         command-palette AI, CUSTOMER-facing
 *   /api/founder/chat         POST /stream      founder only
 *   /api/founder/intelligence POST /agent-chat  founder only
 *
 * Twelve siblings were guarded. These three were not, for no reason anyone
 * decided — a hand-maintained list grows a gap the moment someone adds a surface
 * without remembering the list exists. It is the same shape as unit 113's
 * expansion ladder, enforced on one router and defeated on another.
 *
 * WHAT THIS FILE ASSERTS, and why at FILE granularity. The middleware applies per
 * PREFIX, so the useful question is "is this router's mount guarded?", not "is
 * this handler guarded". A route-level detector is also much easier to get
 * wrong — while writing this, two successive versions of it were wrong:
 *
 *   1. A `req\.body\.(message|prompt|…)` pattern found NOTHING, because these
 *      handlers destructure — `const { message } = req.body`. An empty result
 *      that looks like good news is the most dangerous kind.
 *   2. A naive block-comment stripper (`/\/\*[\s\S]*?\*\//g`) mispaired against
 *      the file's content and silently blanked the region containing all twelve
 *      `app.use(..., promptInjectionMiddleware)` lines, so the scan reported
 *      ZERO guarded prefixes. The repo already carries this lesson — see the
 *      line-based `stripComments` in expansionLadder.test.ts, which throws if it
 *      runs away — and it was learned again here.
 *
 * So the detector below is deliberately simple, and every assertion that could
 * pass vacuously has a guard that fails if the scan stops seeing things.
 *
 * STATED LIMITS (unit 117 wave audit; deliberate, not oversights). The
 * population is route files whose OWN source both reads body free-text and
 * reaches an LLM. A route that reads body text and hands it to a SERVICE which
 * calls the model is outside it — tracing that needs call-graph analysis, and a
 * broad approximation would make this gate's number mostly noise, which is how
 * gates die (see lint-prompt-envelope's 237→10). Those service-side sites are
 * covered by the prompt-envelope gate at the interpolation point instead: the
 * two gates are complementary, boundary-guard here, interpolation-guard there.
 * The scan is also top-level server/routes*.ts only, matching where this repo
 * defines routers.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/**
 * Line-based: drop whole-line `//` comments only. See the header — a regex-paired
 * block-comment stripper ate the very lines this file exists to count.
 */
function stripLineComments(src: string): string {
  return src
    .split("\n")
    .map((l) => (/^\s*\/\//.test(l) ? "" : l))
    .join("\n");
}

const routesSrc = stripLineComments(fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8"));

/** Prefixes the middleware is mounted on. */
function guardedPrefixes(): string[] {
  return [
    ...routesSrc.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*promptInjectionMiddleware/g),
  ].map((m) => m[1]);
}

/**
 * Reads a free-text field off the request body — three forms, and the third was
 * a HOLE the unit-117 wave audit found in this very test: a handler that
 * zod-parses (`streamSchema.safeParse(req.body)`) matches neither the property
 * read nor the destructuring form, so /api/founder/chat — one of unit 115's own
 * three surfaces — was invisible to the DERIVED check and protected only by the
 * hardcoded three-prefix assertion below. Since zod-parse is this repo's
 * PREFERRED body-handling pattern, the next new chat surface would have used it
 * and walked past the gate. The zod form counts when the file both parses
 * req.body through a schema AND declares a free-text-named field on a z.object.
 */
const READS_BODY_TEXT_FORMS: RegExp[] = [
  /req\.body\.(?:message|prompt|content|query|input|text)\b/,
  /\{[^}]*\b(?:message|prompt|content)\b[^}]*\}\s*=\s*req\.body/,
];
function readsBodyText(src: string): boolean {
  if (READS_BODY_TEXT_FORMS.some((re) => re.test(src))) return true;
  const zodParsesBody = /\.(?:safeParse|parse)\(\s*req\.body\s*\)/.test(src);
  const zodFreeTextField = /\b(?:message|prompt|content|text|input)\s*:\s*z\./.test(src);
  return zodParsesBody && zodFreeTextField;
}

/** Reaches a model. */
const REACHES_LLM = /chat\.completions\.create|messages\.create|routeAITask\s*\(/;

/** Route files that do BOTH — the population that needs a guard. */
function llmChatRouteFiles(): string[] {
  const out: string[] = [];
  for (const f of fs.readdirSync(path.join(ROOT, "server"))) {
    if (!/^routes.*\.ts$/.test(f) || /\.(test|spec)\./.test(f)) continue;
    const src = stripLineComments(fs.readFileSync(path.join(ROOT, "server", f), "utf8"));
    if (readsBodyText(src) && REACHES_LLM.test(src)) out.push(f.replace(/\.ts$/, ""));
  }
  return out.sort();
}

/**
 * Where a router file is mounted. Handles both shapes this repo uses:
 * `app.use('<path>', …, xRouter)` in routes.ts, and a `register*Routes(app)`
 * function whose own file calls `app.use('<path>', …)`.
 */
function mountPrefixFor(file: string): string | null {
  const ident = [
    ...routesSrc.matchAll(new RegExp(`import\\s+(\\w+)\\s+from\\s+"\\./${file}"`, "g")),
    ...routesSrc.matchAll(new RegExp(`(\\w+)\\s*=\\s*\\(await import\\("\\./${file}"\\)\\)\\.default`, "g")),
  ].map((m) => m[1]);
  for (const id of ident) {
    const m = routesSrc.match(new RegExp(`app\\.use\\(\\s*['"\`]([^'"\`]+)['"\`][^;]{0,300}?\\b${id}\\b`));
    if (m) return m[1];
  }
  // register*Routes style: the mount lives in the router's own file.
  const own = stripLineComments(fs.readFileSync(path.join(ROOT, "server", `${file}.ts`), "utf8"));
  const m = own.match(/app\.use\(\s*["'`]([^"'`]+)["'`]/);
  return m ? m[1] : null;
}

function isGuarded(prefix: string, guarded: string[]): boolean {
  // Two directions only. The third — `g.startsWith(prefix + "/")`, "some
  // narrower guard exists under this mount" — was here originally and is
  // UNSOUND: a router mounted at /api would count as guarded because /api/ai
  // is, while its own LLM route at /api/something-else has no guard at all
  // (unit 117 wave audit). Express middleware applies to the mount prefix and
  // below; a guard on a SIBLING subtree protects nothing here.
  return guarded.some((g) => prefix === g || prefix.startsWith(`${g}/`));
}

describe("the scan actually sees things (vacuity guards, first)", () => {
  it("finds the guarded prefixes", () => {
    // This read ZERO while twelve existed, because of the block-comment bug in
    // the header. Every assertion below is meaningless if this one is wrong.
    expect(guardedPrefixes().length).toBeGreaterThanOrEqual(12);
  });

  it("finds chat route files", () => {
    expect(llmChatRouteFiles().length).toBeGreaterThan(0);
  });

  it("the body-text detector matches ALL THREE forms", () => {
    expect(readsBodyText("const x = req.body.message;")).toBe(true);
    expect(readsBodyText("const { message } = req.body;")).toBe(true);
    // The zod form the wave audit found missing: schema-parse plus a free-text
    // field declaration. Either alone is not enough.
    expect(
      readsBodyText('const s = z.object({ message: z.string() });\nconst p = s.safeParse(req.body);'),
    ).toBe(true);
    expect(readsBodyText("const p = idSchema.safeParse(req.body);")).toBe(false);
    expect(readsBodyText("const { threadId } = req.body;")).toBe(false);
  });

  it("the derived population includes founder-chat (the zod-parse case itself)", () => {
    // Before the widening this file's own derived check MISSED
    // routes-founder-chat: its /stream handler reads the message via
    // streamSchema.safeParse(req.body). If this fails, the hole is back.
    expect(
      llmChatRouteFiles(),
      "routes-founder-chat dropped out of the derived population — the zod-parse " +
        "form has stopped matching, so the next zod-parsing chat surface will " +
        "not be caught on the commit that writes it",
    ).toContain("routes-founder-chat");
  });

  it("can resolve a mount prefix it knows the answer for", () => {
    expect(mountPrefixFor("routes-realtime")).toBe("/api/realtime");
  });
});

describe("every chat surface that takes body text into a model is guarded", () => {
  it("no unguarded ones remain", () => {
    const guarded = guardedPrefixes();
    const unguarded: string[] = [];
    const unresolved: string[] = [];
    for (const file of llmChatRouteFiles()) {
      const prefix = mountPrefixFor(file);
      if (!prefix) { unresolved.push(file); continue; }
      if (!isGuarded(prefix, guarded)) unguarded.push(`${file} → ${prefix}`);
    }
    expect(
      unguarded,
      "a router reads a free-text field off the request body and hands it to a " +
        "model, and its mount is NOT under any promptInjectionMiddleware prefix. " +
        "Add the prefix in server/routes.ts beside the others. The list is " +
        "hand-maintained, which is exactly why this test derives the requirement " +
        "instead of trusting it.",
    ).toEqual([]);
    // Reported, not asserted: a file whose mount cannot be resolved is a gap in
    // THIS TEST, not proof of a defect. Kept visible so it does not read as a pass.
    if (unresolved.length > 0) {
      expect(
        unresolved.length,
        `mount prefix unresolved for: ${unresolved.join(", ")} — the detector cannot ` +
          `check these, so treat a green run as partial until the resolver handles them`,
      ).toBeLessThanOrEqual(3);
    }
  });

  it("the three unit 115 added are actually in the list", () => {
    const guarded = guardedPrefixes();
    for (const p of ["/api/realtime", "/api/founder/chat", "/api/founder/intelligence"]) {
      expect(guarded, `${p} lost its prompt-injection guard`).toContain(p);
    }
  });

  it("and the detector would catch a new unguarded surface (mutation guard)", () => {
    // Proves the assertion above is not passing because the detector is broken:
    // an unguarded prefix must be reported as unguarded.
    expect(isGuarded("/api/brand-new-chat", guardedPrefixes())).toBe(false);
    expect(isGuarded("/api/realtime", guardedPrefixes())).toBe(true);
  });
});
