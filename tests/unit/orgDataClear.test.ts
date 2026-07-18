/**
 * Pure-logic pins for the org data-clear engine (server/services/orgDataClear.ts):
 * the FK-closure walk and the org-scoping subquery builder that let
 * /api/clear-demo-data remove leads/deals/properties WITH dependents
 * instead of throwing a foreign-key 500 (founder report, 2026-07-18).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/storage", () => ({ db: {}, storage: {} }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  computeBlockingClosure,
  buildVictimSubquery,
  type FkEdge,
} from "../../server/services/orgDataClear";

const edge = (child: string, childCol: string, parent: string, parentCol = "id"): FkEdge => ({
  child, childCol, parent, parentCol,
});

describe("computeBlockingClosure", () => {
  it("includes roots plus every table transitively blocking them", () => {
    const edges = [
      edge("offers", "lead_id", "leads"),
      edge("deal_rooms", "deal_id", "deals"),
      edge("deal_room_messages", "room_id", "deal_rooms"),
      edge("unrelated", "user_id", "users"),
    ];
    const closure = computeBlockingClosure(edges, ["leads", "deals"]);
    expect(closure.has("leads")).toBe(true);
    expect(closure.has("offers")).toBe(true);
    expect(closure.has("deal_rooms")).toBe(true);
    // Grandchild: blocks deal_rooms, which blocks deals.
    expect(closure.has("deal_room_messages")).toBe(true);
    expect(closure.has("unrelated")).toBe(false);
    expect(closure.has("users")).toBe(false);
  });

  it("returns only roots when nothing references them", () => {
    const closure = computeBlockingClosure([edge("a", "x", "b")], ["leads"]);
    expect([...closure]).toEqual(["leads"]);
  });
});

describe("buildVictimSubquery", () => {
  const orgTables = new Set(["leads", "deals"]);
  const edges = [
    edge("deal_rooms", "deal_id", "deals"),
    edge("deal_room_messages", "room_id", "deal_rooms"),
  ];
  const closure = computeBlockingClosure(edges, ["leads", "deals"]);

  it("resolves an org-scoped table directly", () => {
    const sub = buildVictimSubquery("leads", "id", 42, edges, orgTables, closure);
    expect(sub).toBe('SELECT "id" FROM "leads" WHERE organization_id = 42');
  });

  it("scopes an orgless table through its parent chain", () => {
    const sub = buildVictimSubquery("deal_rooms", "id", 42, edges, orgTables, closure);
    expect(sub).toBe(
      'SELECT "id" FROM "deal_rooms" WHERE "deal_id" IN (SELECT "id" FROM "deals" WHERE organization_id = 42)',
    );
  });

  it("returns null when no org-scoped ancestor is reachable", () => {
    const sub = buildVictimSubquery(
      "deal_room_messages", "id", 42, [edge("deal_room_messages", "room_id", "deal_rooms")],
      new Set<string>(), new Set(["deal_room_messages", "deal_rooms"]),
    );
    expect(sub).toBeNull();
  });

  it("rejects unsafe identifiers rather than interpolating them", () => {
    expect(() =>
      buildVictimSubquery('leads"; DROP TABLE x; --', "id", 1, [], new Set(['leads"; DROP TABLE x; --']), new Set()),
    ).toThrow(/Unsafe SQL identifier/);
  });
});
