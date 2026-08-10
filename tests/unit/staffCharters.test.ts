/**
 * Wave S — S1 (charters over gates) + S2 (autonomy follows perception).
 *
 * Pins:
 *   1. CHARTER COVERAGE — every Trust-Ledger domain plus Beatrice/compliance
 *      carries a charter with a non-empty mandate and core senses, and every
 *      core-sense key resolves in the SENSE_INVENTORY (a typo'd key would
 *      read as unwired — fail-safe, but named here).
 *   2. SENSE-INVENTORY HONESTY — mechanical: every wired entry's symbol
 *      appears in its loader module AND in every consumer file it claims
 *      (tick = continuousLoop.ts, context-pack = cognitionContext.ts); the
 *      declared gaps carry honest gap notes, and the drift pins prove the
 *      gaps are still real at HEAD (wiring one without updating the
 *      inventory + charter turns this red by name).
 *   3. HANDS ⊆ REGISTRY — handsGranted is DERIVED from the real hands
 *      registry, so a new hand is automatically chartered under its domain
 *      or this suite names it.
 *   4. PROMOTION FOLLOWS PERCEPTION — the pure gate refuses past-draft
 *      promotion while any core sense is unwired, and recordCleanCycle does
 *      NOT mint the founder promotion card in that state (observe → draft
 *      still cards). Restriction only — nothing here widens autonomy.
 *   5. HONEST ABSENCE — with every metric source down, getStaffCharters
 *      returns null values (never invented numbers) and composes the
 *      Letter's blindness lines.
 *   6. SURFACE PINS — the founder endpoint exists in routes-autopilot.ts,
 *      the Controls hub renders the Staff tab, and the Letter renders the
 *      blindness lines from the same charters endpoint.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Chainable, thenable drizzle-db mock (orgTrust/commHands house pattern) ──
const dbState: { selectRows: unknown[]; updateSets: Array<Record<string, unknown>> } = {
  selectRows: [],
  updateSets: [],
};
vi.mock("../../server/db", () => {
  const chain: any = {};
  for (const m of ["select", "from", "where", "orderBy", "limit", "groupBy", "innerJoin", "leftJoin"]) {
    chain[m] = () => chain;
  }
  // Awaiting the chain at ANY link resolves the configured rows.
  chain.then = (res: any, rej: any) => Promise.resolve(dbState.selectRows).then(res, rej);
  return {
    db: {
      ...chain,
      update: () => ({
        set: (v: Record<string, unknown>) => {
          dbState.updateSets.push(v);
          return { where: () => Promise.resolve() };
        },
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => Promise.resolve(),
          onConflictDoUpdate: () => Promise.resolve(),
          returning: () => Promise.resolve([{}]),
        }),
      }),
    },
  };
});

// ── The hands are thin adapters — mock the services they wrap ───────────────
vi.mock("../../server/services/emailService", () => ({ sendEmail: vi.fn() }));
vi.mock("../../server/services/emailSuppressions", () => ({ filterSuppressed: vi.fn() }));
vi.mock("../../server/services/smsService", () => ({ sendSMSToLead: vi.fn() }));
vi.mock("../../server/services/mailProvider", () => ({ sendLetter: vi.fn() }));
vi.mock("../../server/services/pushNotificationService", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../../server/services/dunning", () => ({ dunningService: {} }));

// ── Charter metric sources — ALL DOWN, to prove refuse-not-fabricate ────────
vi.mock("../../server/services/solene/continuousLoop", () => ({
  getLatestMorningPulse: async () => null,
}));
vi.mock("../../server/services/autopilot/perception", () => ({
  readOutwardSenses: async () => {
    throw new Error("perception down");
  },
  outwardSignalFrom: () => {
    throw new Error("perception down");
  },
}));
vi.mock("../../server/services/autopilot/attribution", () => ({
  getConversionSummary: async () => {
    throw new Error("attribution down");
  },
}));
vi.mock("../../server/services/autopilot/reflexes", () => ({
  readReflexHealth: async () => {
    throw new Error("reflexes down");
  },
}));
vi.mock("../../server/services/solene/capitalTracker", () => ({
  getEffectiveMonthlyCapUsd: async () => {
    throw new Error("books down");
  },
  getMonthToDateSpendForType: async () => {
    throw new Error("books down");
  },
}));
vi.mock("../../server/services/autopilot/standingOrders", () => ({
  listStandingOrders: async () => {
    throw new Error("orders down");
  },
}));

// ── The promotion-card seam + the holds recordCleanCycle dynamic-imports ────
const { requestPromotionMock } = vi.hoisted(() => ({
  requestPromotionMock: vi.fn(async () => ({ created: true, reason: "ok" })),
}));
vi.mock("../../server/services/autopilot/promotionRequest", () => ({
  requestPromotion: requestPromotionMock,
}));
vi.mock("../../server/services/autopilot/experienceLog", () => ({
  getCalibrationPairs: async () => [],
}));
vi.mock("../../server/services/autopilot/forecast", () => ({
  calibrationReport: () => ({ grade: "insufficient-data", n: 0 }),
}));
vi.mock("../../server/services/autopilot/decisionEval", () => ({
  shouldHoldPromotionForQuality: async () => false,
}));

import {
  CHARTER_DEFS,
  charterCoreSenses,
  charterHandSpecs,
  deriveBlindSpots,
  getCharterDef,
  getStaffCharters,
  promotionPerceptionGate,
  type CharterDomain,
} from "../../server/services/autopilot/charters";
import { SENSE_INVENTORY, senseIsWired } from "../../server/services/autopilot/senses";
import { AUTOPILOT_DOMAINS, recordCleanCycle } from "../../server/services/autopilot/domainAutonomy";
import { listHandSpecs } from "../../server/services/autopilot/hands";
import type { AutopilotDomain } from "../../server/services/autopilot/policyGate";

beforeEach(() => {
  dbState.selectRows = [];
  dbState.updateSets = [];
  requestPromotionMock.mockClear();
});

// ─── 1. Charter coverage ────────────────────────────────────────────────────

describe("charter coverage — every domain is a charter, not a bare gate", () => {
  it("charters exactly the five Trust-Ledger domains plus Beatrice (compliance)", () => {
    const chartered = CHARTER_DEFS.map((c) => c.domain).sort();
    const expected = [...AUTOPILOT_DOMAINS, "compliance"].sort();
    expect(chartered).toEqual(expected);
  });

  it("every charter has a real mandate and non-empty core senses", () => {
    for (const def of CHARTER_DEFS) {
      expect(def.mandate.trim().length, `${def.domain} mandate`).toBeGreaterThan(40);
      expect(def.displayName.trim().length, `${def.domain} displayName`).toBeGreaterThan(0);
      expect(def.coreSenseKeys.length, `${def.domain} coreSenses`).toBeGreaterThan(0);
    }
  });

  it("every core-sense key resolves in the SENSE_INVENTORY (typo guard)", () => {
    const known = new Set(SENSE_INVENTORY.map((s) => s.key));
    for (const def of CHARTER_DEFS) {
      for (const key of def.coreSenseKeys) {
        expect(known.has(key), `charter ${def.domain} references unknown sense "${key}"`).toBe(true);
      }
    }
  });
});

// ─── 2. Sense-inventory honesty (mechanical pins) ───────────────────────────

describe("sense inventory — wired means the loader exists AND the brain reads it", () => {
  const CONSUMER_FILE: Record<string, string> = {
    tick: "server/services/solene/continuousLoop.ts",
    "context-pack": "server/services/autopilot/cognitionContext.ts",
  };

  it("every wired entry's symbol appears in its loader module and every claimed consumer", () => {
    for (const s of SENSE_INVENTORY) {
      if (!s.source) continue;
      const moduleSrc = read(s.source.module);
      expect(
        moduleSrc.includes(s.source.symbol),
        `${s.key}: symbol "${s.source.symbol}" not found in ${s.source.module}`,
      ).toBe(true);
      for (const consumer of s.consumedBy) {
        const consumerSrc = read(CONSUMER_FILE[consumer]);
        expect(
          consumerSrc.includes(s.source.symbol),
          `${s.key}: claimed consumer "${consumer}" (${CONSUMER_FILE[consumer]}) does not reference "${s.source.symbol}"`,
        ).toBe(true);
      }
    }
  });

  it("wired ⇔ loader present AND consumed; every declared gap carries its honest note", () => {
    for (const s of SENSE_INVENTORY) {
      expect(senseIsWired(s.key)).toBe(s.source != null && s.consumedBy.length > 0);
      if (!s.source) {
        expect(s.consumedBy.length, `${s.key} is a gap but claims consumers`).toBe(0);
        expect((s.gap ?? "").length, `${s.key} gap note missing`).toBeGreaterThan(10);
      }
    }
  });

  it("drift pins — the declared gaps are still real at HEAD (wiring one must update the inventory)", () => {
    // activation_funnel: the tick still never feeds DecisionSenses.activationStalled.
    const tick = read("server/services/solene/continuousLoop.ts");
    expect(
      tick.includes("activationStalled"),
      "continuousLoop now feeds activationStalled — wire the activation_funnel sense in SENSE_INVENTORY + the growth charter, and update this pin",
    ).toBe(false);
    // support_sla_timers: the context pack still never measures first-response.
    const pack = read("server/services/autopilot/cognitionContext.ts");
    // Assignment (`raw.x = …`), not comparison (`raw.x == null` is the honesty label).
    expect(
      /raw\.supportFirstResponseHours\s*=[^=]/.test(pack),
      "cognitionContext now measures supportFirstResponseHours — wire the support_sla_timers sense and update this pin",
    ).toBe(false);
  });
});

// ─── 3. handsGranted ⊆ the real registry (derived) ──────────────────────────

describe("hands are chartered — a hand outside every charter is named here", () => {
  it("registers the real hands (the registry is not empty in this suite)", () => {
    expect(listHandSpecs().length).toBeGreaterThanOrEqual(7);
  });

  it("every registered hand belongs to a chartered domain, and derivation is exact both ways", () => {
    const specs = listHandSpecs();
    for (const h of specs) {
      const def = getCharterDef(h.domain as CharterDomain);
      expect(def, `hand "${h.name}" (domain=${h.domain}) has NO charter — charter it or re-domain it`).toBeTruthy();
      expect(charterHandSpecs(h.domain as CharterDomain).map((s) => s.name)).toContain(h.name);
    }
    const allChartered = CHARTER_DEFS.flatMap((c) => charterHandSpecs(c.domain).map((s) => s.name)).sort();
    const allRegistered = specs.map((h) => h.name).sort();
    expect(allChartered).toEqual(allRegistered);
  });
});

// ─── 4. S2 — promotion follows perception ───────────────────────────────────

describe("promotion follows perception — no domain past draft with unwired core senses", () => {
  it("current truth: every Trust-Ledger domain still has at least one unwired core sense", () => {
    // Addendum C's honest gap (b): perception is thin relative to judgment.
    // When a wave wires a domain's full core-sense set, it must update the
    // charter + SENSE_INVENTORY — and rewrite this pin to the new truth
    // (wave discipline #4: update the pinned test, never delete it).
    for (const domain of AUTOPILOT_DOMAINS) {
      const unwired = charterCoreSenses(domain).filter((s) => !s.wired);
      expect(unwired.length, `${domain} has no unwired core senses — update the S2 pins to the new truth`).toBeGreaterThan(0);
    }
  });

  it("the pure gate: past-draft targets refuse while blind; draft and below always pass", () => {
    for (const domain of AUTOPILOT_DOMAINS) {
      expect(promotionPerceptionGate(domain, "draft").allowed).toBe(true);
      expect(promotionPerceptionGate(domain, "observe").allowed).toBe(true);
      for (const target of ["execute_gated", "autonomous_gated"] as const) {
        const verdict = promotionPerceptionGate(domain, target);
        expect(verdict.allowed, `${domain} → ${target} should refuse while blind`).toBe(false);
        expect(verdict.reason).toMatch(/past draft/);
        expect(verdict.reason).toMatch(/cannot yet see/);
      }
    }
  });

  it("an UNCHARTERED domain refuses past-draft promotion too — the gate fails safe, not open", () => {
    // Fleet-7 verifier catch: an unknown domain used to yield zero core
    // senses and therefore pass. The coverage pin above makes that state
    // unreachable in CI, but the runtime rule must fail safe on its own.
    const verdict = promotionPerceptionGate("nonexistent_domain" as AutopilotDomain, "execute_gated");
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/no charter on file/);
    // Draft and below stay unaffected — the gate only ever restricts.
    expect(promotionPerceptionGate("nonexistent_domain" as AutopilotDomain, "draft").allowed).toBe(true);
  });

  it("recordCleanCycle does NOT mint the promotion card past draft while blind (counter still accrues)", async () => {
    // draft + threshold reached → the card would previously have been requested.
    dbState.selectRows = [{ level: "draft", cleanCycleCount: 9 }];
    const level = await recordCleanCycle("growth" as AutopilotDomain, 10);
    expect(level).toBe("draft");
    expect(requestPromotionMock).not.toHaveBeenCalled();
    // The clean-cycle counter still accrued — the refusal is a hold, not a wipe.
    expect(dbState.updateSets.some((s) => s.cleanCycleCount === 10)).toBe(true);
  });

  it("observe → draft still cards: drafting is how a domain earns its eyes", async () => {
    dbState.selectRows = [{ level: "observe", cleanCycleCount: 9 }];
    const level = await recordCleanCycle("growth" as AutopilotDomain, 10);
    expect(level).toBe("observe"); // the founder's tap applies the level, never this path
    expect(requestPromotionMock).toHaveBeenCalledTimes(1);
  });
});

// ─── 5. Honest absence — metrics are real-or-null, never invented ───────────

describe("getStaffCharters with every source down — refuse-not-fabricate", () => {
  it("returns all six charters with null metrics, Beatrice off-ledger, and composed blindness lines", async () => {
    dbState.selectRows = []; // trust ledger + receipts reads come back empty
    const { charters, blindSpots } = await getStaffCharters();

    expect(charters).toHaveLength(6);
    for (const c of charters) {
      expect(c.mandate.length).toBeGreaterThan(0);
      expect(c.coreSenses.length).toBeGreaterThan(0);
      expect(c.escalationRules.length).toBeGreaterThan(0);
      expect(c.reportCadence.length).toBeGreaterThan(0);
      for (const m of c.metricsOwned) {
        if (m.key === "support_backlog") {
          // getOpenSupportCaseCount's documented contract is the honest ZERO
          // ("we never fabricate a backlog") — a zero backlog is safe in the
          // pressure direction, so the loader swallows failures to 0.
          expect(m.value).toBe(0);
        } else {
          expect(m.value, `${c.domain}.${m.key} fabricated a value with its source down`).toBeNull();
        }
      }
      expect(c.budget).toBeNull();
      expect(c.receipts).toEqual([]);
    }

    const beatrice = charters.find((c) => c.domain === "compliance");
    expect(beatrice?.ladder.onLedger).toBe(false);
    expect(beatrice?.ladder.note).toMatch(/not yet on the trust ledger/i);
    expect(beatrice?.ladder.level).toBeUndefined();

    // The blindness lines derive from the same registry the gate enforces.
    expect(blindSpots.length).toBeGreaterThan(0);
    for (const b of blindSpots) {
      expect(b.line.startsWith("I cannot yet see ")).toBe(true);
      expect(b.blinds.length).toBeGreaterThan(0);
    }
    const derived = deriveBlindSpots();
    expect(blindSpots.map((b) => b.senseKey).sort()).toEqual(derived.map((b) => b.senseKey).sort());
    // Every charter's unwired sense appears in the blind-spot set.
    for (const def of CHARTER_DEFS) {
      for (const s of charterCoreSenses(def.domain).filter((x) => !x.wired)) {
        expect(blindSpots.some((b) => b.senseKey === s.key), `${def.domain}: ${s.key} missing from blind spots`).toBe(true);
      }
    }
  });
});

// ─── 6. Surface pins — endpoint, Staff tab, Letter lines ────────────────────

describe("the staff surfaces are wired (built-but-unwired guard)", () => {
  it("routes-autopilot.ts mounts GET /api/founder/autopilot/charters behind requireFounder", () => {
    const src = read("server/routes-autopilot.ts");
    expect(src).toContain('"/api/founder/autopilot/charters"');
    expect(src).toContain("getStaffCharters");
    // The endpoint sits inside the founder-guarded registration like its siblings.
    expect(src).toContain("requireFounder");
  });

  it("the Controls hub renders the Staff tab (a tab of the existing hub — never a new route)", () => {
    const src = read("client/src/pages/founder/autopilot-control.tsx");
    expect(src).toMatch(/\{\s*value:\s*"staff",\s*label:\s*"The Staff"\s*\}/);
    expect(src).toMatch(/<TabsContent value="staff">/);
    expect(src).toContain("<StaffCharterCards");
    expect(src).toContain('from "@/components/founder/StaffCharterCards"');
  });

  it("the Letter renders the blindness lines from the charters endpoint", () => {
    const home = read("client/src/pages/founder/home.tsx");
    expect(home).toContain("<StaffBlindnessLines");
    const component = read("client/src/components/founder/StaffCharterCards.tsx");
    expect(component).toContain('"/api/founder/autopilot/charters"');
    expect(component).toContain('data-testid="letter-blindness-lines"');
    expect(component).toContain('data-testid="staff-charter-cards"');
    // Unwired senses are visibly marked, and a failed read says so.
    expect(component).toContain("can't see yet");
    expect(component).toContain('data-testid="letter-blindness-error"');
  });
});
