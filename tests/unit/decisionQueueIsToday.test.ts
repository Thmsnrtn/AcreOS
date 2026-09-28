/**
 * DEFECT-0148 — there is one decision queue, and every link lands on it.
 *
 * The notification bell, Today's "View all", approval notifications and two
 * legacy paths opened a page (pages/decision-queue.tsx) that re-derived "what
 * needs you" from bare /api/leads and /api/deals reads — the 25 newest of each,
 * a failed read as empty — and then said "Pipeline is clear. No decisions
 * needed today. All leads are current and deals are moving." Stalled leads are
 * old by definition, so they were exactly the rows past 25. The page is gone;
 * every entry point lands on Today's queue.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => stripComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("DEFECT-0148 — the decision queue is Today's", () => {
  it("the 25-row page is gone", () => {
    expect(existsSync(resolve(ROOT, "client/src/pages/decision-queue.tsx"))).toBe(false);
    expect(read("client/src/App.tsx")).not.toMatch(/pages\/decision-queue/);
  });

  it("both legacy paths redirect to Today", () => {
    const app = read("client/src/App.tsx");
    for (const path of ["/admin/decisions", "/decision-queue"]) {
      const at = app.indexOf(`<Route path="${path}">`);
      expect(at, `${path} route (vacuity)`).toBeGreaterThan(-1);
      expect(app.slice(at, at + 120)).toMatch(/<Redirect to="\/today" \/>/);
    }
  });

  it("the bell, the queue header and approval notifications point at Today", () => {
    expect(read("client/src/components/page-topbar.tsx")).toMatch(/href="\/today" data-testid="topbar-notifications"/);
    expect(read("client/src/components/today/DecisionQueue.tsx")).not.toMatch(/\/decision-queue/);
    const dispatcher = read("server/services/notificationDispatcher.ts");
    // The URL switch (there is also a title switch with the same case).
    expect(dispatcher).toMatch(/case "approval:requested":\s*return "\/today";/);
    expect(dispatcher).not.toMatch(/"\/admin\/decisions"/);
  });
});
