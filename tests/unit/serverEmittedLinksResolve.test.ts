/**
 * The server told customers to open pages that do not exist.
 *
 * `GET /api/today` — the customer's FIRST screen — pushes priority cards with an
 * `actionUrl` the client navigates to. Two of them pointed at routes with no
 * `<Route>` in App.tsx:
 *
 *   - **`/evening-review`** — *"Open the Evening Review dashboard…"*.
 *     `/evening-review` and `/night-cap` both rendered `EveningReviewPage`, and
 *     the Lens-4 sweep removed both **and deleted the page file**, on the
 *     grounds that *"neither was linked from any nav surface"*. This card was
 *     the link nobody found.
 *   - **`/data-intelligence`** — *"View County Data"*. County intelligence lives
 *     at `/counties`.
 *
 * Both are **fallback** cards: they fire when the customer has nothing else
 * going on, so the quietest, newest accounts got the broken buttons.
 *
 * The founder plane had four more, including two that page a human:
 * `/admin/alerts` and `/founder/intelligence` in the weekly digest email,
 * `/founder/inbox` beside them, and `/founder/dlq` as an action-card deeplink —
 * with `/founder/intelligence` also being the URL an **on-call push
 * notification** opened. A founder woken at 3am by a critical alert tapped
 * through to NotFound.
 *
 * WHY THIS CLASS EXISTS AND KEEPS RECURRING. Deleting a page is a client-side
 * change, and it is done thoroughly: the route goes, the lazy import goes, the
 * file goes, and a comment records why. **Nobody greps the server.** The link
 * lives in a job, a briefing builder or a push payload, and nothing type-checks
 * a string against the router. Six of them accumulated across three separate,
 * individually careful deletions.
 *
 * WHAT THIS FILE DOES. Extracts every route path declared in App.tsx, then every
 * client path the server emits as a destination — `actionUrl`, `link`,
 * `deeplink`, `url`, `href`, `ctaHref` — and requires each to resolve. Redirects
 * count: a `<Route>` that redirects is a real destination.
 *
 * NOT a URL-shape checker. It answers exactly one question — *can the person who
 * receives this actually get there* — which is the question nobody was asking.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Line-based comment stripping, so a note ABOUT a dead link is not a link. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

/** Every path App.tsx declares a <Route> for, including redirect-only ones. */
function declaredRoutes(): Set<string> {
  const app = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");
  return new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));
}

/**
 * Does a concrete path resolve against the declared routes?
 *
 * Parameterised routes are matched segment-wise, so `/counties/7` resolves
 * against `/counties/:id`. Anything the server emits with a `:param` still in it
 * is a template the caller substitutes, and is checked as its own pattern.
 */
function resolves(target: string, routes: Set<string>): boolean {
  if (routes.has(target)) return true;
  const want = target.split("?")[0].split("#")[0].replace(/\/$/, "");
  if (routes.has(want)) return true;
  const wantParts = want.split("/").filter(Boolean);
  for (const route of routes) {
    const parts = route.split("/").filter(Boolean);
    if (parts.length !== wantParts.length) continue;
    if (parts.every((p, i) => p.startsWith(":") || p === wantParts[i])) return true;
  }
  return false;
}

/** Fields whose value is a place the RECIPIENT is sent. */
const DESTINATION_FIELDS = /\b(actionUrl|deeplink|deepLink|ctaHref|ctaUrl|linkUrl)\s*:\s*"(\/[^"]*)"/g;

/**
 * `link:`, `url:` and `href:` are deliberately scanned separately and narrowed
 * to `/founder`-and-customer app paths, because those three names are also used
 * for API endpoints, webhook targets and external URLs. A checker that flagged
 * `url: "/api/…"` would cry wolf, and a checker that cries wolf gets deleted.
 */
const LOOSE_FIELDS = /\b(link|url|href)\s*:\s*"(\/[^"]*)"/g;
const NOT_A_PAGE = /^\/(api|webhook|assets|static|uploads|public)\b/;

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !/\.test\.|\.spec\./.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, "server"));
  return out;
}

interface Emitted {
  where: string;
  target: string;
}

