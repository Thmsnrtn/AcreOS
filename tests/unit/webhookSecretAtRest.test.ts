/**
 * The webhook signing secret is a CREDENTIAL, so it is encrypted at rest.
 *
 * `organization_integrations.credentials` holds every provider's secrets, and
 * every one of them is stored as an `{ encrypted: "<envelope>" }` blob — except
 * the webhook signing key, which `saveWebhookEndpoints` wrote into the column in
 * the clear. Unit 38 stopped the API handing it back; this stops the column
 * holding it in plaintext. Same credential, two different exposures, and fixing
 * the first does nothing about the second: a database dump, a support query, a
 * logical replica or a restored backup still yields the key.
 *
 * FIELD-LEVEL, NOT BLOB-LEVEL — and the reason is not consistency.
 * ---------------------------------------------------------------
 * The obvious move was to match the other providers and store
 * `{ encrypted: enc(<the whole endpoint list>) }`. Encrypting only each
 * endpoint's `secret` buys three properties that the blob shape cannot:
 *
 *   - The redacted read never decrypts. `getWebhookEndpointsForDisplay` answers
 *     "is signing configured?" from the ciphertext's presence, so the API path
 *     never holds key material at all — the redaction is no longer the only
 *     thing standing between a member and the key.
 *   - The webhook LIST survives a key problem. url/events/isActive stay
 *     readable, so a missing key degrades signing rather than blanking the
 *     configuration screen.
 *   - `/api/integrations` keeps ignoring this row. That route decrypts anything
 *     with a `credentials.encrypted` field; giving the webhooks row one would
 *     have pulled it into a surface that was never written with it in mind.
 *
 * LAZY MIGRATION. Rows written before this hold plaintext. They are read as
 * plaintext (`isEncrypted` tells the two apart by the `enc:v1:` marker) and
 * encrypted on their next save. No data-migration script, no window where a row
 * is unreadable, and no deploy ordering to get right.
 *
 * AN UNREADABLE SECRET IS A REFUSAL, NOT A DOWNGRADE.
 * --------------------------------------------------
 * Encrypting at rest creates a state that did not exist before: a secret that is
 * configured but cannot be read (key rotated without the old kid, ephemeral dev
 * key after a restart, corrupted row). The tempting handling — drop the secret
 * and deliver — is the dangerous one, because the receiver's check is usually
 * "if a signature header is present, verify it", and an unsigned payload sails
 * through that. Signing with the ciphertext is no better: the signature never
 * verifies and the failure reads as a receiver bug. So the delivery does not
 * happen, and the log says why. That is the whole reason `secretUnavailable`
 * exists as a state distinct from "no secret configured", which delivers
 * unsigned quite correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// A valid 32-byte hex key. tests/setup.ts sets ENCRYPTION_KEY to a non-hex
// string, which makes encrypt() throw on the hex-length check.
process.env.FIELD_ENCRYPTION_KEY =
  "4242424242424242424242424242424242424242424242424242424242424242";

const rows: Array<{ credentials: unknown }> = [];
const updates: unknown[] = [];
const inserts: unknown[] = [];

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => rows }) }),
    }),
    update: () => ({ set: (v: unknown) => ({ where: async () => updates.push(v) }) }),
    insert: () => ({ values: async (v: unknown) => inserts.push(v) }),
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
// The dispatcher validates every URL against SSRF before delivering; that does
// real DNS. Neutralised so these tests are about signing, not networking.
vi.mock("../../server/middleware/fileUploadSecurity", () => ({
  validateUrl: async () => undefined,
  SSRFBlockedError: class SSRFBlockedError extends Error {},
}));
vi.mock("../../server/utils/simulationMode", () => ({
  shouldSimulate: () => false,
  recordSimulatedAction: async () => undefined,
}));
vi.mock("../../server/storage", () => ({
  storage: { getOrganization: async () => null },
}));

const {
  getWebhookEndpoints,
  getWebhookEndpointsForDisplay,
  saveWebhookEndpoints,
  dispatchWebhook,
  signPayload,
} = await import("../../server/services/webhookDispatcher");
const { encrypt, isEncrypted } = await import("../../server/services/fieldEncryption");

function seed(endpoints: unknown[]) {
  rows.length = 0;
  rows.push({ credentials: { endpoints } });
  updates.length = 0;
  inserts.length = 0;
}

/** What was actually persisted by the last save. */
function savedEndpoints(): Array<Record<string, unknown>> {
  const written = (updates[0] ?? inserts[0]) as
    | { credentials?: { endpoints?: Array<Record<string, unknown>> } }
    | undefined;
  return written?.credentials?.endpoints ?? [];
}

