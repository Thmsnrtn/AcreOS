/**
 * BYO send rails for PHYSICAL mail — a customer's letters to their sellers
 * print on the CUSTOMER's Lob account (founder decision 2026-07-17, applied to
 * Lob 2026-08-20; single-authority consolidation, 2026-08-16).
 *
 * THE DEFECT THIS GATE EXISTS FOR. `directMailService.getLobClient` was made
 * the one credential authority (BYOK vault → legacy organization_integrations
 * row → platform key) and `mailProvider.ts` was routed through it. But
 * `lobService.ts` — reached from `CommunicationsService.sendDirectMail`, whose
 * recipients are LEADS — resolved its client in its CONSTRUCTOR from
 * LOB_TEST_API_KEY / LOB_LIVE_API_KEY / LOB_API_KEY and never took an orgId at
 * all. So every seller letter on that path printed on ACREOS's Lob account,
 * paid for by AcreOS, no matter what the customer had connected. The earlier
 * consolidation fixed one FILE; the equivalent code elsewhere kept the defect.
 *
 * WHY BEHAVIOURAL. "lobService no longer reads process.env.LOB_*" is the wrong
 * proposition — the env keys legitimately remain for platform/system mail and
 * for `isConfigured()`. The proposition that matters is "a counterparty send
 * for an org that HAS its own key cannot reach the platform key", and only
 * running the send and reading which API key the Lob SDK was constructed with
 * can establish that.
 *
 * VACUITY GUARD FIRST: the opening case proves the platform env key IS
 * reachable and observable through this harness, so the "the platform key is
 * not used" assertions below cannot be satisfied by a send that never happened
 * or a mock that never records.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  /** Platform live-send interlock. Governs the PLATFORM key only. */
  liveSendArmed: true,
  byokKey: null as string | null,
  legacyRow: null as { isEnabled: boolean; credentials: { apiKey?: string } } | null,
  platformKey: { apiKey: "live_platform_key", isTestKey: false } as
    | { apiKey: string; isTestKey: boolean }
    | null,
  created: [] as Array<{ kind: string; apiKey: string }>,
};

vi.mock("lob", () => ({
  default: class MockLob {
    apiKey: string;
    letters = {
      create: async () => {
        state.created.push({ kind: "letter", apiKey: this.apiKey });
        return { id: "ltr_1", expected_delivery_date: "2026-08-27" };
      },
    };
    postcards = {
      create: async () => {
        state.created.push({ kind: "postcard", apiKey: this.apiKey });
        return { id: "psc_1", expected_delivery_date: "2026-08-27" };
      },
    };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/byok/key-vault", () => ({
  getByokCredential: async () => state.byokKey,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationIntegration: async () => state.legacyRow,
    getOrganization: async () => ({ id: 42, name: "Brazos Land Partners", settings: {} }),
  },
}));

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: () => ({}),
  encryptJsonCredentials: () => "enc:v1:mock",
}));

vi.mock("../../server/services/mail/liveSendInterlock", () => ({
  resolvePlatformLobKey: () => {
    if (!state.platformKey) throw new Error("Lob test key not configured.");
    // Model the REAL resolver (services/mail/liveSendInterlock.ts): when the
    // platform interlock is disarmed it returns the TEST key with
    // isTestKey: true and never hands out the live one. The first version of
    // this mock returned state.platformKey unconditionally, which made the
    // fixture claim the platform key escapes the interlock — it does not, and a
    // case asserting otherwise would have been testing the mock.
    if (!state.liveSendArmed) {
      return { apiKey: "test_platform_key", isTestKey: true };
    }
    return state.platformKey;
  },
  // Defaults ARMED so the credential question the cases below ask is reached.
  //
  // This used to be a hardcoded `() => true` with a comment observing that
  // otherwise "every 'live' request degrades to the test sandbox". That note was
  // describing a DEFECT and treating it as a fixture problem: the PLATFORM
  // interlock was silently degrading a send on the CUSTOMER'S OWN key, and
  // arming it in the fixture hid that from every case in this file. It is now
  // controllable, and the disarmed case below is the one that would have caught
  // it.
  isLiveSendArmed: () => state.liveSendArmed,
}));

// Static imports directMailService makes that the credential path never uses.
vi.mock("../../server/services/credits", () => ({
  creditService: { hasEnoughCredits: async () => true, getBalance: async () => 0 },
  usageMeteringService: { calculateCost: async () => 0, recordUsage: async () => undefined },
}));

