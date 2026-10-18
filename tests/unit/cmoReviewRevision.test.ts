import { describe, expect, it } from "vitest";
import { cmoReviewRevision } from "../../server/services/cmo/reviewRevision";
import { cmoPublicationDestinations } from "@shared/cmo/publication";
describe("CMO displayed metadata revision", () => {
  const item = { id: 1, contextBundle: { scriptHook: "Reviewed hook" }, updatedAt: new Date("2026-10-14T00:00:00.000Z") };
  const renders = [{ id: "b", aspectRatio: "1:1", storagePath: "local:b.mp4" }, { id: "a", aspectRatio: "9:16", storagePath: "local:a.mp4" }];
  it("uses the same revision for database Dates and their API serialization", () => {
    expect(cmoReviewRevision(item, renders)).toBe(cmoReviewRevision(JSON.parse(JSON.stringify(item)), [...renders].reverse()));
  });
  it("changes with displayed copy, render metadata and actual Date values", () => {
    const original = cmoReviewRevision(item, renders);
    expect(cmoReviewRevision({ ...item, contextBundle: { scriptHook: "Replacement" } }, renders)).not.toBe(original);
    expect(cmoReviewRevision(item, [{ ...renders[0], storagePath: "local:replacement.mp4" }, renders[1]])).not.toBe(original);
    expect(cmoReviewRevision({ ...item, updatedAt: new Date("2026-10-15T00:00:00.000Z") }, renders)).not.toBe(original);
  });
  it("routes portrait to both destinations and square only to Meta", () => {
    expect(cmoPublicationDestinations(renders, ["meta", "tiktok"])).toEqual([{ renderId: "b", platform: "meta" }, { renderId: "a", platform: "meta" }, { renderId: "a", platform: "tiktok" }]);
  });
});
