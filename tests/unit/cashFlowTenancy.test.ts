/**
 * The org was accepted at the front door and dropped one call deep.
 *
 * `generateForecast(organizationId, params)` takes an organization. It then
 * called five internal methods with the id alone:
 *
 *     projectNoteIncome(noteId, periodMonths)
 *     analyzePaymentHealth(noteId)
 *     calculatePaymentRiskScore(noteId)
 *     identifyRiskFactors(noteId)
 *     projectExpenses("note", noteId, periodMonths)
 *
 * each of which resolved `notes` by primary key. So `POST /api/cash-flow/forecast`
 * with **another org's `noteId` in the body** forecast that org's note — payment
 * history, default probability, risk factors, projected income — through an
 * entry point whose signature says it is scoped.
 *
 * This is the sharpest instance of the shape this program keeps finding, and it
 * is the one the tenancy lint structurally cannot see. `check-org-scoped-fetch`
 * asks whether a method MENTIONS an organization; `generateForecast` does, so it
 * passed. Its callees did not mention one and were on the register — but their
 * being on a debt register reads as "known, pre-existing", not as "reachable
 * from a scoped method with a caller-supplied id". The note in that lint's own
 * header — *"passing this lint means a method mentions an org, not that it is
 * safe"* — now has a concrete instance behind it.
 *
 * The route-level half was the usual split: `/forecast`, `/portfolio/summary`,
 * `/portfolio/high-risk`, `/portfolio/timeline` and `/forecast/actual-vs-projected`
 * all passed `org.id`; `/notes/:noteId/health`, `/notes/:noteId/risk-score` and
 * `/forecast/:forecastId/insights` passed the id alone.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

const service = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/cashFlowForecaster.ts"), "utf8"),
);
const routes = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-cash-flow.ts"), "utf8"),
);

/** Methods that resolve a note, property or forecast by an id they are given. */
const ID_KEYED = [
  "projectNoteIncome",
  "projectPropertyIncome",
  "projectExpenses",
  "analyzePaymentHealth",
  "calculatePaymentRiskScore",
  "identifyRiskFactors",
  "generateInsights",
];

describe("every id-keyed method takes an organization", () => {
  it("the methods still exist (vacuity guard)", () => {
    for (const m of ID_KEYED) {
      expect(service, `${m} is gone — renamed?`).toContain(`async ${m}(`);
    }
  });

  for (const m of ID_KEYED) {
    it(`${m} takes one`, () => {
      const at = service.indexOf(`async ${m}(`);
      const sig = service.slice(at, service.indexOf(")", service.indexOf("(", at)));
      expect(
        sig,
        `${m} resolves a record from an id with no organization. It is reachable ` +
          `from generateForecast, which DOES take one — an org accepted at the ` +
          `front door and dropped one call deep is the same leak with a scoped ` +
          `signature in front of it.`,
      ).toContain("organizationId");
    });
  }

  it("no internal call drops the organization", () => {
    // The generalisation, and the assertion that would have caught the original
    // defect: every `this.<idKeyedMethod>(…)` call must carry organizationId.
    const calls = service.match(/this\.(\w+)\([^;)]*\)/g) ?? [];
    expect(calls.length, "no internal calls parsed").toBeGreaterThan(10);
    const relevant = calls.filter((c) =>
      ID_KEYED.some((m) => c.startsWith(`this.${m}(`)),
    );
    expect(relevant.length, "no calls to the id-keyed methods found").toBeGreaterThan(8);
    const missing = relevant.filter((c) => !/organizationId/.test(c));
    expect(
      missing.join("\n"),
      "an internal call passes an id without the organization",
    ).toBe("");
  });
});

describe("the queries carry the predicate", () => {
  it("no note, property or forecast is resolved by id alone", () => {
    const lone =
      service.match(
        /where\(\s*eq\((notes|properties|cashFlowForecasts)\.id\s*,[^)]*\)\s*,?\s*\)/g,
      ) ?? [];
    expect(
      lone.join(" | "),
      "a query resolves a note, property or forecast by id with no organization " +
        "predicate. The insights WRITE counts too — generateForecast updates the " +
        "forecast row it just created.",
    ).toBe("");
  });

  it("the refusal names the tenant, and the routes render it 404", () => {
    expect(service).toContain("export class CashFlowNotInOrgError");
    expect(
      service,
      "a not-found path still throws a bare Error, so the route cannot tell a " +
        "cross-tenant refusal from a genuine failure and answers 500",
    ).not.toMatch(/throw new Error\(`(Note|Property|Forecast) \$\{/);

    const at = routes.indexOf("function refuse(");
    expect(at, "the refusal helper is gone").toBeGreaterThan(-1);
    const body = routes.slice(at, routes.indexOf("\n}", at));
    expect(body).toContain("Errors.notFound(");
    expect(body).not.toContain("Errors.forbidden(");
  });
});

describe("every caller passes the org, in every file", () => {
  it("sweeps the whole server tree", () => {
    // Unit 59's lesson: a per-router assertion is a per-router guarantee. That
    // unit's first draft went green while a second router served the same
    // unscoped method under a different path.
    const callers: Array<{ file: string; call: string }> = [];
    const stack = [path.join(ROOT, "server")];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) { stack.push(full); continue; }
        if (!entry.endsWith(".ts") || /\.test\.|\.spec\./.test(entry)) continue;
        if (full.endsWith("services/cashFlowForecaster.ts")) continue;
        const src = stripComments(fs.readFileSync(full, "utf8"));
        // Paren-balanced, not `[^;]*?\)`. The lazy form stops at the FIRST
        // closing paren, so `analyzePaymentHealth(parseInt(req.params.noteId),
        // getOrganizationId(req))` was captured as `…(parseInt(req.params.noteId)`
        // and reported as missing the org that was right there. A matcher that
        // truncates its evidence manufactures findings.
        for (const m of src.matchAll(/cashFlowForecasterService\.(\w+)\(/g)) {
          if (!ID_KEYED.includes(m[1])) continue;
          let i = m.index! + m[0].length;
          let depth = 1;
          while (i < src.length && depth > 0) {
            if (src[i] === "(") depth += 1;
            else if (src[i] === ")") depth -= 1;
            i += 1;
          }
          callers.push({ file: path.relative(ROOT, full), call: src.slice(m.index!, i) });
        }
      }
    }
    expect(callers.length, "no id-keyed callers found — did the service move?")
      .toBeGreaterThan(3);
    const missing = callers.filter(
      (c) => !/getOrganizationId\(req\)|org\.id|organizationId/.test(c.call),
    );
    expect(
      missing.map((c) => `${c.file}: ${c.call.split("\n")[0]}`).join("\n"),
      "a file calls an id-keyed cash-flow method without an organization",
    ).toBe("");
  });

  it("the org-level entry points still take the org first (contrast guard)", () => {
    // These were always right. Asserted so a "make everything consistent" pass
    // does not reshuffle the argument order and silently swap an id for an org.
    for (const m of ["generateForecast", "getPortfolioCashFlowSummary", "flagHighRiskNotes", "getPortfolioTimeline"]) {
      const at = service.indexOf(`async ${m}(`);
      expect(at, `${m} is gone`).toBeGreaterThan(-1);
      const sig = service.slice(at, service.indexOf(")", service.indexOf("(", at)));
      expect(sig, `${m} no longer takes organizationId first`).toContain("organizationId");
    }
  });
});