function emittedLinks(): Emitted[] {
  const out: Emitted[] = [];
  for (const abs of serverFiles()) {
    const src = stripComments(fs.readFileSync(abs, "utf8"));
    const rel = path.relative(ROOT, abs);
    for (const re of [DESTINATION_FIELDS, LOOSE_FIELDS]) {
      re.lastIndex = 0;
      for (const m of src.matchAll(re)) {
        const target = m[2];
        if (NOT_A_PAGE.test(target)) continue;
        if (target === "/") continue;
        const line = src.slice(0, m.index).split("\n").length;
        out.push({ where: `${rel}:${line}`, target });
      }
    }
  }
  return out;
}

describe("every client path the server sends someone to actually resolves", () => {
  const routes = declaredRoutes();
  const links = emittedLinks();

  it("finds both sides (vacuity guard)", () => {
    // The failure mode every source scan in this program has hit: a changed
    // syntax on either side makes the check pass by inspecting nothing.
    expect(routes.size, "no <Route path=…> parsed from App.tsx").toBeGreaterThan(200);
    expect(links.length, "no server-emitted links found — did the field names change?")
      .toBeGreaterThan(20);
  });

  it("the resolver understands parameterised routes (self-check)", () => {
    // Asserted rather than assumed: a resolver that matched nothing would make
    // the sweep below report every link as broken, and one that matched
    // everything would make it report none.
    const sample = new Set(["/counties/:id", "/deals"]);
    expect(resolves("/counties/7", sample)).toBe(true);
    expect(resolves("/deals", sample)).toBe(true);
    expect(resolves("/nope", sample)).toBe(false);
  });

  it("no server-emitted link points at a route that does not exist", () => {
    const broken = links.filter((l) => !resolves(l.target, routes));
    expect(
      broken.map((b) => `${b.where} -> ${b.target}`).join("\n"),
      "the server sends someone to a path App.tsx has no <Route> for, so they " +
        "land on NotFound. Deleting a page is a client-side change done " +
        "thoroughly — route, lazy import, file, comment — and nobody greps the " +
        "server, where the link lives in a job, a briefing builder or a push " +
        "payload that nothing type-checks. If the destination is genuinely " +
        "gone, remove the card or re-point it at the surface that now owns the " +
        "content; do NOT point it at an approximation, which looks fixed.",
    ).toBe("");
  });
});

/**
 * A ROUTE EXISTING IS NOT THE SAME AS A CUSTOMER BEING ABLE TO REACH IT.
 *
 * The sweep above answers "does App.tsx declare this path". Thirteen paths are
 * declared through `<FlaggedRoute>`, which renders `<NotFound />` when its flag
 * is off — and the flags are seeded FALSE. So a link can pass every assertion in
 * this file and still end at a 404.
 *
 * One did. `autonomousDealMachine.ts` linked its **default** action card —
 * *"Review your target county market data"* — at `/market-intelligence`, a
 * FlaggedRoute behind `feature_market_intelligence`. Default cards fire when
 * there is nothing else to show, so the quietest and newest accounts were the
 * ones that got the 404. That is the second time in two units that a FALLBACK
 * path turned out to be the broken one, which is worth saying out loud: the
 * happy path gets exercised and the empty state does not.
 *
 * A link to a flag-gated route is not automatically wrong — a card could
 * legitimately be emitted only when the flag is on. But nothing here does that,
 * and the shape is subtle enough that it should be a deliberate exception with
 * a reason rather than a silent one. Hence: zero, and no register.
 */
