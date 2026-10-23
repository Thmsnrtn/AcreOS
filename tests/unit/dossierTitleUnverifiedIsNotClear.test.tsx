// @vitest-environment jsdom
/**
 * Dossier title section — an unverified title is never "clear".
 *
 * The due-diligence panel printed "No liens or encumbrances found. Title
 * appears clear." directly under a "Not verified" badge: the service's
 * unverified title finding carries no liens/encumbrances arrays, and
 * `!undefined?.length` read that silence as a clear title.
 *
 * The view is rendered with the service's OWN unverified output (no parcel
 * source answered), not a hand-written fixture of what we think it sends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../server/db", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => [{ id: 7, organizationId: 1, latitude: "35.1", longitude: "-86.2", state: "TN", county: "Maury" }],
  };
  return { db: chain };
});

import { DataSourceBroker } from "../../server/services/data-source-broker";
import { dueDiligencePodService } from "../../server/services/dueDiligencePods";
import { TitleFindingsDetail } from "../../client/src/components/due-diligence-panel";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(title: Parameters<typeof TitleFindingsDetail>[0]["title"]) {
  act(() => root.render(<TitleFindingsDetail title={title} />));
  return container.textContent ?? "";
}

describe("dossier title section", () => {
  it("service's unverified finding (no parcel source answered) never renders 'Title appears clear'", async () => {
    vi.spyOn(DataSourceBroker.prototype, "lookup").mockResolvedValue({ success: false } as any);
    const finding = await dueDiligencePodService.researchTitle(7, 1);
    expect(finding.unverified).toBe(true);
    expect(finding.liens).toBeUndefined();

    const text = render(finding);
    expect(text).not.toMatch(/appears clear/i);
    expect(text).not.toMatch(/No liens or encumbrances found/i);
    expect(text).toMatch(/Title has not been verified/);
  });

  it("source answered but carried no lien fields → still unverified, still not clear", async () => {
    vi.spyOn(DataSourceBroker.prototype, "lookup").mockResolvedValue({ success: true, data: { apn: "1" } } as any);
    const finding = await dueDiligencePodService.researchTitle(7, 1);
    const text = render(finding);
    expect(text).not.toMatch(/appears clear/i);
    expect(text).toMatch(/Title has not been verified/);
  });

  it("a VERIFIED clear finding (source reported empty lien/encumbrance lists) does render the clear line", async () => {
    vi.spyOn(DataSourceBroker.prototype, "lookup").mockResolvedValue({ success: true, data: { liens: [], encumbrances: [] } } as any);
    const finding = await dueDiligencePodService.researchTitle(7, 1);
    expect(finding.clear).toBe(true);
    expect(finding.unverified).toBeFalsy();
    expect(render(finding)).toMatch(/Title appears clear/);
  });

  it("clear:false with no arrays (e.g. property not found) is not rendered clear", () => {
    const text = render({ clear: false, issues: ["Property not found"] });
    expect(text).not.toMatch(/appears clear/i);
    expect(text).toMatch(/Property not found/);
  });

  it("liens reported → listed, never 'clear'", () => {
    const text = render({ clear: false, liens: ["Mortgage — First Bank"], encumbrances: [] });
    expect(text).toMatch(/Mortgage — First Bank/);
    expect(text).not.toMatch(/appears clear/i);
  });
});
