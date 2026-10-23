/**
 * P1 false-claims sweep — the mail composer offers only what is mailed.
 *
 * The composer offered "Handwritten — premium touch", "Next day", "Batch
 * (cheapest)" and "EDDM blast". The Lob adapter priced handwritten at 350¢
 * ("Lob handwriting integration premium") and mailed a plain printed letter;
 * it quoted next-day at a 1-day ETA and never passed a mail class; presort,
 * EDDM and LettrLabs are disabled stubs. A customer could pay a premium for a
 * product that was never delivered.
 *
 * This drives the REAL Lob adapter and the REAL router: every undeliverable
 * product (enumerated from the full stored vocabulary, not a hand list) is
 * unquoted and refused before any provider is contacted; and every option the
 * composer renders maps to a deliverable spec.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/founderSettings", () => ({ getSetting: vi.fn(async () => null) }));

const { sendLetter, sendPostcard } = vi.hoisted(() => ({
  sendLetter: vi.fn(async () => ({ lobId: "ltr_1" })),
  sendPostcard: vi.fn(async () => ({ lobId: "psc_1" })),
}));
vi.mock("../../server/services/directMailService", () => ({
  sendLetter,
  sendPostcard,
  LetterAlreadySentError: class extends Error {},
}));
vi.mock("../../server/storage", () => ({
  storage: { getMailSenderIdentities: async () => [{ id: 1, isDefault: true, isActive: true }] },
}));

import {
  MailRouter,
  PIECE_TYPES as ROUTER_PIECE_TYPES,
  __resetMailRouterRegistry,
  __setMailRouterRegistry,
  type MailProvider,
  type MailShipment,
} from "../../server/services/mail/router";
import { lobAdapter } from "../../server/services/mail/providers/lob";
import {
  ALL_MAIL_PIECE_TYPES,
  ALL_MAIL_SPEEDS,
  DELIVERABLE_MAIL_PIECE_TYPES,
  DELIVERABLE_MAIL_SPEEDS,
} from "../../shared/outreach/mailOptions";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), "utf8"));

function shipment(pieceType: string, speed: string): MailShipment {
  return {
    customerId: 1,
    organizationId: 7,
    pieces: [
      {
        recipient: { firstName: "Pat", lastName: "Land", address1: "1 Acre Rd", city: "Austin", state: "TX", zip: "78701" },
        pieceType: pieceType as MailShipment["pieces"][number]["pieceType"],
      },
    ],
    speed: speed as MailShipment["speed"],
    personalizationRequired: false,
  };
}

const UNDELIVERABLE_PIECES = ALL_MAIL_PIECE_TYPES.filter((p) => !(DELIVERABLE_MAIL_PIECE_TYPES as readonly string[]).includes(p));
const UNDELIVERABLE_SPEEDS = ALL_MAIL_SPEEDS.filter((s) => !(DELIVERABLE_MAIL_SPEEDS as readonly string[]).includes(s));

/** A provider that would accept anything — the refusal must not depend on it declining. */
const acceptAll = (): MailProvider & { send: ReturnType<typeof vi.fn> } => ({
  name: "postgrid",
  isConfigured: () => true,
  quote: async (s) => ({ provider: "postgrid", costPerPieceCents: 50, deliveryEtaDays: 1, minVolume: 1, meetsConstraints: true }),
  send: vi.fn(async (s: MailShipment) => ({
    provider: "postgrid",
    providerEventId: "pg_1",
    pieces: s.pieces.map(() => ({ providerPieceId: "pg_p", recipientRef: "1" })),
    totalCostCents: 50,
  })),
});

