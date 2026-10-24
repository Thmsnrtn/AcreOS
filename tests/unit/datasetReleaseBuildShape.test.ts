/**
 * D2b — the release core reads a statewide build through a STRUCTURAL slice
 * (BuildForRelease) so the pure module never imports the build's DB/registry
 * graph. This file pins, at the type level, that the real CountyBuildReport
 * is assignable to that slice: if D2a changes the report's shape in a way the
 * release reads, `npm run check` (tests-typecheck) goes red here.
 */
import { describe, expect, it } from "vitest";
import type { CountyBuildReport } from "../../server/services/landData/statewideCadastral";
import type { BuildForRelease } from "../../server/services/landData/releases/releaseManifest";

const asReleaseInput = (r: CountyBuildReport): BuildForRelease => r;

describe("CountyBuildReport → BuildForRelease", () => {
  it("is assignable (type-level pin; the runtime check is that the adapter exists)", () => {
    expect(typeof asReleaseInput).toBe("function");
  });
});