/** Feed what was just saved back in as the stored row, as a real save would. */
function persistAndReread() {
  seed(savedEndpoints());
}

const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  seed([
    { url: "https://a.example/hook", secret: "s3cr3t-a", events: "all", isActive: true },
  ]);
});

describe("a signing secret is encrypted on the way into the column", () => {
  it("persists an envelope, not the key", async () => {
    await saveWebhookEndpoints(1, [
      { url: "https://new.example/hook", secret: "brand-new-key", events: "all", isActive: true },
    ] as never);
    const stored = savedEndpoints()[0].secret as string;
    expect(isEncrypted(stored), "the secret was written in the clear").toBe(true);
    expect(JSON.stringify(savedEndpoints())).not.toContain("brand-new-key");
  });

  it("round-trips: the dispatcher reads back exactly what was set", async () => {
    await saveWebhookEndpoints(1, [
      { url: "https://new.example/hook", secret: "brand-new-key", events: "all", isActive: true },
    ] as never);
    persistAndReread();
    const [ep] = await getWebhookEndpoints(1);
    expect(ep.secret).toBe("brand-new-key");
    expect(ep.secretUnavailable).toBeUndefined();
  });

  it("upgrades a legacy PLAINTEXT row on its next save", async () => {
    // The lazy migration. The seeded row holds a plaintext secret, the caller
    // sends the list back without one (the redacted round-trip), and what lands
    // in the column is an envelope carrying the same key.
    await saveWebhookEndpoints(1, [
      { url: "https://a.example/hook", events: "all", isActive: true },
    ] as never);
    expect(isEncrypted(savedEndpoints()[0].secret as string)).toBe(true);
    persistAndReread();
    expect((await getWebhookEndpoints(1))[0].secret).toBe("s3cr3t-a");
  });

  it("reads a legacy plaintext row correctly BEFORE it is re-saved", async () => {
    // The migration is lazy, so plaintext rows must keep signing in the
    // meantime. If this failed, every org's webhooks would break on deploy and
    // recover only when someone happened to edit them.
    expect((await getWebhookEndpoints(1))[0].secret).toBe("s3cr3t-a");
  });

  it("does not re-encrypt an already-encrypted secret it is carrying forward", async () => {
    // Preservation copies the CIPHERTEXT across untouched. That is what lets a
    // save succeed when the key cannot be read — a save must never destroy a
    // key just because this process cannot open it.
    const envelope = encrypt("carried-across");
    seed([{ url: "https://a.example/hook", secret: envelope, events: "all", isActive: true }]);
    await saveWebhookEndpoints(1, [
      { url: "https://a.example/hook", events: "all", isActive: false },
    ] as never);
    expect(savedEndpoints()[0].secret).toBe(envelope);
    expect(savedEndpoints()[0].isActive).toBe(false);
  });

  it("preserves a secret this process CANNOT read", async () => {
    // The sharpest form of the rule, and the reason preservation reads the
    // stored shape rather than the decrypted one. If the key ring cannot open
    // an envelope, a routine save — toggling an endpoint off, editing a URL —
    // must not take that as "there is no secret here" and write the field away.
    // The org would lose a key that a restored encryption key could have
    // recovered, and nothing would report it.
    const undecryptable = "enc:v1:" + Buffer.from("not json at all").toString("base64");
    seed([{ url: "https://a.example/hook", secret: undecryptable, events: "all", isActive: true }]);
    await saveWebhookEndpoints(1, [
      { url: "https://a.example/hook", events: "all", isActive: false },
    ] as never);
    expect(savedEndpoints()[0].secret).toBe(undecryptable);
  });

  it("never persists the fields it derives", async () => {
    // `hasSecret` comes from the redacted read and `secretUnavailable` from the
    // decrypting read; the client PUTs whatever it was given straight back. If
    // they were stored, a client could assert them.
    await saveWebhookEndpoints(1, [
      {
        url: "https://a.example/hook",
        events: "all",
        isActive: true,
        hasSecret: true,
        secretUnavailable: true,
      },
    ] as never);
    expect(savedEndpoints()[0]).not.toHaveProperty("hasSecret");
    expect(savedEndpoints()[0]).not.toHaveProperty("secretUnavailable");
  });
});

