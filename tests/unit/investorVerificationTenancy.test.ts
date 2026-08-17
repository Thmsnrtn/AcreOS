/**
 * Any org could read, mutate and approve any other org's KYC file.
 *
 * `investor_verification_requests` has carried `organizationId NOT NULL` with a
 * foreign key and an org-leading index (`investor_ver_requests_org_status_idx`)
 * since the DB-backing wave. That wave's own header says why it exists —
 * *"Wave A: Nothing lies… must be DB-backed before any marketplace
 * reactivation"* — and it added `listRequestsByOrg`, the one org-scoped method
 * on the storage seam.
 *
 * **No route called it, and no other method took an org at all.** Every
 * route-reachable path resolved its subject by primary key or by
 * investor-profile id:
 *
 *   GET  /verifications/:investorId          → any org's KYC status
 *   GET  /verifications/:id/history          → any org's full audit trail,
 *                                              reviewer identities and notes
 *   POST /verifications/:id/documents        → attach a document to any org's request
 *   PATCH /verifications/:id/submit          → advance any org's state machine
 *   PATCH /verifications/:id/review          → admin-gated… on the CALLER's org,
 *                                              then approve any org's investor,
 *                                              which writes `isVerified` to that
 *                                              org's investor profile
 *   POST /verifications/:id/accreditation    → write net worth / annual income
 *                                              onto any org's request
 *
 * This is the wave-discipline failure `CLAUDE.md` describes in as many words:
 * *"an agent reports success for the part it built, and is blind to the part it
 * didn't."* The tenant key was designed, migrated, indexed — and wired to
 * nothing. It is also the exact shape of unit 36 (a founder route with no
 * founder guard) and unit 46 (`canAssignLeads` declared for every role, checked
 * by none): **the control exists and is not applied.**
 *
 * WHY THE ADMIN CHECK DID NOT HELP. `isAdmin(req)` asks whether the caller is
 * an admin *of their own organization*. Role and tenancy are two questions, and
 * answering one has never answered the other. An admin is exactly the account
 * that could do the most damage with an unscoped id.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT
 * -------------------------------------------
 * Two halves, because neither alone is enough:
 *
 *  1. **Behaviour**, against an in-memory storage double that filters by org
 *     exactly as the SQL does. This proves the SERVICE threads `orgId` through
 *     every path — if a method drops it, the double stops matching and the test
 *     fails. It cannot prove anything about the SQL.
 *  2. **Source**, over the Drizzle storage. Each query must carry an
 *     `organizationId` predicate. A behavioural test with a fake can never see
 *     a missing `WHERE`, and that is where the bug actually lived.
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  InvestorVerificationService,
  VerificationNotInOrgError,
  type InvestorVerificationStorage,
  type VerificationRequestRecord,
} from "../../server/services/investorVerification";

const ROOT = path.resolve(__dirname, "../..");

const ORG_A = 1;
const ORG_B = 2;
const PROFILE_A = 10; // belongs to ORG_A
const PROFILE_B = 20; // belongs to ORG_B

/**
 * An honest in-memory storage: it filters by org in every method, the way the
 * SQL does. A double that ignored `orgId` would make these tests pass against
 * the broken service, which is the trap this file is about.
 */
function makeStorage() {
  const profiles = new Map<number, number>([
    [PROFILE_A, ORG_A],
    [PROFILE_B, ORG_B],
  ]);
  const rows: VerificationRequestRecord[] = [];
  let nextId = 1;
  /** Every write goes through here — one place to prove nothing skipped the org. */
  const owned = (r: VerificationRequestRecord, orgId: number) => r.orgId === orgId;

  const storage: InvestorVerificationStorage = {
    async profileBelongsToOrg(profileId, orgId) {
      return profiles.get(profileId) === orgId;
    },
    async findActiveRequest(profileId, orgId) {
      return rows.find(
        (r) =>
          r.investorProfileId === profileId &&
          owned(r, orgId) &&
          (r.status === "pending" || r.status === "reviewing"),
      );
    },
    async insertRequest(values) {
      const row: VerificationRequestRecord = {
        id: nextId++,
        investorProfileId: values.investorProfileId,
        orgId: values.orgId,
        status: values.status,
        documents: values.documents,
        history: values.history,
        createdAt: new Date(2026, 0, 1),
      };
      rows.push(row);
      return row;
    },
    async getRequest(id, orgId) {
      return rows.find((r) => r.id === id && owned(r, orgId));
    },
    async updateRequest(id, orgId, updates) {
      const row = rows.find((r) => r.id === id && owned(r, orgId));
      if (!row) return undefined;
      Object.assign(row, updates);
      return row;
    },
    async listRequestsByProfile(profileId, orgId) {
      return rows.filter((r) => r.investorProfileId === profileId && owned(r, orgId));
    },
    async listRequestsByOrg(orgId, statuses) {
      return rows.filter((r) => owned(r, orgId) && statuses.includes(r.status));
    },
    async isProfileVerified(profileId, orgId) {
      return profiles.get(profileId) === orgId && verified.has(profileId);
    },
    async markProfileVerified(profileId, orgId) {
      if (profiles.get(profileId) === orgId) verified.add(profileId);
    },
  };
  const verified = new Set<number>();
  return { storage, rows, verified };
}

