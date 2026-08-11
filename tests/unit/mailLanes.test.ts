/**
 * R-2 EXIT TEST — physical-mail purpose lanes (founder ruling 2026-08-11).
 *
 * THE FALSIFIABLE CLAIM THIS FILE PINS:
 *
 *   A fresh org with no connected Lob integration attempts a counterparty
 *   send through EVERY reachable surface and is refused in all of them, with
 *   a connect affordance, and the Lob SDK is NEVER constructed.
 *
 * "Every reachable surface" is not a vibe — it is the consolidation map:
 *
 *   S1  outreach queue     POST /api/outreach/mail/queue → mail_shipments →
 *                          flushDueMailShipments → MailRouter.route →
 *                          lobAdapter.send → directMailService
 *   S2  sequence cadence   sequenceProcessor.sendDirectMail → MailRouter.route
 *   S3  campaign blast     POST /api/campaigns/:id/send-direct-mail →
 *                          directMail.DirectMailService
 *   S4  autopilot hand     hands/send-letter → mailProvider.sendLetter
 *   S5  api job queue      apiQueue.executeJob('lob') → directMail
 *   S6  communications     DELETED with lobService.ts (dead code at HEAD)
 *
 * S1/S2 share a terminal client (directMailService) and a chokepoint
 * (lobAdapter → MailRouter), so the surfaces collapse onto FOUR asserted
 * entry points plus the router's no-fall-through rule.
 *
 * TESTS THAT DO NOT BITE: a presence check ("assertMailLane was called") would
 * pass while the caller ignored the result. Every case here asserts the
 * OBSERVABLE CONSEQUENCE — whether `new Lob(...)` happened, and with WHICH
 * key — because that is the only thing that decides whose printer prints.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── The observable consequence: every Lob client construction ────────────────
const lobConstructions: string[] = [];
const lobCreates: Array<{ kind: string; apiKey: string }> = [];

vi.mock("lob", () => ({
  default: class MockLob {
    apiKey: string;
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
      lobConstructions.push(opts.apiKey);
    }
    letters = {
      create: async () => {
        lobCreates.push({ kind: "letter", apiKey: this.apiKey });
        return { id: "ltr_1", expected_delivery_date: "2026-08-20", url: "u" };
      },
    };
    postcards = {
      create: async () => {
        lobCreates.push({ kind: "postcard", apiKey: this.apiKey });
        return { id: "psc_1", expected_delivery_date: "2026-08-20", url: "u" };
      },
    };
    usVerifications = { verify: async () => ({ deliverability: "deliverable" }) };
  },
}));

// ── Org / platform credential state ─────────────────────────────────────────
const state = {
  orgKey: null as string | null,
  platformKey: null as { apiKey: string; isTestKey: boolean } | null,
  tier: "free",
  piecesUsed: 0,
  /** The rendered WHERE predicate of the last wedge-count query. */
  lastWedgeWhere: "" as string,
};

const resolveProviderCredential = vi.fn(async () => state.orgKey);
vi.mock("../../server/services/providers/resolveProviderCredential", () => ({
  resolveProviderCredential: (...a: any[]) => resolveProviderCredential(...(a as [])),
}));

const resolvePlatformLobKey = vi.fn(() => {
  if (!state.platformKey) throw new Error("Lob test key not configured.");
  return state.platformKey;
});
vi.mock("../../server/services/mail/liveSendInterlock", () => ({
  resolvePlatformLobKey: () => resolvePlatformLobKey(),
  isLiveSendArmed: () => false,
}));