describe("the redacted read never decrypts", () => {
  const undecryptable = "enc:v1:" + Buffer.from("not json at all").toString("base64");

  it("still answers hasSecret when the secret cannot be opened", async () => {
    // The point of reading the stored shape: a key problem must not blank the
    // configuration screen. The org can still see which endpoints exist.
    seed([{ url: "https://a.example/hook", secret: undecryptable, events: "all", isActive: true }]);
    const [shown] = await getWebhookEndpointsForDisplay(1);
    expect(shown.hasSecret).toBe(true);
    expect(shown.url).toBe("https://a.example/hook");
  });

  it("hands back no secret and no ciphertext", async () => {
    seed([{ url: "https://a.example/hook", secret: encrypt("s3cr3t-a"), events: "all", isActive: true }]);
    const out = await getWebhookEndpointsForDisplay(1);
    expect("secret" in out[0]).toBe(false);
    expect(JSON.stringify(out)).not.toContain("s3cr3t-a");
    expect(JSON.stringify(out)).not.toContain("enc:v1:");
  });
});

describe("an endpoint whose secret cannot be read is not delivered to", () => {
  const undecryptable = "enc:v1:" + Buffer.from("not json at all").toString("base64");

  it("recognises the corrupt value as an envelope (vacuity guard)", () => {
    // If this were not treated as encrypted it would be passed through as a
    // plaintext key, and every assertion below would pass for the wrong reason.
    expect(isEncrypted(undecryptable)).toBe(true);
  });

  it("surfaces secretUnavailable rather than silently dropping the key", async () => {
    seed([{ url: "https://a.example/hook", secret: undecryptable, events: "all", isActive: true }]);
    const [ep] = await getWebhookEndpoints(1);
    expect(ep.secretUnavailable).toBe(true);
    expect(ep.secret).toBeUndefined();
  });

  it("skips the delivery and counts it failed", async () => {
    seed([{ url: "https://a.example/hook", secret: undecryptable, events: "all", isActive: true }]);
    const result = await dispatchWebhook(1, "lead.created", { lead: { id: 1 } });
    expect(fetchMock, "an unsignable payload was delivered").not.toHaveBeenCalled();
    expect(result).toEqual({ dispatched: 0, failed: 1 });
  });

  it("delivers the healthy endpoints in the same batch", async () => {
    // The refusal is per-endpoint. One unreadable key must not take down the
    // org's other integrations — and asserting a delivery DOES happen here is
    // what stops the test above passing because nothing is ever delivered.
    seed([
      { url: "https://broken.example/hook", secret: undecryptable, events: "all", isActive: true },
      { url: "https://ok.example/hook", secret: encrypt("good-key"), events: "all", isActive: true },
    ]);
    const result = await dispatchWebhook(1, "lead.created", { lead: { id: 1 } });
    expect(result).toEqual({ dispatched: 1, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://ok.example/hook");
  });

  it("signs with the DECRYPTED key, so receivers verify as before", async () => {
    // Encryption at rest must be invisible to the receiver. If the ciphertext
    // reached signPayload the signature would still be present and would never
    // verify — a failure that looks like the receiver's bug.
    seed([{ url: "https://ok.example/hook", secret: encrypt("good-key"), events: "all", isActive: true }]);
    await dispatchWebhook(1, "lead.created", { lead: { id: 1 } });
    const init = fetchMock.mock.calls[0][1] as unknown as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-AcreOS-Signature"]).toBe(
      signPayload(init.body as string, "good-key"),
    );
  });

  it("an endpoint with NO secret still delivers, unsigned", async () => {
    // The distinction the whole state exists for: unconfigured signing is not
    // broken signing, and treating them alike would break every unsigned
    // endpoint the moment encryption arrived.
    seed([{ url: "https://ok.example/hook", events: "all", isActive: true }]);
    const result = await dispatchWebhook(1, "lead.created", { lead: { id: 1 } });
    expect(result).toEqual({ dispatched: 1, failed: 0 });
    const init = fetchMock.mock.calls[0][1] as unknown as RequestInit;
    expect((init.headers as Record<string, string>)["X-AcreOS-Signature"]).toBeUndefined();
  });
});
