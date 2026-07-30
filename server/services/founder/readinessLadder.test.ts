/**
 * Tests for the Founder Readiness Ladder — the founder's own onboarding.
 *
 * The invariants under test are the ones that make this surface trustworthy
 * rather than decorative:
 *
 *   1. An UNPROVISIONED secret renders NOT DONE. No hopeful defaults.
 *   2. An UNDETERMINABLE rung renders "can't verify" — never done. This is the
 *      dormant-watchdog rule generalized: a signal we cannot read is never
 *      shown green.
 *   3. A COMPLETED rung DROPS OUT of the ladder (surviving as history), so the
 *      surface consumes itself as the machine takes over.
 *   4. RUNG ORDER RESPECTS DEPENDENCIES — you cannot be told to arm a watchdog
 *      before its code-host connection exists.
 *   5. No DATABASE_URL is required (every DB touch is mocked).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Togglable world state ────────────────────────────────────────────────────
// Every value here stands in for a REAL measurement the service performs.

/** provider.field → resolution source, exactly as the connections hub reports. */
let connectionSources: Record<string, "db" | "env" | "missing"> = {};
let connectionsThrow = false;
let githubCreds: { token: string | null; repository: string | null } = { token: null, repository: null };

let stripePrices: number | null = 0;
let stripeThrows = false;

let liveSendArmed = false;
let sentShipments: Array<{ id: number }> = [];
let mailLedgerThrows = false;

let stopLoss = {
  lineCents: 50_000,
  mtdSpendCents: 1_234 as number | null,
  mailCents: 1_000,
  dataCents: 234,
  paused: false,
  reason: "within the line",
  monthKey: "2026-07",
  acknowledgedAtCents: null,
  effectiveThresholdCents: 50_000,
};
let capStatus = { monthToDateUsd: 4, capUsd: 50, redThresholdUsd: 45, exceeded: false, readFailed: false };

let ledgerLevels: Array<{ domain: string; level: string; cleanCycleCount: number }> = [
  { domain: "growth", level: "observe", cleanCycleCount: 0 },
  { domain: "support", level: "observe", cleanCycleCount: 3 },
];
let ledgerThrows = false;
let grants: Array<{ expiresAt: Date; maxActions: number; usedCount: number }> = [];

/** GitHub Actions secret NAMES the fake code host reports (never values). */
let repoSecretNames: string[] = [];
let repoSecretsHttpStatus = 200;
let repoSecretsThrows = false;

vi.mock("../connections/platformConnections", () => ({
  resolveConnection: async (provider: string, field: string) => {
    if (connectionsThrow) throw new Error("connections layer down");
    const source = connectionSources[`${provider}.${field}`] ?? "missing";
    return { value: source === "missing" ? null : "x", source };
  },
  resolveGithubCredentials: async () => {
    if (connectionsThrow) throw new Error("connections layer down");
    return githubCreds;
  },
}));

vi.mock("../../stripeService", () => ({
  stripeService: {
    listProductsWithPrices: async () => {
      if (stripeThrows) throw new Error("Invalid API key provided");
      return Array.from({ length: stripePrices ?? 0 }, (_, i) => ({ product_id: `p${i}`, prices: [{ price_id: `pr${i}` }] }));
    },
  },
}));

vi.mock("../mail/liveSendInterlock", () => ({ isLiveSendArmed: () => liveSendArmed }));

vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          if (mailLedgerThrows) return Promise.reject(new Error("mail ledger unreadable"));
          return Promise.resolve(sentShipments);
        },
      }),
    }),
  },
}));

vi.mock("../outreachStopLoss", () => ({ getOutreachStopLossStatus: async () => stopLoss }));
vi.mock("../solene/capitalTracker", () => ({ getEnsembleCapStatus: async () => capStatus }));
vi.mock("../autopilot/witnessGrantStore", () => ({ liveGrantsFor: async () => grants }));
vi.mock("../autopilot/domainAutonomy", () => ({
  getTrustLedger: async () => {
    if (ledgerThrows) throw new Error("trust ledger unreadable");
    return ledgerLevels.map((e) => ({ ...e, threshold: 10, lastPromotedAt: null, lastDemotedAt: null, lastDemotionReason: null }));
  },
}));

import { buildFounderReadinessLadder, orderRungs, RUNG_SPECS, WATCHDOG_SECRET_NAMES } from "./readinessLadder";

const originalFetch = globalThis.fetch;

