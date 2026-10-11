/**
 * The owner-suppression guard itself (server/services/trust/ownerSuppression.ts):
 * matching survives the ways the same person is typed, a match REFUSES, a
 * lookup error REFUSES (fail closed), and an import keeps the row but stamps
 * it do-not-contact. Only keyed hashes are ever compared.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/** The suppression table, as (kind, hash) rows. `fail` makes the next query throw. */
const table: Array<{ kind: string; identifierHash: string }> = [];
let fail = false;

/**
 * The mock answers the query the guard ACTUALLY builds: the predicate is
 * rendered through drizzle's own dialect and only rows whose hash appears in
 * its parameters come back — so a guard that hashed the wrong thing, or
 * queried nothing, finds nothing (a mock that returned every row would agree
 * with any implementation).
 */
function chain(): any {
  let params: unknown[] = [];
  const q: any = {
    select: () => q,
    from: () => q,
    where: (pred: unknown) => {
      params = new PgDialect().sqlToQuery(pred as never).params;
      return q;
    },
    then: (ok: any, no: any) =>
      (fail
        ? Promise.reject(new Error("db down"))
        : Promise.resolve(table.filter((r) => params.includes(r.identifierHash)).map((r) => ({ kind: r.kind, hash: r.identifierHash })))
      ).then(ok, no),
  };
  return q;
}
vi.mock("../../server/db", () => ({ db: { select: () => chain() } }));

import { assertOwnerContactAllowed, ownerContactRefusal, ownerIdentifierHashes, stampOwnerSuppression } from "../../server/services/trust/ownerSuppression";
import { ProviderNotContactedError } from "../../server/services/actions/outwardAction";
import { normalizeMailingAddress, normalizePhone, normalizeEmail } from "../../shared/trust/ownerIdentifiers";

/** Suppress one identifier exactly as the request flow does: through ownerIdentifierHashes. */
function suppress(kind: "email" | "phone" | "address", value: string) {
  const ids = kind === "email" ? { email: value } : kind === "phone" ? { phone: value } : { addressLine1: value.split("|")[0], zip: value.split("|")[1] };
  const [h] = ownerIdentifierHashes(ids);
  table.push({ kind, identifierHash: h.hash });
}

beforeEach(() => {
  table.length = 0;
  fail = false;
});