// db: distinguish the two reads by their projection keys, so no schema
// identity juggling is needed.
vi.mock("../../server/db", async () => {
  const { inspect } = await import("node:util");
  const chain = () => {
    let kind: "tier" | "used" | "other" = "other";
    let captured = "";
    const c: any = {
      __setKind(k: any) {
        kind = k;
        return c;
      },
      from: () => c,
      where: (cond: any) => {
        // Capture the whole predicate tree so a test can assert, positively
        // AND negatively, whether the shipment-exclusion clause is present.
        captured = inspect(cond, { depth: 30 });
        return c;
      },
      limit: () => c,
      then: (resolve: any, reject: any) => {
        if (kind === "used") state.lastWedgeWhere = captured;
        const rows =
          kind === "tier"
            ? [{ tier: state.tier }]
            : kind === "used"
              ? [{ used: state.piecesUsed }]
              : [];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return c;
  };
  return {
    db: {
      select: (projection: any) => {
        const keys = Object.keys(projection ?? {});
        const c = chain();
        if (keys.includes("tier")) return c.__setKind("tier");
        if (keys.includes("used")) return c.__setKind("used");
        return c.__setKind("other");
      },
    },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Collaborators of the terminal clients — none of them may decide a send.
vi.mock("../../server/storage", () => ({
  storage: new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "getOrganization") return async () => ({ id: ORG, settings: {} });
        if (prop === "getMailSenderIdentities")
          return async () => [
            {
              id: 1,
              isDefault: true,
              isActive: true,
              companyName: "Test Land Co",
              addressLine1: "1 Main",
              city: "Austin",
              state: "TX",
              zipCode: "78701",
            },
          ];
        return vi.fn().mockResolvedValue(undefined);
      },
    },
  ),
  db: {},
}));
vi.mock("../../server/services/credits", () => ({
  creditService: { hasEnoughCredits: async () => true, getBalance: async () => 10_000 },
  usageMeteringService: { calculateCost: async () => 89, recordUsage: async () => undefined },
}));
vi.mock("../../server/services/financial-ledger", () => ({ postOpexSpent: async () => undefined }));
vi.mock("../../server/services/byok/toggle", () => ({ isByokEnabled: async () => false }));
vi.mock("../../server/utils/simulationMode", () => ({
  shouldSimulate: () => false,
  recordSimulatedAction: async () => ({ id: "sim" }),
}));
vi.mock("../../server/services/outreachStopLoss", () => ({
  assertOutreachNotPaused: async () => undefined,
}));
// Enable BOTH providers in the router tests below, so "does not fall through"
// is asserted against a fallback that genuinely COULD have been used.
// (Production default is lob-only — pinned in its own test further down.)
const enabledProviders = { value: null as string | null };
vi.mock("../../server/services/founderSettings", () => ({
  getSetting: async (key: string) =>
    key === "mail.providers.enabled" ? enabledProviders.value : null,
}));

import {
  assertMailLane,
  isMailLaneRefusal,
  mailLaneStatus,
  MailLaneRefusal,
  FREE_TIER_LIFETIME_PIECES,
  MAIL_CONNECT_URL,
} from "../../server/services/mail/mailLanes";
import * as mailProvider from "../../server/services/mailProvider";
import * as directMailService from "../../server/services/directMailService";
import { directMailService as campaignMail } from "../../server/services/directMail";
import { lobAdapter } from "../../server/services/mail/providers/lob";
import {
  MailRouter,
  __setMailRouterRegistry,
  __resetMailRouterRegistry,
  type MailShipment,
} from "../../server/services/mail/router";

const ORG = 9001;
const PLATFORM_KEY = "test_platform_key";
const ORG_KEY = "test_org_own_key";

const ADDRESS = {
  name: "Jane Owner",
  addressLine1: "100 Ranch Rd",
  city: "Austin",
  state: "TX",
  zip: "78701",
};

function shipment(over: Partial<MailShipment> = {}): MailShipment {
  return {
    customerId: ORG,
    organizationId: ORG,
    pieces: [
      {
        recipient: { firstName: "Jane", address1: "100 Ranch Rd", city: "Austin", state: "TX", zip: "78701" },
        pieceType: "letter_10",
        vars: { htmlContent: "<p>offer</p>" },
      },
    ],
    speed: "standard",
    personalizationRequired: false,
    purpose: "counterparty",
    ...over,
  };
}

beforeEach(() => {
  lobConstructions.length = 0;
  lobCreates.length = 0;
  state.orgKey = null;
  state.platformKey = { apiKey: PLATFORM_KEY, isTestKey: true };
  state.tier = "pro";
  state.piecesUsed = 0;
  state.lastWedgeWhere = "";
  resolveProviderCredential.mockClear();
  resolvePlatformLobKey.mockClear();
  __resetMailRouterRegistry();
  enabledProviders.value = null;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE EXIT TEST — a fresh org with no Lob integration, every surface
// ═══════════════════════════════════════════════════════════════════════════
describe("R-2 exit test: a fresh org with no connected Lob integration is refused on EVERY surface", () => {
  /** Each entry is one reachable counterparty-send surface from the map. */
  const surfaces: Array<{
    surface: string;
    run: () => Promise<{ refused: boolean; message: string }>;
  }> = [
    {
      surface: "S4 autopilot send_letter hand → mailProvider.sendLetter",
      run: async () => {
        const r = await mailProvider.sendLetter({
          to: ADDRESS,
          from: ADDRESS,
          file: "https://x/letter.pdf",
          organizationId: ORG,
        });
        return { refused: r.success === false, message: r.error ?? "" };
      },
    },
    {
      surface: "S4 mailProvider.sendPostcard",
      run: async () => {
        const r = await mailProvider.sendPostcard({
          to: ADDRESS,
          from: ADDRESS,
          front: "<p>f</p>",
          back: "<p>b</p>",
          organizationId: ORG,
        });
        return { refused: r.success === false, message: r.error ?? "" };
      },
    },
    {
      surface: "S1/S2 outreach queue + sequence cadence → directMailService.sendLetter",
      run: async () => {
        try {
          await directMailService.sendLetter({
            organizationId: ORG,
            senderIdentity: { companyName: "C", addressLine1: "1", city: "A", state: "TX", zipCode: "7" } as any,
            recipientName: "Jane",
            recipientAddress: { line1: "1", city: "A", state: "TX", zip: "7" },
            htmlContent: "<p>hi</p>",
          });
          return { refused: false, message: "" };
        } catch (err: any) {
          return { refused: isMailLaneRefusal(err), message: err?.message ?? "" };
        }
      },
    },
    {
      surface: "S1/S2 directMailService.sendPostcard",
      run: async () => {
        try {
          await directMailService.sendPostcard({
            organizationId: ORG,
            senderIdentity: { companyName: "C", addressLine1: "1", city: "A", state: "TX", zipCode: "7" } as any,
            recipientName: "Jane",
            recipientAddress: { line1: "1", city: "A", state: "TX", zip: "7" },
            frontHtml: "<p>f</p>",
            backHtml: "<p>b</p>",
          });
          return { refused: false, message: "" };
        } catch (err: any) {
          return { refused: isMailLaneRefusal(err), message: err?.message ?? "" };
        }
      },
    },
    {
      surface: "S3/S5 campaign blast + api job queue → directMail.sendLetter",
      run: async () => {
        try {
          await campaignMail.sendLetter({ file: "<p>x</p>", to: ADDRESS, from: ADDRESS }, "live", ORG);
          return { refused: false, message: "" };
        } catch (err: any) {
          return { refused: isMailLaneRefusal(err), message: err?.message ?? "" };
        }
      },
    },
    {
      surface: "S3/S5 directMail.sendPostcard",
      run: async () => {
        try {
          await campaignMail.sendPostcard(
            { size: "4x6", front: "f", back: "b", to: ADDRESS, from: ADDRESS },
            "live",
            ORG,
          );
          return { refused: false, message: "" };
        } catch (err: any) {
          return { refused: isMailLaneRefusal(err), message: err?.message ?? "" };
        }
      },
    },
    {
      surface: "S1 router chokepoint → lobAdapter.send",
      run: async () => {
        try {
          await lobAdapter.send(shipment());
          return { refused: false, message: "" };
        } catch (err: any) {
          return { refused: isMailLaneRefusal(err), message: err?.message ?? "" };
        }
      },
    },
  ];

  for (const { surface, run } of surfaces) {
    it(`refuses with a connect affordance and never constructs a Lob client — ${surface}`, async () => {
      state.orgKey = null; // fresh org: nothing connected
      state.tier = "pro"; // outside the free-tier activation wedge
      const { refused, message } = await run();

      expect(refused).toBe(true);
      // The affordance must actually be in the message a human reads.
      expect(message).toMatch(/Connect your Lob account/i);
      // THE OBSERVABLE CONSEQUENCE: no printer was ever addressed.
      expect(lobConstructions).toEqual([]);
      expect(lobCreates).toEqual([]);
    });
  }

  it("covers every counterparty-send surface the consolidation map lists", () => {
    // Guards against a surface being quietly dropped from the table above.
    expect(surfaces).toHaveLength(7);
    const covered = surfaces.map((s) => s.surface).join(" ");
    for (const marker of ["S1", "S2", "S3", "S4", "S5"]) {
      expect(covered).toContain(marker);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The door itself
// ═══════════════════════════════════════════════════════════════════════════
describe("assertMailLane", () => {
  it("refuses a send that cannot name its org — before touching any credential store", async () => {
    await expect(assertMailLane({ purpose: "counterparty", pieceCount: 1 })).rejects.toBeInstanceOf(
      MailLaneRefusal,
    );
    expect(resolveProviderCredential).not.toHaveBeenCalled();
    expect(resolvePlatformLobKey).not.toHaveBeenCalled();
  });

  it("uses the org's OWN key when connected and never resolves the platform key", async () => {
    state.orgKey = ORG_KEY;
    state.tier = "pro";
    const cred = await assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 250 });
    expect(cred).toEqual({ apiKey: ORG_KEY, source: "organization", isTestKey: true });
    expect(resolvePlatformLobKey).not.toHaveBeenCalled();
  });

  it("allows SYSTEM mail on the platform key (the sanctioned platform lane)", async () => {
    state.tier = "pro";
    const cred = await assertMailLane({ organizationId: ORG, purpose: "system", pieceCount: 1 });
    expect(cred.source).toBe("platform");
    expect(cred.apiKey).toBe(PLATFORM_KEY);
  });

  it("refuses counterparty mail on the platform key for a PAID org (no wedge)", async () => {
    state.tier = "pro";
    await expect(
      assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 1 }),
    ).rejects.toMatchObject({ details: { reason: "mail_byo_required", connectUrl: MAIL_CONNECT_URL } });
  });

  it("refuses honestly when no credential exists anywhere", async () => {
    state.platformKey = null;
    state.tier = "free";
    await expect(
      assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 1 }),
    ).rejects.toMatchObject({ details: { reason: "mail_not_configured" } });
  });

  it("resolves the org key through the DECRYPTING resolver, not a plaintext column read", async () => {
    // The bug this replaced: mailProvider read integration.credentials.apiKey
    // in the clear, so an org whose key was stored encrypted looked
    // unconnected and silently fell through to the platform key.
    state.orgKey = ORG_KEY;
    await assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 1 });
    expect(resolveProviderCredential).toHaveBeenCalledWith(ORG, {
      channel: "lob",
      legacyProvider: "lob",
      legacyField: "apiKey",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The registered wedge exception — exhausts at its cap and refuses the next
// ═══════════════════════════════════════════════════════════════════════════
describe("free-tier activation wedge (the one registered platform-key exception)", () => {
  beforeEach(() => {
    state.tier = "free";
    state.orgKey = null;
  });

  it("lets a free org's first pieces ride the platform key", async () => {
    state.piecesUsed = 0;
    const cred = await assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 3 });
    expect(cred.source).toBe("platform");
  });

  it("allows exactly up to the cap", async () => {
    state.piecesUsed = 0;
    const cred = await assertMailLane({
      organizationId: ORG,
      purpose: "counterparty",
      pieceCount: FREE_TIER_LIFETIME_PIECES,
    });
    expect(cred.source).toBe("platform");
  });

  it("EXHAUSTS at the cap and refuses the next piece", async () => {
    state.piecesUsed = FREE_TIER_LIFETIME_PIECES;
    await expect(
      assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 1 }),
    ).rejects.toMatchObject({
      details: { reason: "mail_free_wedge_spent", remainingPieces: 0, capPieces: FREE_TIER_LIFETIME_PIECES },
    });
  });

  it("refuses a batch that would OVERRUN the remaining wedge (partial batch is not partially sent)", async () => {
    state.piecesUsed = FREE_TIER_LIFETIME_PIECES - 2;
    await expect(
      assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 3 }),
    ).rejects.toMatchObject({
      details: { reason: "mail_free_wedge_cap", remainingPieces: 2, requestedPieces: 3 },
    });
  });

  it("refuses a whole campaign blast that exceeds the wedge — the cap now binds on every path, not just the queue route", async () => {
    state.piecesUsed = 0;
    await expect(
      assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 100 }),
    ).rejects.toMatchObject({ details: { reason: "mail_free_wedge_cap" } });
    expect(lobConstructions).toEqual([]);
  });

  it("does not charge a flushing shipment against its own cap — the exclusion reaches the query, and only when asked for", async () => {
    state.piecesUsed = 0;

    // WITHOUT an exclusion: the shipment id must NOT appear in the predicate.
    await assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 2 });
    const withoutExclusion = state.lastWedgeWhere;
    expect(withoutExclusion.length).toBeGreaterThan(0);
    expect(withoutExclusion).not.toContain("814377");

    // WITH one: it must. Both directions, so a mock that always "sees" the
    // exclusion (or never does) fails this pair.
    await assertMailLane({
      organizationId: ORG,
      purpose: "counterparty",
      pieceCount: 2,
      excludeShipmentId: 814377,
    });
    expect(state.lastWedgeWhere).toContain("814377");
  });

  it("the flusher supplies that exclusion for the shipment it is sending", async () => {
    const { buildRouterShipment } = await import("../../server/services/mail/mailFlusher");
    const built = buildRouterShipment(
      {
        id: 4242,
        organizationId: ORG,
        pieceType: "letter_10",
        speed: "standard",
        copySnapshot: "<p>x</p>",
        debitEventKey: "k",
        debitedCents: 100,
      },
      [{ id: 1, recipientName: "Jane", addressLine1: "1 St", city: "A", state: "TX", zip: "7" }],
    );
    expect(built.purpose).toBe("counterparty");
    expect(built.wedgeExcludeShipmentId).toBe(4242);
  });

  it("lobAdapter forwards the shipment exclusion into the lane query", async () => {
    state.orgKey = null;
    state.tier = "free";
    state.piecesUsed = 0;
    await lobAdapter.send(shipment({ wedgeExcludeShipmentId: 555001 }));
    expect(state.lastWedgeWhere).toContain("555001");
  });

  it("a connected org is NEVER wedge-capped — its own key, its own bill", async () => {
    state.orgKey = ORG_KEY;
    state.piecesUsed = 10_000;
    const cred = await assertMailLane({ organizationId: ORG, purpose: "counterparty", pieceCount: 500 });
    expect(cred.source).toBe("organization");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The allowed paths actually send — with the RIGHT key
// ═══════════════════════════════════════════════════════════════════════════
describe("allowed sends reach Lob with the correct credential", () => {
  it("BYO key: the org's key prints, and the platform key is never resolved", async () => {
    state.orgKey = ORG_KEY;
    state.tier = "pro";
    const r = await mailProvider.sendLetter({
      to: ADDRESS,
      from: ADDRESS,
      file: "https://x/l.pdf",
      organizationId: ORG,
    });
    expect(r.success).toBe(true);
    expect(lobConstructions).toEqual([ORG_KEY]);
    expect(lobCreates.map((c) => c.apiKey)).toEqual([ORG_KEY]);
    expect(resolvePlatformLobKey).not.toHaveBeenCalled();
  });

  it("wedge send: the PLATFORM key prints, for a free org inside the cap", async () => {
    state.orgKey = null;
    state.tier = "free";
    state.piecesUsed = 1;
    const r = await mailProvider.sendLetter({
      to: ADDRESS,
      from: ADDRESS,
      file: "https://x/l.pdf",
      organizationId: ORG,
    });
    expect(r.success).toBe(true);
    expect(lobConstructions).toEqual([PLATFORM_KEY]);
  });

  it("lobAdapter passes the batch-cleared credential straight through to the pieces", async () => {
    state.orgKey = ORG_KEY;
    state.tier = "pro";
    const result = await lobAdapter.send(
      shipment({
        pieces: [
          {
            recipient: { firstName: "A", address1: "1", city: "A", state: "TX", zip: "7" },
            pieceType: "letter_10",
            vars: { htmlContent: "<p>a</p>" },
          },
          {
            recipient: { firstName: "B", address1: "2", city: "A", state: "TX", zip: "7" },
            pieceType: "letter_10",
            vars: { htmlContent: "<p>b</p>" },
          },
        ],
      }),
    );
    expect(result.pieces).toHaveLength(2);
    expect(lobCreates.map((c) => c.apiKey)).toEqual([ORG_KEY, ORG_KEY]);
    // Batch-level lane check runs ONCE, not once per piece.
    expect(resolveProviderCredential).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. A lane refusal must NOT fall through to another provider
// ═══════════════════════════════════════════════════════════════════════════
describe("MailRouter does not re-front a refusal through a second vendor", () => {
  beforeEach(() => {
    enabledProviders.value = JSON.stringify(["lob", "postgrid"]);
  });

  it("production default enables LOB ONLY — no other adapter is reachable without a deliberate founder setting", async () => {
    // Honest scope note: assertMailLane guards the LOB adapter. PostGrid and
    // the batch adapters are NOT lane-guarded (out of this lane's fence), so
    // the containment claim rests on them being unreachable by default.
    enabledProviders.value = null;
    const fallbackSend = vi.fn();
    __setMailRouterRegistry([
      lobAdapter as any,
      {
        name: "postgrid",
        isConfigured: () => true,
        quote: async () => ({
          provider: "postgrid",
          costPerPieceCents: 1,
          deliveryEtaDays: 5,
          minVolume: 1,
          meetsConstraints: true,
        }),
        send: fallbackSend,
      } as any,
    ]);
    state.orgKey = null;
    state.tier = "pro";
    await expect(new MailRouter().route(shipment())).rejects.toBeTruthy();
    expect(fallbackSend).not.toHaveBeenCalled();
  });

  /** A provider that quotes MORE than lob, so lob is always tried first. */
  const pricierFallback = (send: any) =>
    ({
      name: "postgrid",
      isConfigured: () => true,
      quote: async () => ({
        provider: "postgrid",
        costPerPieceCents: 9_999,
        deliveryEtaDays: 5,
        minVolume: 1,
        meetsConstraints: true,
      }),
      send,
    }) as any;

  it("STILL falls through on an ordinary provider failure (the rule is specific to refusals)", async () => {
    // The negative half: without this, "never falls through" could be
    // satisfied by a router that simply never falls through at all.
    const fallbackSend = vi.fn(async () => ({
      provider: "postgrid",
      providerEventId: "pg_1",
      pieces: [{ providerPieceId: "pg_p1", recipientRef: `${ORG}` }],
      totalCostCents: 10,
    }));
    const brokenLob = {
      ...lobAdapter,
      send: async () => {
        throw new Error("Lob 503 — transient printer outage");
      },
    } as any;
    __setMailRouterRegistry([brokenLob, pricierFallback(fallbackSend)]);

    state.orgKey = ORG_KEY;
    state.tier = "pro";

    const route = await new MailRouter().route(shipment());
    expect(route.chosenProvider).toBe("postgrid");
    expect(fallbackSend).toHaveBeenCalledTimes(1);
  });

  it("but a LANE REFUSAL aborts the route rather than degrading to another vendor", async () => {
    const fallbackSend = vi.fn(async () => ({
      provider: "postgrid",
      providerEventId: "pg_1",
      pieces: [],
      totalCostCents: 10,
    }));
    __setMailRouterRegistry([lobAdapter as any, pricierFallback(fallbackSend)]);

    state.orgKey = null;
    state.tier = "pro";

    const err = await new MailRouter().route(shipment()).catch((e) => e);
    expect(isMailLaneRefusal(err)).toBe(true);
    expect(err.message).toMatch(/Connect your Lob account/i);
    expect(fallbackSend).not.toHaveBeenCalled();
    expect(lobConstructions).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Status surfaces report the org's truth, never the process's
// ═══════════════════════════════════════════════════════════════════════════
describe("mailLaneStatus", () => {
  it("reports a refusal + connect affordance for an unconnected paid org", async () => {
    state.orgKey = null;
    state.tier = "pro";
    const s = await mailLaneStatus(ORG);
    expect(s.canSendCounterparty).toBe(false);
    expect(s.connected).toBe(false);
    expect(s.refusal?.reason).toBe("mail_byo_required");
    expect(s.connectUrl).toBe(MAIL_CONNECT_URL);
  });

  it("reports connected + no wedge for a BYO org", async () => {
    state.orgKey = ORG_KEY;
    state.tier = "pro";
    const s = await mailLaneStatus(ORG);
    expect(s).toMatchObject({ connected: true, source: "organization", canSendCounterparty: true, wedgeRemaining: null });
  });

  it("reports the remaining wedge for a free org", async () => {
    state.orgKey = null;
    state.tier = "free";
    state.piecesUsed = 2;
    const s = await mailLaneStatus(ORG);
    expect(s).toMatchObject({ connected: false, source: "platform", canSendCounterparty: true });
    expect(s.wedgeRemaining).toBe(FREE_TIER_LIFETIME_PIECES - 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. DERIVED containment — no second door, and no send path reads env keys
// ═══════════════════════════════════════════════════════════════════════════
describe("derived containment (mirrors scripts/check-mail-lane.mjs)", () => {
  const CRED_RE = /\b(LOB_API_KEY|LOB_TEST_API_KEY|LOB_LIVE_API_KEY|LOB_LIVE_SEND_ENABLED)\b/;

  it("every file that constructs a Lob client resolves its key through mailLanes and reads no env key", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    const { join } = await import("node:path");
    const repo = join(__dirname, "..", "..");
    const tracked = execSync("git ls-files", { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);

    // A Lob CLIENT both imports the `lob` package and constructs it. Requiring
    // the import keeps prose that merely quotes the constructor out of the set.
    const NEW_LOB = /^(?!\s*(?:\/\/|\*|\/\*)).*\bnew\s+Lob\s*\(/m;
    const IMPORTS_LOB = /(?:^|\n)\s*import\s+[^;]*\bfrom\s+['"]lob['"]|require\(\s*['"]lob['"]\s*\)/;
    const clients = tracked.filter((p) => {
      if (!/^(server|client|shared|scripts)\/.*\.(ts|tsx|mjs|js)$/.test(p)) return false;
      if (p === "server/services/mail/mailLanes.ts") return false;
      if (!existsSync(join(repo, p))) return false;
      const src = readFileSync(join(repo, p), "utf8");
      return IMPORTS_LOB.test(src) && NEW_LOB.test(src);
    });

    // Derived, not hardcoded: if a FIFTH Lob client appears anywhere, it must
    // still satisfy both conditions or this reddens.
    expect(clients.length).toBeGreaterThan(0);
    for (const p of clients) {
      const src = readFileSync(join(repo, p), "utf8");
      expect(src, `${p} must resolve its credential through mail/mailLanes`).toContain("mail/mailLanes");
      expect(CRED_RE.test(src), `${p} must not read a Lob credential env var`).toBe(false);
    }
  });

  it("lobService.ts is gone and nothing imports it", async () => {
    const { execSync } = await import("node:child_process");
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const repo = join(__dirname, "..", "..");
    // Disk, not `git ls-files` — the index can lag a working-tree deletion,
    // and "the dead client is gone" is a fact about the code, not the index.
    expect(existsSync(join(repo, "server/services/lobService.ts"))).toBe(false);

    const importers = execSync(
      `git grep -l "from ['\\"].*lobService['\\"]" -- '*.ts' '*.tsx' || true`,
      { cwd: repo, encoding: "utf8" },
    ).trim();
    expect(importers).toBe("");
  });
});