function armFetchMock() {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/actions/secrets")) {
      if (repoSecretsThrows) throw new Error("code host unreachable");
      return {
        ok: repoSecretsHttpStatus === 200,
        status: repoSecretsHttpStatus,
        json: async () => ({ secrets: repoSecretNames.map((name) => ({ name })) }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as typeof globalThis.fetch;
}

/** Every secret provisioned, every rail proven, everything granted. */
function armFullyReadyWorld() {
  connectionSources = {
    "openrouter.api_key": "db",
    "anthropic.api_key": "env",
    "paging.topic": "db",
    "paging.founder_email": "db",
    "stripe.secret_key": "db",
    "lob.live_key": "db",
    "lob.test_key": "db",
  };
  connectionsThrow = false;
  githubCreds = { token: "ghp_x", repository: "tom/acreos" };
  stripePrices = 2;
  stripeThrows = false;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  process.env.APP_URL = "https://acreos.io";
  process.env.AWS_ACCESS_KEY_ID = "AKIA";
  process.env.AWS_SECRET_ACCESS_KEY = "s";
  process.env.AWS_SES_FROM_EMAIL = "no-reply@acreos.io";
  process.env.ATTOM_API_KEY = "a";
  process.env.REGRID_API_KEY = "r";
  liveSendArmed = true;
  sentShipments = [{ id: 1 }];
  mailLedgerThrows = false;
  stopLoss = { ...stopLoss, mtdSpendCents: 1_234, paused: false };
  capStatus = { monthToDateUsd: 4, capUsd: 50, redThresholdUsd: 45, exceeded: false, readFailed: false };
  ledgerLevels = [
    { domain: "growth", level: "execute_gated", cleanCycleCount: 7 },
    { domain: "support", level: "autonomous_gated", cleanCycleCount: 12 },
  ];
  ledgerThrows = false;
  grants = [{ expiresAt: new Date(Date.now() + 3 * 86_400_000), maxActions: 10, usedCount: 2 }];
  repoSecretNames = [...WATCHDOG_SECRET_NAMES];
  repoSecretsHttpStatus = 200;
  repoSecretsThrows = false;
}

/** Nothing provisioned at all — a genuinely fresh platform. */
function armEmptyWorld() {
  connectionSources = {};
  connectionsThrow = false;
  githubCreds = { token: null, repository: null };
  stripePrices = 0;
  stripeThrows = false;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.APP_URL;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_SES_FROM_EMAIL;
  delete process.env.ATTOM_API_KEY;
  delete process.env.REGRID_API_KEY;
  liveSendArmed = false;
  sentShipments = [];
  mailLedgerThrows = false;
  stopLoss = { ...stopLoss, mtdSpendCents: 1_234, paused: false };
  capStatus = { monthToDateUsd: 0, capUsd: 50, redThresholdUsd: 45, exceeded: false, readFailed: false };
  ledgerLevels = [
    { domain: "growth", level: "observe", cleanCycleCount: 0 },
    { domain: "support", level: "observe", cleanCycleCount: 3 },
  ];
  ledgerThrows = false;
  grants = [];
  repoSecretNames = [];
  repoSecretsHttpStatus = 200;
  repoSecretsThrows = false;
}

const rung = (l: Awaited<ReturnType<typeof buildFounderReadinessLadder>>, key: string) =>
  l.rungs.find((r) => r.key === key);

beforeEach(() => {
  armEmptyWorld();
  armFetchMock();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

// ── 1. Nothing is done on a hopeful default ──────────────────────────────────

describe("an unprovisioned secret renders NOT done", () => {
  it("a fresh platform has ZERO done rungs and every rung is open", async () => {
    const l = await buildFounderReadinessLadder();
    expect(l.doneCount).toBe(0);
    expect(l.completed).toEqual([]);
    expect(l.rungs).toHaveLength(l.totalCount);
    expect(l.complete).toBe(false);
    // Not a single rung may claim done anywhere in the payload.
    expect(l.rungs.every((r) => r.state !== "done")).toBe(true);
  });

  it("the brain rung is not_done and names the missing key without inventing one", async () => {
    const l = await buildFounderReadinessLadder();
    const brain = rung(l, "brain");
    expect(brain?.state).toBe("not_done");
    expect(brain?.evidence).toMatch(/No model key resolves/);
    expect(brain?.action).toBeTruthy();
  });

  it("a resolvable model key flips the brain rung — and only that rung", async () => {
    connectionSources["openrouter.api_key"] = "env";
    const l = await buildFounderReadinessLadder();
    expect(rung(l, "brain")).toBeUndefined(); // dropped out (done)
    expect(l.completed.map((c) => c.key)).toEqual(["brain"]);
    expect(rung(l, "reach_you")?.state).toBe("not_done");
  });

  it("Stripe with a working key but ZERO prices is not_done, not done", async () => {
    process.env.APP_URL = "https://acreos.io";
    connectionSources["stripe.secret_key"] = "db";
    stripePrices = 0;
    const l = await buildFounderReadinessLadder();
    expect(rung(l, "billing")?.state).toBe("not_done");
    expect(rung(l, "billing")?.evidence).toMatch(/ZERO active prices/);
  });

  it("Stripe working + priced but with NO webhook secret stays not_done (the quiet failure)", async () => {
    process.env.APP_URL = "https://acreos.io";
    connectionSources["stripe.secret_key"] = "db";
    stripePrices = 3;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const l = await buildFounderReadinessLadder();
    expect(rung(l, "billing")?.state).toBe("not_done");
    expect(rung(l, "billing")?.evidence).toMatch(/STRIPE_WEBHOOK_SECRET is not set/);
  });

  it("a localhost APP_URL is not_done — a set-but-wrong value is never a pass", async () => {
    process.env.APP_URL = "http://localhost:5000";
    const l = await buildFounderReadinessLadder();
    expect(rung(l, "public_address")?.state).toBe("not_done");
    expect(rung(l, "public_address")?.evidence).toMatch(/localhost/);
  });

  it("mail with a key but a DISARMED live switch is not_done even with 'sent' shipments", async () => {
    process.env.APP_URL = "https://acreos.io";
    connectionSources["lob.test_key"] = "db";
    liveSendArmed = false;
    sentShipments = [{ id: 1 }, { id: 2 }];
    const l = await buildFounderReadinessLadder();
    const mail = rung(l, "mail_rail");
    expect(mail?.state).toBe("not_done");
    // The honest reading: rendered and validated, NOT printed.
    expect(mail?.evidence).toMatch(/NOT printed/);
  });

  it("mail armed but with no shipment ever sent is not_done — an untested rail is a hypothesis", async () => {
    process.env.APP_URL = "https://acreos.io";
    connectionSources["lob.live_key"] = "db";
    liveSendArmed = true;
    sentShipments = [];
    const l = await buildFounderReadinessLadder();
    expect(rung(l, "mail_rail")?.state).toBe("not_done");
    expect(rung(l, "mail_rail")?.evidence).toMatch(/no shipment has reached 'sent'/);
  });

  it("watchdog secrets that are absent by NAME are not_done, not armed", async () => {
    githubCreds = { token: "ghp_x", repository: "tom/acreos" };
    repoSecretNames = ["NTFY_TOPIC"]; // one of four
    const l = await buildFounderReadinessLadder();
    const w = rung(l, "watchdogs");
    expect(w?.state).toBe("not_done");
    expect(w?.evidence).toMatch(/3 of 4 workflow secrets are MISSING/);
  });
});

// ── 2. Undeterminable is "can't verify", NEVER done ──────────────────────────

describe("an undeterminable rung renders can't-verify rather than done", () => {
  it("watchdogs are unverifiable (not done, not not_done) when there is no code host to ask", async () => {
    githubCreds = { token: null, repository: null };
    const l = await buildFounderReadinessLadder();
    const w = rung(l, "watchdogs");
    expect(w?.state).toBe("unverifiable");
    expect(w?.evidence).toMatch(/^Can't verify:/);
    expect(w?.evidence).toMatch(/Nothing is shown as done on a hope/);
  });

  it("watchdogs are unverifiable when the code host REFUSES to list secret names", async () => {
    githubCreds = { token: "ghp_x", repository: "tom/acreos" };
    repoSecretsHttpStatus = 403;
    const l = await buildFounderReadinessLadder();
    const w = rung(l, "watchdogs");
    expect(w?.state).toBe("unverifiable");
    expect(w?.evidence).toMatch(/HTTP 403/);
    expect(w?.evidence).toMatch(/repository-administration scope/);
  });

  it("a Stripe key that Stripe itself rejects is unverifiable, never done", async () => {
    process.env.APP_URL = "https://acreos.io";
    connectionSources["stripe.secret_key"] = "db";
    stripeThrows = true;
    const l = await buildFounderReadinessLadder();
    const b = rung(l, "billing");
    expect(b?.state).toBe("unverifiable");
    expect(b?.evidence).toMatch(/Invalid API key/);
  });

  it("an unreadable mail ledger makes the mail rung unverifiable, not done", async () => {
    process.env.APP_URL = "https://acreos.io";
    connectionSources["lob.live_key"] = "db";
    liveSendArmed = true;
    mailLedgerThrows = true;
    const l = await buildFounderReadinessLadder();
    expect(rung(l, "mail_rail")?.state).toBe("unverifiable");
    expect(rung(l, "mail_rail")?.evidence).toMatch(/whether a piece ever actually shipped/);
  });

  it("an unreadable trust ledger makes BOTH handover rungs unverifiable", async () => {
    ledgerThrows = true;
    const l = await buildFounderReadinessLadder();
    expect(rung(l, "first_trust")?.state).toBe("unverifiable");
    expect(rung(l, "unattended")?.state).toBe("unverifiable");
    expect(l.operating).toEqual([]);
    expect(l.nextHandover).toBeNull();
  });

  it("an unreadable connections layer leaves every connection-backed rung unverifiable and none done", async () => {
    connectionsThrow = true;
    const l = await buildFounderReadinessLadder();
    for (const key of ["brain", "reach_you", "billing", "mail_rail", "github", "watchdogs"]) {
      expect(rung(l, key)?.state, key).toBe("unverifiable");
    }
    expect(l.doneCount).toBe(0);
    expect(l.unverifiableCount).toBeGreaterThanOrEqual(6);
  });

  it("unreadable spend fails CLOSED and says so, rather than reporting bounded", async () => {
    stopLoss = { ...stopLoss, mtdSpendCents: null, reason: "the spend ledger is unreadable" };
    const l = await buildFounderReadinessLadder();
    const s = rung(l, "spend_line");
    expect(s?.state).toBe("not_done");
    expect(s?.evidence).toMatch(/UNREADABLE/);
    expect(s?.evidence).toMatch(/failed CLOSED/);
  });

  it("the unverifiable count is reported, and the letter line refuses to imply progress", async () => {
    connectionsThrow = true;
    const l = await buildFounderReadinessLadder();
    expect(l.unverifiableCount).toBeGreaterThan(0);
    expect(l.letterLine).not.toMatch(/finished/i);
  });
});

// ── 3. Completed rungs drop out — the surface consumes itself ────────────────

describe("a completed rung drops out of the ladder", () => {
  it("a fully-ready world leaves NO rungs and marks the ladder complete", async () => {
    armFullyReadyWorld();
    const l = await buildFounderReadinessLadder();
    expect(l.rungs).toEqual([]);
    expect(l.complete).toBe(true);
    expect(l.doneCount).toBe(l.totalCount);
    expect(l.unverifiableCount).toBe(0);
    expect(l.criticalOpenCount).toBe(0);
    expect(l.nextStep).toBeNull();
    expect(l.letterLine).toMatch(/Setup is finished/);
  });

  it("a done rung survives as history with its measured evidence, so nothing is lost", async () => {
    armFullyReadyWorld();
    const l = await buildFounderReadinessLadder();
    expect(l.completed).toHaveLength(RUNG_SPECS.length);
    for (const c of l.completed) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.evidence).not.toMatch(/^Can't verify:/);
    }
  });

  it("the surface converts from set-this-up into what-I-now-run as trust grows", async () => {
    armFullyReadyWorld();
    const l = await buildFounderReadinessLadder();
    // Derived from the REAL ledger levels, not asserted.
    expect(l.operating).toEqual([
      "Growth is acting end-to-end through its safety gates.",
      "Support is operating independently through its safety gates.",
    ]);
    expect(l.nextHandover).toEqual({
      domain: "growth",
      from: "acting end-to-end through its safety gates",
      to: "operating independently through its safety gates",
      evidence: expect.stringContaining("7 clean cycles"),
    });
  });

  it("nothing is left to hand over once every domain is fully independent", async () => {
    armFullyReadyWorld();
    ledgerLevels = ledgerLevels.map((e) => ({ ...e, level: "autonomous_gated" }));
    const l = await buildFounderReadinessLadder();
    expect(l.nextHandover).toBeNull();
    expect(l.operating).toHaveLength(2);
  });

  it("the ladder shrinks monotonically as rungs are satisfied", async () => {
    const before = (await buildFounderReadinessLadder()).rungs.length;
    connectionSources["openrouter.api_key"] = "db";
    connectionSources["paging.topic"] = "db";
    connectionSources["paging.founder_email"] = "db";
    const after = (await buildFounderReadinessLadder()).rungs.length;
    expect(after).toBeLessThan(before);
  });
});

// ── 4. Ordering respects real dependencies ───────────────────────────────────

describe("rung ordering respects dependencies", () => {
  it("orderRungs never places a rung before something it depends on", () => {
    const ordered = orderRungs([...RUNG_SPECS]);
    const seen = new Set<string>();
    for (const r of ordered) {
      for (const dep of r.dependsOn) {
        expect(seen.has(dep), `${r.key} appears before its dependency ${dep}`).toBe(true);
      }
      seen.add(r.key);
    }
    expect(ordered).toHaveLength(RUNG_SPECS.length);
  });

  it("orderRungs is stage-major: foundation before rails before safety before handover", () => {
    const stages = orderRungs([...RUNG_SPECS]).map((r) => r.stage);
    const rank = { foundation: 0, rails: 1, safety: 2, handover: 3 } as const;
    for (let i = 1; i < stages.length; i++) {
      expect(rank[stages[i]]).toBeGreaterThanOrEqual(rank[stages[i - 1]]);
    }
  });

  it("every dependsOn key refers to a real rung (no dangling prerequisites)", () => {
    const keys = new Set(RUNG_SPECS.map((r) => r.key));
    for (const r of RUNG_SPECS) {
      for (const dep of r.dependsOn) expect(keys.has(dep), `${r.key} → ${dep}`).toBe(true);
    }
  });

  it("a rung whose prerequisite is undone is BLOCKED and names what it waits on", async () => {
    // github undone → the watchdog rung can never be the thing you're told to
    // do next, because you cannot arm a watchdog before its secret store exists.
    githubCreds = { token: null, repository: null };
    repoSecretNames = [];
    const l = await buildFounderReadinessLadder();
    // billing depends on public_address, which is undone in the empty world.
    const billing = rung(l, "billing");
    expect(billing?.state).toBe("blocked");
    expect(billing?.waitingOn).toEqual(["public_address"]);
  });

  it("the handover rungs are blocked until the brain and paging rungs are done", async () => {
    const l = await buildFounderReadinessLadder();
    expect(rung(l, "first_trust")?.state).toBe("blocked");
    expect(rung(l, "first_trust")?.waitingOn).toEqual(["brain", "reach_you"]);
    expect(rung(l, "delegation")?.waitingOn).toEqual(["first_trust"]);
    expect(rung(l, "unattended")?.waitingOn).toEqual(["delegation"]);
  });

  it("the single next step is never a blocked rung, and prefers an essential one", async () => {
    const l = await buildFounderReadinessLadder();
    expect(l.nextStep).not.toBeNull();
    const picked = l.rungs.find((r) => r.key === l.nextStep!.key);
    expect(picked?.state).not.toBe("blocked");
    expect(picked?.critical).toBe(true);
    expect(l.letterLine).toContain(l.nextStep!.title.toLowerCase());
    expect(l.nextStep!.href).toBe("/founder/autopilot/control");
  });

  it("the blocked prerequisite clears once the earlier rung is measured done", async () => {
    process.env.APP_URL = "https://acreos.io";
    connectionSources["stripe.secret_key"] = "db";
    stripePrices = 1;
    const l = await buildFounderReadinessLadder();
    expect(rung(l, "public_address")).toBeUndefined();
    expect(rung(l, "billing")?.state).toBe("not_done"); // no longer blocked
    expect(rung(l, "billing")?.waitingOn).toEqual([]);
  });
});

// ── 5. Teaching payload + honest gaps ────────────────────────────────────────

describe("each rung teaches, and honest gaps are stated not hidden", () => {
  it("every rung carries what-it-unlocks, what-it-costs and what-breaks", () => {
    for (const r of RUNG_SPECS) {
      expect(r.unlocks.length, r.key).toBeGreaterThan(40);
      expect(r.ifItLapses.length, r.key).toBeGreaterThan(20);
      expect(r.costs === null || r.costs.length > 10, r.key).toBe(true);
      expect(r.href).toMatch(/^\/founder/);
    }
  });

  it("the paid-data rung states outright that no trial expiry is knowable", async () => {
    process.env.ATTOM_API_KEY = "a";
    process.env.REGRID_API_KEY = "r";
    const l = await buildFounderReadinessLadder();
    const done = l.completed.find((c) => c.key === "data_plane");
    expect(done?.evidence).toMatch(/no trial or expiry date is recorded/i);
  });

  it("the watchdog rung reports secret NAMES only — no value ever appears", async () => {
    githubCreds = { token: "ghp_supersecret", repository: "tom/acreos" };
    repoSecretNames = [...WATCHDOG_SECRET_NAMES];
    const l = await buildFounderReadinessLadder();
    const payload = JSON.stringify(l);
    expect(payload).not.toContain("ghp_supersecret");
    expect(l.completed.find((c) => c.key === "watchdogs")?.evidence).toMatch(/values never read/);
  });

  it("no rung's evidence leaks a resolved secret value", async () => {
    armFullyReadyWorld();
    const l = await buildFounderReadinessLadder();
    const payload = JSON.stringify(l);
    expect(payload).not.toContain("whsec_x");
    expect(payload).not.toContain("AKIA");
  });
});