describe("mail products the providers cannot deliver are refused", () => {
  const prevKey = process.env.LOB_TEST_API_KEY;
  beforeEach(() => {
    process.env.LOB_TEST_API_KEY = "test_x";
    __resetMailRouterRegistry();
    sendLetter.mockClear();
    sendPostcard.mockClear();
  });
  afterEach(() => {
    if (prevKey === undefined) delete process.env.LOB_TEST_API_KEY;
    else process.env.LOB_TEST_API_KEY = prevKey;
  });

  it("the stored vocabulary is fully classified (a new piece type must be decided here)", () => {
    expect([...ROUTER_PIECE_TYPES].sort()).toEqual([...ALL_MAIL_PIECE_TYPES].sort());
    // Vacuity: the classes the audit found must actually be in the refused set.
    expect(UNDELIVERABLE_PIECES).toContain("handwritten");
    expect(UNDELIVERABLE_SPEEDS).toEqual(expect.arrayContaining(["next_day", "batch_3d", "batch_weekly", "eddm_geo"]));
  });

  it("Lob quotes a deliverable spec, at the standard ETA", async () => {
    const q = await lobAdapter.quote(shipment("letter_10", "standard"));
    expect(q.meetsConstraints).toBe(true);
    expect(q.costPerPieceCents).toBe(120);
    expect(q.deliveryEtaDays).toBe(5);
  });

  for (const piece of UNDELIVERABLE_PIECES) {
    it(`Lob does not quote, and refuses to send, a "${piece}" piece`, async () => {
      const q = await lobAdapter.quote(shipment(piece, "standard"));
      expect(q.meetsConstraints).toBe(false);
      await expect(lobAdapter.send(shipment(piece, "standard"))).rejects.toMatchObject({ providerNotBilled: true });
      expect(sendLetter).not.toHaveBeenCalled();
      expect(sendPostcard).not.toHaveBeenCalled();
    });
  }

  for (const speed of UNDELIVERABLE_SPEEDS) {
    it(`Lob does not quote, and refuses to send, "${speed}" delivery`, async () => {
      const q = await lobAdapter.quote(shipment("postcard_4x6", speed));
      expect(q.meetsConstraints).toBe(false);
      await expect(lobAdapter.send(shipment("postcard_4x6", speed))).rejects.toMatchObject({ providerNotBilled: true });
      expect(sendPostcard).not.toHaveBeenCalled();
    });
  }

  const UNDELIVERABLE_SPECS: [string, string][] = [
    ...UNDELIVERABLE_PIECES.map((p) => [p, "standard"] as [string, string]),
    ...UNDELIVERABLE_SPEEDS.map((s) => ["postcard_4x6", s] as [string, string]),
  ];
  for (const [piece, speed] of UNDELIVERABLE_SPECS) {
    it(`the router neither quotes nor routes ${piece}/${speed}, even with a provider willing to take it`, async () => {
      const willing = acceptAll();
      __setMailRouterRegistry([lobAdapter, willing]);
      const { getSetting } = await import("../../server/services/founderSettings");
      vi.mocked(getSetting).mockResolvedValue(JSON.stringify(["lob", "postgrid"]));
      const router = new MailRouter();
      expect(await router.quote(shipment(piece, speed))).toEqual([]);
      await expect(router.route(shipment(piece, speed))).rejects.toMatchObject({ providerNotBilled: true });
      expect(willing.send).not.toHaveBeenCalled();
    });
  }
});

describe("population: every surface offers only deliverable options", () => {
  function optionValues(source: string, arrayName: string): string[] {
    const start = source.indexOf(`const ${arrayName}`);
    expect(start, `${arrayName} not found`).toBeGreaterThanOrEqual(0);
    const eq = source.indexOf("= [", start);
    const end = source.indexOf("];", eq);
    const block = source.slice(eq, end);
    return [...block.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1]);
  }

  const composer = read("client/src/pages/outreach/mail/compose.tsx");

  it("composer piece-type options are exactly the deliverable piece types", () => {
    const values = optionValues(composer, "PIECE_TYPE_OPTIONS");
    expect(values.length).toBeGreaterThanOrEqual(3); // vacuity floor
    expect([...values].sort()).toEqual([...DELIVERABLE_MAIL_PIECE_TYPES].sort());
  });

  it("composer speed options are exactly the deliverable speeds", () => {
    const values = optionValues(composer, "SPEED_OPTIONS");
    expect(values.length).toBeGreaterThanOrEqual(1); // vacuity floor
    expect([...values].sort()).toEqual([...DELIVERABLE_MAIL_SPEEDS].sort());
  });

  it("the outreach-mail routes validate against the deliverable vocabulary", () => {
    const routes = read("server/routes-outreach-mail.ts");
    expect(routes).toMatch(/const PIECE_TYPES = DELIVERABLE_MAIL_PIECE_TYPES;/);
    expect(routes).toMatch(/const SPEEDS = DELIVERABLE_MAIL_SPEEDS;/);
    expect(routes).toMatch(/pieceType: z\.enum\(PIECE_TYPES\)/);
    expect(routes).toMatch(/speed: z\.enum\(SPEEDS\)/);
  });
});