describe("identifier normalisation", () => {
  it("one person typed several ways is one identifier", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(normalizePhone("+1 (423) 555-0100")).toBe("4235550100");
    expect(normalizePhone("423.555.0100")).toBe("4235550100");
    expect(normalizeMailingAddress("123 North Main Street", "37402-1234")).toBe(normalizeMailingAddress("123 N. Main St", "37402"));
  });
  it("refuses identifiers too weak to match on", () => {
    expect(normalizePhone("555-0100")).toBeNull();
    expect(normalizeMailingAddress("123 Main St", null)).toBeNull();
    expect(normalizeMailingAddress("Main Street", "37402")).toBeNull();
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
  it("stores a keyed hash, never the identifier", () => {
    const hashes = ownerIdentifierHashes({ email: "jane@example.com", phone: "4235550100" });
    expect(hashes).toHaveLength(2);
    for (const h of hashes) {
      expect(h.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(h.hash).not.toContain("jane");
      expect(h.hash).not.toContain("4235550100");
    }
  });
});

describe("the guard", () => {
  it("refuses a suppressed owner on every identifier kind", async () => {
    suppress("phone", "4235550100");
    expect(await ownerContactRefusal("sms", { phone: "(423) 555-0100" })).toMatch(/stop all contact/);
    await expect(assertOwnerContactAllowed("voice", { phone: "+14235550100" })).rejects.toMatchObject({ name: "OwnerSuppressedError" });
  });

  it("allows an owner who is not on the list — even while others are", async () => {
    suppress("phone", "4235550100");
    expect(await ownerContactRefusal("email", { email: "someone@example.com" })).toBeNull();
    await expect(assertOwnerContactAllowed("mail", { addressLine1: "1 Elm St", zip: "37402" })).resolves.toBeUndefined();
  });

  it("FAILS CLOSED: a lookup that errors refuses the send", async () => {
    fail = true;
    expect(await ownerContactRefusal("sms", { phone: "4235550100" })).toMatch(/could not be checked/);
    await expect(assertOwnerContactAllowed("mail", { addressLine1: "1 Elm St", zip: "37402" })).rejects.toMatchObject({
      name: "OwnerSuppressionUnverifiableError",
    });
  });

  it("a refusal is a provably-not-sent error (retry-safe, never ambiguous)", async () => {
    suppress("email", "jane@example.com");
    const err = await assertOwnerContactAllowed("email", { email: "jane@example.com" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderNotContactedError);
  });
});

describe("list import: rows are kept, stamped do-not-contact", () => {
  it("stamps only the matching rows", async () => {
    suppress("address", normalizeMailingAddress("123 N Main St", "37402")!);
    const { rows, suppressedCount } = await stampOwnerSuppression([
      { email: "a@example.com", address: "123 North Main Street", zip: "37402" },
      { email: "b@example.com", address: "9 Oak Ave", zip: "37402" },
    ]);
    expect(suppressedCount).toBe(1);
    expect(rows[0].doNotContact).toBe(true);
    expect(rows[0].optOutReason).toMatch(/opt-out/i);
    expect(rows[0].optOutDate).toBeInstanceOf(Date);
    expect(rows[1].doNotContact).toBeUndefined();
  });

  it("an import that cannot be checked is refused, not waved through", async () => {
    fail = true;
    await expect(stampOwnerSuppression([{ email: "a@example.com" }])).rejects.toThrow(/db down/);
  });
});

describe("the hash key: an opt-out survives a key change", () => {
  const KEY = "OWNER_SUPPRESSION_HASH_KEY";
  const PREV = "OWNER_SUPPRESSION_PREVIOUS_HASH_KEYS";
  const saved = { key: process.env[KEY], prev: process.env[PREV] };
  const restore = () => {
    if (saved.key === undefined) delete process.env[KEY];
    else process.env[KEY] = saved.key;
    if (saved.prev === undefined) delete process.env[PREV];
    else process.env[PREV] = saved.prev;
  };

  it("a suppression recorded under the built-in key still refuses once the real key is set", async () => {
    try {
      delete process.env[KEY];
      delete process.env[PREV];
      suppress("phone", "4235550100");
      suppress("email", "jane@example.com");
      process.env[KEY] = "founder-set-real-key-0123456789";
      // The new primary key really does hash differently — otherwise this proves nothing.
      expect(ownerIdentifierHashes({ phone: "4235550100" })[0].hash).not.toBe(table[0].identifierHash);
      await expect(assertOwnerContactAllowed("sms", { phone: "4235550100" })).rejects.toMatchObject({ name: "OwnerSuppressedError" });
      expect(await ownerContactRefusal("email", { email: "jane@example.com" })).toMatch(/stop all contact/);
      const { suppressedCount } = await stampOwnerSuppression([{ phone: "(423) 555-0100" }]);
      expect(suppressedCount).toBe(1);
    } finally {
      restore();
    }
  });

  it("a rotation keeps matching every key listed as previous", async () => {
    try {
      process.env[KEY] = "first-real-key-aaaaaaaaaaaaaaaa";
      suppress("phone", "4235550100");
      process.env[KEY] = "second-real-key-bbbbbbbbbbbbbbb";
      process.env[PREV] = "first-real-key-aaaaaaaaaaaaaaaa";
      await expect(assertOwnerContactAllowed("voice", { phone: "4235550100" })).rejects.toMatchObject({ name: "OwnerSuppressedError" });
    } finally {
      restore();
    }
  });
});

describe("a recipient string is read for every address in it", () => {
  it("a display-name or list form cannot carry a suppressed address past the guard", async () => {
    suppress("email", "jane@example.com");
    for (const to of ["Jane Doe <Jane@Example.com>", "someone@example.com, jane@example.com", "a@example.com;jane@example.com"]) {
      expect(await ownerContactRefusal("email", { email: to }), to).toMatch(/stop all contact/);
    }
    expect(await ownerContactRefusal("email", { email: "Someone <someone@example.com>" })).toBeNull();
  });
});