describe("no server-emitted link points at a route a flag can hide", () => {
  const app = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");
  const flagged = new Set(
    [...app.matchAll(/<FlaggedRoute route="([^"]+)"/g)].map((m) => m[1]),
  );

  it("finds the flag-gated routes (vacuity guard)", () => {
    expect(
      flagged.size,
      "no <FlaggedRoute> parsed from App.tsx — has the gating component changed " +
        "name? This check is worthless if it inspects nothing.",
    ).toBeGreaterThan(5);
  });

  it("FlaggedRoute really renders NotFound when the flag is off (the premise)", () => {
    // If it ever redirected instead, a link to a gated route would be merely
    // suboptimal rather than broken, and this check would be enforcing a rule
    // whose reason had gone.
    const at = app.indexOf("function FlaggedRoute(");
    expect(at, "FlaggedRoute is gone").toBeGreaterThan(-1);
    const body = app.slice(at, app.indexOf("\n}", at));
    expect(body).toContain("if (!isRouteEnabled(route)) return <NotFound />;");
  });

  it("nothing the server emits lands on one", () => {
    const gated = emittedLinks().filter((l) => flagged.has(l.target));
    expect(
      gated.map((g) => `${g.where} -> ${g.target}`).join("\n"),
      "the server sends someone to a flag-gated route. FlaggedRoute renders " +
        "NotFound when the flag is off, and these flags are seeded FALSE, so " +
        "the card ends at a 404 while App.tsx still declares the path — which " +
        "is why the sweep above passes it. Either point at an ungated surface " +
        "that owns the same content, or emit the card only when the flag is on " +
        "and record that here as a deliberate exception.",
    ).toBe("");
  });
});

describe("the specific ones that were broken stay fixed", () => {
  // Named as well as swept, because the sweep would also pass if someone
  // deleted the emitters instead of fixing them — and deleting a customer's
  // briefing card is a different decision from re-pointing its link.
  const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

  it("the Today fallback card points at the county surface that exists", () => {
    for (const rel of ["server/routes-today.ts", "server/routes-dashboard.ts"]) {
      const src = read(rel);
      expect(src, `${rel} still emits /data-intelligence`).not.toContain("/data-intelligence");
      expect(src, `${rel} lost the county card entirely`).toContain('"/counties"');
    }
  });

  it("the Evening Review card is gone, not re-pointed", () => {
    // Its page was DELETED, and the content it advertised is on Today already —
    // which is where the card renders. Any replacement link would point at the
    // page the customer is standing on.
    for (const rel of ["server/routes-today.ts", "server/routes-dashboard.ts"]) {
      expect(read(rel), `${rel} still emits an evening-review card`).not.toContain(
        "/evening-review",
      );
    }
  });

  it("the weekly digest sends each anomaly to the surface for its category", () => {
    // One link per SEVERITY was the wrong shape as well as a broken one: an
    // AI-cost spike, a failing job and a churn cliff are looked at in three
    // different places.
    const digest = read("server/jobs/founderWeeklyDigest.ts");
    expect(digest).toContain("const ANOMALY_SURFACE");
    expect(digest, "the digest links every anomaly to one page again").not.toContain(
      '"/admin/alerts"',
    );
    expect(digest).not.toContain('"/founder/intelligence"');
    // The fallback must exist, or a new category silently emits `undefined`.
    expect(digest, "the category map lost its fallback").toMatch(
      /ANOMALY_SURFACE\[category\]\s*\?\?\s*"\/founder"/,
    );
  });

  it("the on-call push opens a page that exists", () => {
    // This is the one that wakes a human. It opened /founder/intelligence,
    // which has no route.
    const oncall = read("server/services/oncall.ts");
    expect(oncall).not.toContain('"/founder/intelligence"');
    expect(oncall).toContain('url: "/founder"');
  });

  it("the clean-pipeline defaults point at the live county surface", () => {
    // `/market-intelligence` is flag-gated and `/deal-hunter` is a retired
    // Redirect chain. `/counties` reads and writes /api/target-counties — add,
    // edit and remove — so it genuinely owns both "review the data" and "update
    // the criteria", and saying they are the same door beats inventing a
    // distinction.
    const machine = read("server/jobs/autonomousDealMachine.ts");
    expect(machine, "the default cards point at the flag-gated route again")
      .not.toContain('"/market-intelligence"');
    expect(machine, "a card points at the retired /deal-hunter redirect again")
      .not.toContain('"/deal-hunter"');
    expect(machine).toContain('link: "/counties"');
  });

  it("the DLQ action card offers no deeplink, because there is no console", () => {
    // Nothing in client/src reads /api/founder/dlq at all. A link to a page
    // that was never built is the same lie as a link to one that was deleted.
    const dlq = read("server/routes-founder-dlq.ts");
    expect(dlq, "the DLQ deeplink is back").not.toContain("deeplink:");
  });
});
