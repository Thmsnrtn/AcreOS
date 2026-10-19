/**
 * The Lob router adapter reports which HOUSE-PREPAID pieces cost AcreOS
 * nothing — sent to Lob's test environment, simulated, or billed to the org's
 * own key — so the queue flusher can return their share (audit 2026-10-18).
 * A piece AcreOS's live account really billed is never counted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const S = vi.hoisted(() => ({
  results: [] as Array<{ lobId: string; testMode?: boolean; credentialSource?: string }>,
}));

vi.mock("../../server/storage", () => ({
  storage: { getMailSenderIdentities: async () => [{ id: 1, isDefault: true, isActive: true }] },
}));
vi.mock("../../server/services/directMailService", () => {
  class LetterAlreadySentError extends Error {
    lobId?: string;
  }
  const next = async () => S.results.shift()!;
  return { LetterAlreadySentError, sendLetter: next, sendPostcard: next };
});

const { lobAdapter } = await import("../../server/services/mail/providers/lob");

const shipment = (housePrepaid: boolean, pieceType: "letter_10" | "postcard_4x6") => ({
  customerId: 5,
  organizationId: 5,
  speed: "standard" as const,
  personalizationRequired: false,
  housePrepaid,
  pieces: [1, 2, 3, 4].map((i) => ({
    recipient: { address1: `${i} Main`, city: "Austin", state: "TX", zip: "78701" },
    pieceType,
    pieceRef: `mail_piece:${i}`,
    vars: { htmlContent: "<p>x</p>", frontHtml: "<p>x</p>", backHtml: "" },
  })),
});

beforeEach(() => {
  process.env.LOB_TEST_API_KEY = "test_x";
  S.results = [
    { lobId: "a", testMode: false, credentialSource: "platform" },
    { lobId: "b", testMode: true, credentialSource: "platform" },
    { lobId: "c", testMode: false, credentialSource: "simulation" },
    { lobId: "d", testMode: false, credentialSource: "organization" },
  ];
});

describe("lobAdapter.send — unbilled pre-paid pieces", () => {
  it.each(["letter_10", "postcard_4x6"] as const)("%s: counts test-env, simulated and own-key pieces, not the live-billed one", async (type) => {
    const r = await lobAdapter.send(shipment(true, type) as never);
    expect(r.pieces).toHaveLength(4);
    expect(r.unbilledPieceCount).toBe(3);
  });

  it("a shipment that was NOT pre-paid reports nothing to refund", async () => {
    const r = await lobAdapter.send(shipment(false, "letter_10") as never);
    expect(r.unbilledPieceCount).toBe(0);
  });
});