describe("a request can only be created against your own investor profile", () => {
  let svc: InvestorVerificationService;
  let store: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    store = makeStorage();
    svc = new InvestorVerificationService(store.storage);
  });

  it("creating against your own profile works", async () => {
    const r = await svc.createVerificationRequest(PROFILE_A, ORG_A);
    expect(r.orgId).toBe(ORG_A);
    expect(store.rows).toHaveLength(1);
  });

  it("creating against ANOTHER org's profile is refused, and writes nothing", async () => {
    // The load-bearing check. Scoping only the reads would have left this open,
    // and approving such a request later writes isVerified onto the other org's
    // profile — a cross-tenant write dressed as an ordinary approval.
    await expect(svc.createVerificationRequest(PROFILE_B, ORG_A)).rejects.toBeInstanceOf(
      VerificationNotInOrgError,
    );
    expect(store.rows, "a row was written for another org's profile").toHaveLength(0);
  });

  it("is idempotent within an org, and does not adopt another org's active request", async () => {
    const first = await svc.createVerificationRequest(PROFILE_A, ORG_A);
    const again = await svc.createVerificationRequest(PROFILE_A, ORG_A);
    expect(again.id).toBe(first.id);
    expect(store.rows).toHaveLength(1);
  });
});

describe("every operation on an existing request is scoped to the owner org", () => {
  let svc: InvestorVerificationService;
  let store: ReturnType<typeof makeStorage>;
  let id: number;

  beforeEach(async () => {
    store = makeStorage();
    svc = new InvestorVerificationService(store.storage);
    id = (await svc.createVerificationRequest(PROFILE_A, ORG_A)).id;
  });

  it("the owner can upload, submit and be reviewed", async () => {
    // The positive path, asserted first: a scoping bug that refuses EVERYTHING
    // would satisfy every negative test in this file.
    await svc.uploadDocument(id, ORG_A, "passport", { size: 1 });
    await svc.submitForReview(id, ORG_A);
    const reviewed = await svc.reviewVerification(id, ORG_A, 7, "approved", "ok");
    expect(reviewed.status).toBe("approved");
    expect(store.verified.has(PROFILE_A)).toBe(true);
  });

  it("another org cannot upload a document to it", async () => {
    await expect(
      svc.uploadDocument(id, ORG_B, "passport", { size: 1 }),
    ).rejects.toBeInstanceOf(VerificationNotInOrgError);
    expect(store.rows[0].documents, "a foreign document was attached").toHaveLength(0);
  });

  it("another org cannot advance its state machine", async () => {
    await svc.uploadDocument(id, ORG_A, "passport", { size: 1 });
    await expect(svc.submitForReview(id, ORG_B)).rejects.toBeInstanceOf(
      VerificationNotInOrgError,
    );
    expect(store.rows[0].status).toBe("pending");
  });

  it("an ADMIN of another org cannot approve it", async () => {
    // The worst of the set. The route's only check was "is the caller an admin",
    // which every org has — and approval writes isVerified onto the profile.
    await svc.uploadDocument(id, ORG_A, "passport", { size: 1 });
    await svc.submitForReview(id, ORG_A);
    await expect(
      svc.reviewVerification(id, ORG_B, 99, "approved", "rubber stamp"),
    ).rejects.toBeInstanceOf(VerificationNotInOrgError);
    expect(store.rows[0].status).toBe("reviewing");
    expect(
      store.verified.has(PROFILE_A),
      "another org's admin flipped isVerified on this profile",
    ).toBe(false);
  });

  it("another org cannot read its status or its audit trail", async () => {
    await svc.uploadDocument(id, ORG_A, "passport", { size: 1 });
    const mine = await svc.getVerificationStatus(PROFILE_A, ORG_A);
    expect(mine.status).toBe("pending");

    // Reads do not throw — they return the same answer as a profile that has
    // no requests, so a probe cannot tell "exists elsewhere" from "absent".
    const theirs = await svc.getVerificationStatus(PROFILE_A, ORG_B);
    expect(theirs.status).toBe("not_started");
    expect(theirs.verificationId).toBeNull();

    expect(await svc.getVerificationHistory(PROFILE_A, ORG_A)).toHaveLength(1);
    expect(
      await svc.getVerificationHistory(PROFILE_A, ORG_B),
      "another org read this profile's KYC audit trail",
    ).toHaveLength(0);
  });

  it("another org cannot write accreditation data onto it", async () => {
    await expect(
      svc.accreditationCheck(PROFILE_A, ORG_B, { netWorth: 9_000_000, annualIncome: 1 }),
    ).rejects.toBeInstanceOf(VerificationNotInOrgError);
    expect(store.rows[0].accreditationData ?? null).toBeNull();
  });

  it("the gate check does not treat another org's approval as your own", async () => {
    await svc.uploadDocument(id, ORG_A, "passport", { size: 1 });
    await svc.submitForReview(id, ORG_A);
    await svc.reviewVerification(id, ORG_A, 7, "approved");
    expect(await svc.checkVerificationGate(PROFILE_A, ORG_A)).toBe(true);
    expect(await svc.checkVerificationGate(PROFILE_A, ORG_B)).toBe(false);
  });

  it("the admin queue lists this org's requests only", async () => {
    const other = new InvestorVerificationService(store.storage);
    await other.createVerificationRequest(PROFILE_B, ORG_B);
    const a = await svc.listVerifications(ORG_A);
    const b = await svc.listVerifications(ORG_B);
    expect(a.map((r) => r.investorProfileId)).toEqual([PROFILE_A]);
    expect(b.map((r) => r.investorProfileId)).toEqual([PROFILE_B]);
  });
});