const TO = { name: "Lee Owner", addressLine1: "2 Dirt Rd", city: "Llano", state: "TX", zip: "78643" };
const FROM = { name: "Brazos Land Partners", addressLine1: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
const LETTER = { to: TO, from: FROM, file: "<p>Dear Lee</p>" };

let lobService: typeof import("../../server/services/lobService").lobService;

beforeEach(async () => {
  state.liveSendArmed = true;
  state.byokKey = null;
  state.legacyRow = null;
  state.platformKey = { apiKey: "live_platform_key", isTestKey: false };
  state.created = [];
  // The env keys are read in the CONSTRUCTOR, so the module is rebuilt for
  // every case AFTER the env is set. Without the reset, one case that deletes
  // the platform keys would leak its singleton into whatever ran next — the
  // kind of order-dependence that makes a gate quietly stop testing anything.
  vi.resetModules();
  process.env.LOB_LIVE_API_KEY = "live_platform_key";
  process.env.LOB_TEST_API_KEY = "test_platform_key";
  ({ lobService } = await import("../../server/services/lobService"));
});

// ─── Vacuity ─────────────────────────────────────────────────────────────────

describe("VACUITY — the platform Lob key is reachable and observable here", () => {
  it("org-less system mail prints on the platform key", async () => {
    const result = await lobService.sendLetter(LETTER, "live");

    expect(result.success).toBe(true);
    // If this stops holding, every "did not use the platform key" assertion
    // below has gone vacuous. Re-derive it; do not delete this case.
    expect(state.created).toEqual([{ kind: "letter", apiKey: "live_platform_key" }]);
  });
});

// ─── The lane rule ───────────────────────────────────────────────────────────

describe("counterparty direct mail resolves the ORG's own Lob account first", () => {
  it("a BYOK-vault org's seller letter prints on the ORG's key, never the platform key", async () => {
    state.byokKey = "live_org_vault_key";

    const result = await lobService.sendLetter(LETTER, "live", {
      organizationId: 42,
      purpose: "counterparty",
    });

    expect(result.success).toBe(true);
    expect(state.created).toEqual([{ kind: "letter", apiKey: "live_org_vault_key" }]);
    expect(state.created.some((c) => c.apiKey === "live_platform_key")).toBe(false);
  });

  it("the legacy organization_integrations row is honoured too — same authority, second tier", async () => {
    state.legacyRow = { isEnabled: true, credentials: { apiKey: "live_org_row_key" } };

    const result = await lobService.sendLetter(LETTER, "live", {
      organizationId: 42,
      purpose: "counterparty",
    });

    expect(result.success).toBe(true);
    expect(state.created).toEqual([{ kind: "letter", apiKey: "live_org_row_key" }]);
  });

  it("postcards resolve credentials the same way — IMPLEMENTATION symmetry, not production coverage", async () => {
    // SCOPE, stated honestly: `lobService.sendPostcard` has NO production
    // caller today (the campaign blast goes through
    // `directMailService.sendPostcard`, pinned separately in
    // lobCredentialAuthority.test.ts). So this case establishes that the two
    // methods on THIS class share one credential path — it does not establish
    // that a live postcard surface is covered, and must not be cited as if it
    // did. Kept because the day a caller appears, the lane rule already holds
    // rather than being rediscovered.
    state.byokKey = "live_org_vault_key";

    const result = await lobService.sendPostcard(
      { to: TO, from: FROM, front: "<p>f</p>", back: "<p>b</p>" },
      "live",
      { organizationId: 42, purpose: "counterparty" },
    );

    expect(result.success).toBe(true);
    expect(state.created).toEqual([{ kind: "postcard", apiKey: "live_org_vault_key" }]);
  });

  it("counterparty mail with NO organizationId REFUSES — it never guesses whose account pays", async () => {
    const result = await lobService.sendLetter(LETTER, "live", { purpose: "counterparty" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/organizationId/i);
    expect(state.created).toHaveLength(0);
  });

  it("a DISARMED platform interlock does not silence a send on the ORG's own key", async () => {
    // The platform live-send interlock is a PLATFORM-scoped switch and
    // `isLiveSendArmed()` is false by default — so on any deployment that has
    // not explicitly armed production, this is the ordinary state, not an edge
    // case.
    //
    // resolveClient used to evaluate `effectiveMode(mode)` and short-circuit to
    // the platform sandbox BEFORE reaching the org branch, so a customer's live
    // counterparty letter, on their OWN Lob account, printed nothing. The org
    // branch's own comment already said the interlock "governs the PLATFORM key
    // only — never a customer's own account"; the ordering above it made that
    // sentence unreachable.
    //
    // Restoring `effectiveMode(mode) === 'test'` in place of `mode === 'test'`
    // fails this case.
    state.liveSendArmed = false;
    state.byokKey = "live_org_vault_key";

    const result = await lobService.sendLetter(LETTER, "live", {
      organizationId: 42,
      purpose: "counterparty",
    });

    expect(result.success).toBe(true);
    expect(state.created).toEqual([{ kind: "letter", apiKey: "live_org_vault_key" }]);
    expect(
      result.isTestMode,
      "the org's own live key was reported as a test send — the platform interlock " +
        "degraded a customer's own account",
    ).toBe(false);
  });

  it("a DISARMED interlock STILL degrades a send on the PLATFORM key", async () => {
    // The other half, and the reason the narrowing is safe: nothing about the
    // platform interlock was weakened. An org with nothing connected falls to
    // the platform key and must still be held by the interlock.
    state.liveSendArmed = false;
    state.byokKey = null;
    state.legacyRow = null;

    const result = await lobService.sendLetter(LETTER, "live", {
      organizationId: 42,
      purpose: "counterparty",
    });

    expect(
      state.created.some((c) => c.apiKey === "live_platform_key"),
      "a disarmed platform interlock still handed out the LIVE platform key",
    ).toBe(false);
    expect(state.created).toEqual([{ kind: "letter", apiKey: "test_platform_key" }]);
    expect(result.isTestMode).toBe(true);
  });

  it("an explicit TEST-mode request never prints on a live BYOK key", async () => {
    // The safety direction of the same rule: org.settings.mailMode = 'test' is
    // the customer's own dry-run switch, and resolving their LIVE vault key
    // there would turn a dry run into real mail in a real mailbox.
    state.byokKey = "live_org_vault_key";

    const result = await lobService.sendLetter(LETTER, "test", {
      organizationId: 42,
      purpose: "counterparty",
    });

    expect(result.success).toBe(true);
    expect(result.isTestMode).toBe(true);
    expect(state.created).toEqual([{ kind: "letter", apiKey: "test_platform_key" }]);
  });

  it("platform fallback still exists for an org with nothing connected (deliberately kept)", async () => {
    // The founder explicitly deferred killing the Lob platform fallback; this
    // pins that the change above did NOT quietly kill it.
    const result = await lobService.sendLetter(LETTER, "live", {
      organizationId: 42,
      purpose: "counterparty",
    });

    expect(result.success).toBe(true);
    expect(state.created).toEqual([{ kind: "letter", apiKey: "live_platform_key" }]);
  });

  it("isConfiguredForOrg sees a BYOK org even with NO platform key at all", async () => {
    // The tenant-blind `isConfigured()` precheck would have refused this org
    // outright, defeating the routing above.
    state.platformKey = null;
    state.byokKey = "live_org_vault_key";
    delete process.env.LOB_LIVE_API_KEY;
    delete process.env.LOB_TEST_API_KEY;
    vi.resetModules();
    const { lobService: fresh } = await import("../../server/services/lobService");

    expect(fresh.isConfigured()).toBe(false);
    await expect(fresh.isConfiguredForOrg(42)).resolves.toBe(true);
  });
});

// ─── Defence in depth: no SECOND Lob resolution order in these files ─────────
//
// The behavioural cases above are the gate. This block is belt-and-braces
// against the specific way this defect has recurred twice: not "the platform
// key is used", but "a file grew its OWN credential lookup that disagrees with
// the authority's order". `lobCredentialAuthority.test.ts` pins the same thing
// for mailProvider.ts; these are the other two files that had one.

import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

describe.each([
  ["server/services/lobService.ts"],
  ["server/services/directMail.ts"],
])("%s carries no independent Lob credential resolution", (rel) => {
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

  it("delegates to directMailService.getLobClient at all (vacuity guard)", () => {
    // Without this, every "does not" below would pass on a file that resolves
    // credentials a brand-new third way, or on an unreadable/empty file.
    expect(src).toMatch(/from\s+['"]\.\/directMailService['"]/);
    expect(src).toContain("getLobClient");
  });

  it("never queries organization_integrations or the BYOK vault itself", () => {
    expect(src).not.toContain("getOrganizationIntegration");
    expect(src).not.toContain("readIntegrationCredentials");
    expect(src).not.toContain("getByokCredential");
    expect(src).not.toContain("byok/key-vault");
  });
});
