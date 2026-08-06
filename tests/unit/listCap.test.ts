/**
 * Bounded, loud list reads (audit F-10-2).
 *
 * Pins the invariant the storage reads depend on: when a `.limit(cap + 1)`
 * query returns more than `cap` rows, we return exactly `cap` and log loudly —
 * never silently drop the overflow. Below the cap, everything passes through.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { capListRead, LIST_READ_CAP } from "../../server/storage/listCap";

describe("capListRead (F-10-2)", () => {
  beforeEach(() => warn.mockClear());

  it("returns all rows and does not warn when under the cap", () => {
    const rows = Array.from({ length: 10 }, (_, i) => i);
    const out = capListRead(rows, 5000, "getNotes", 7);
    expect(out).toHaveLength(10);
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns all rows and does not warn when exactly at the cap", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => i);
    const out = capListRead(rows, 5000, "getLeads", 7);
    expect(out).toHaveLength(5000);
    expect(warn).not.toHaveBeenCalled();
  });

  it("truncates to cap AND warns loudly when the cap+1 sentinel row is present", () => {
    const rows = Array.from({ length: 5001 }, (_, i) => i); // fetched with limit(cap+1)
    const out = capListRead(rows, 5000, "getProperties", 42);
    expect(out).toHaveLength(5000);
    expect(out[4999]).toBe(4999); // kept the first `cap`, dropped the sentinel+
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("getProperties");
    expect(warn.mock.calls[0][0]).toContain("MORE ROWS EXIST");
  });

  it("exposes the shared cap constant", () => {
    expect(LIST_READ_CAP).toBe(5000);
  });
});