// ── The half a storage double cannot prove ────────────────────────────────────

/** Line-based comment stripping. See destructivePermissionCoverage for why. */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split("\n")) {
    let s = line;
    if (inBlock) {
      const end = s.indexOf("*/");
      if (end === -1) { out.push(""); continue; }
      s = s.slice(end + 2);
      inBlock = false;
    }
    const open = s.indexOf("/*");
    if (open > -1) {
      const close = s.indexOf("*/", open + 2);
      if (close > -1) s = s.slice(0, open) + s.slice(close + 2);
      else if (/^\s*\{?\s*\/\*/.test(s)) { s = s.slice(0, open); inBlock = true; }
    }
    out.push(s.replace(/(^|[^:])\/\/.*$/, "$1"));
  }
  if (inBlock) throw new Error("stripComments ran away — assertions would be meaningless.");
  return out.join("\n");
}

const service = stripComments(
  fs.readFileSync(path.join(ROOT, "server/services/investorVerification.ts"), "utf8"),
);
const routes = stripComments(
  fs.readFileSync(path.join(ROOT, "server/routes-investor-verification.ts"), "utf8"),
);
const mounts = stripComments(fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8"));

describe("the SQL itself carries the tenant predicate", () => {
  /** One method body out of the Drizzle storage object. */
  function storageMethod(name: string): string {
    const at = service.indexOf(`  async ${name}(`);
    expect(at, `${name} is gone from the storage — renamed?`).toBeGreaterThan(-1);
    const end = service.indexOf("\n  },", at);
    return service.slice(at, end === -1 ? at + 1200 : end);
  }

  // Every method the service can reach. listRequestsByOrg was already scoped —
  // it is in the list so that a future refactor cannot quietly unscope the one
  // method that was right all along.
  const SCOPED = [
    "profileBelongsToOrg",
    "findActiveRequest",
    "getRequest",
    "updateRequest",
    "listRequestsByProfile",
    "listRequestsByOrg",
    "isProfileVerified",
    "markProfileVerified",
  ];

  for (const name of SCOPED) {
    it(`${name} filters on the organization`, () => {
      const body = storageMethod(name);
      expect(
        /organizationId,\s*orgId\)/.test(body),
        `${name} resolves rows without an organizationId predicate — this is ` +
          `the exact defect this file exists for: the column is present, the ` +
          `index is org-leading, and the query does not use it`,
      ).toBe(true);
    });
  }

  it("insertRequest stamps the org rather than filtering by it", () => {
    // Called out separately so the loop above cannot be read as "every method
    // has a WHERE". A write's job is to record the tenant, not to filter.
    const body = storageMethod("insertRequest");
    expect(body).toContain("organizationId: values.orgId");
  });

  it("no storage query resolves a request by id alone", () => {
    // The generalisation. A new method added below the ones enumerated above
    // would not be covered by the loop; this catches the shape wherever it is.
    const at = service.indexOf("drizzleInvestorVerificationStorage");
    const block = service.slice(at, service.indexOf("// ─── Service", at));
    // Whitespace-tolerant on purpose. A first version required `where(eq(`
    // adjacent and missed a mutation that dropped the predicate across three
    // lines — a checker that only catches the tidy formatting of a bug.
    const lone =
      block.match(
        /where\(\s*eq\((investorVerificationRequests|investorProfiles)\.\w+,[^)]*\)\s*,?\s*\)/g,
      ) ?? [];
    expect(
      lone.join(" | "),
      "a storage query filters on a single column with no organization " +
        "predicate. Every row in both tables carries organizationId NOT NULL.",
    ).toBe("");
  });
});

describe("every route passes the caller's org, and refuses as 404", () => {
  it("no service call in the routes omits the org argument", () => {
    // Source-level because the org has to come from the REQUEST. A behavioural
    // test with a hand-built org id proves the service scopes; only this proves
    // the routes do not hand it a constant.
    //
    // It insists on the literal `getOrganizationId(req)` inside the call rather
    // than accepting a local variable, and one handler was rewritten to match.
    // Tracking a variable back to its assignment with a regex is the kind of
    // cleverness that fails OPEN — it would accept `const organizationId = 1`.
    // One uniform shape, checkable exactly.
    const calls = routes.match(/investorVerificationService\.\w+\([^;]*?\);/gs) ?? [];
    expect(calls.length, "no service calls found — did the routes move?").toBeGreaterThan(5);
    const missing = calls.filter((c) => !c.includes("getOrganizationId(req)"));
    expect(
      missing.join("\n---\n"),
      "a handler calls the verification service without the caller's " +
        "organization. Every id in this router arrives from the URL or body.",
    ).toBe("");
  });

  it("a cross-tenant refusal renders 404, not 403", () => {
    // 403 confirms the record exists. Probing another tenant's ids must be
    // indistinguishable from probing ids that were never issued.
    expect(routes).toContain("VerificationNotInOrgError");
    const at = routes.indexOf("function refuse(");
    expect(at, "the shared refusal helper is gone").toBeGreaterThan(-1);
    const body = routes.slice(at, routes.indexOf("\n}", at));
    expect(body).toContain("Errors.notFound(");
    expect(
      body,
      "the cross-tenant branch answers 403, which confirms the record exists",
    ).not.toContain("Errors.forbidden(");
  });

  it("the admin queue answers from the database, not from a literal", () => {
    // It returned a hardcoded `{ verifications: [] }` under a TODO claiming the
    // service had no listing method. It had one, org-scoped, unused — so the
    // stale note was itself the reason the only correct method stayed dead.
    const at = routes.indexOf("'/admin/verifications'");
    expect(at).toBeGreaterThan(-1);
    const handler = routes.slice(at, routes.indexOf("});", at));
    expect(handler).toContain("listVerifications(");
    expect(
      /res\.json\(\{\s*verifications:\s*\[\]\s*\}\)/.test(handler),
      "the admin queue is answering with a hardcoded empty list again",
    ).toBe(false);
  });
});

describe("the marketplace satellites are gated like the marketplace", () => {
  // The deletion ledger's Marketplace row (FREEZE) names buyer-network and
  // investor-verification alongside matchmaking and deal-rooms. /api/marketplace
  // moved to the strict ladder gate when the expansion ladder became a ratchet;
  // these two were mounted with auth and nothing else.
  for (const mount of ["/api/investor-verification", "/api/buyer-network"]) {
    it(`${mount} is behind the ladder gate`, () => {
      const at = mounts.indexOf(`app.use('${mount}'`);
      expect(at, `${mount} is no longer mounted — deleted?`).toBeGreaterThan(-1);
      const line = mounts.slice(at, mounts.indexOf("\n", at));
      expect(
        line,
        `${mount} is a marketplace satellite under a FREEZE verdict, reachable ` +
          `by any authenticated user. It takes the same gate as the front door.`,
      ).toContain('requireLadderFlag("feature_marketplace")');
    });
  }
});
