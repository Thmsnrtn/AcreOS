/**
 * A webhook signing secret is a CREDENTIAL, not a field.
 *
 * `WebhookEndpoint.secret` is the HMAC key every outbound delivery is signed
 * with. `GET /api/webhooks` returned the stored objects verbatim, so any
 * authenticated member of the organization — a `viewer` included — could read
 * it, while the `PUT` that sets it is `requireAdminOrAbove()`.
 *
 * **A leaked signing secret is worse than leaked data.** It grants the ability
 * to FORGE deliveries: whoever holds it can inject fabricated deal and lead
 * events into the customer's own downstream systems, and the signature will
 * verify. That is capability, not information — which is why this is a different
 * category from the read/write asymmetries found alongside it, even though the
 * defect shape (guarded write, unguarded read) is identical.
 *
 * REDACTION RATHER THAN A GATE, deliberately. Everyone in the org may
 * legitimately need to see which webhooks are configured and whether they are
 * active. Nobody needs to read the secret back — not even an owner, who had it
 * when they set it. A write-only secret keeps the read useful and removes the
 * exposure, where a gate would do the opposite of both.
 *
 * THE ROUND-TRIP IS THE DANGEROUS PART. `client/src/pages/webhooks.tsx` GETs the
 * endpoint list and PUTs it straight back. Redacting the read WITHOUT preserving
 * on write would have written `secret: undefined` over every configured key on
 * the next save — silently disabling signature verification on every downstream
 * integration, with no error raised anywhere. Half this fix is the half that is
 * easy to forget.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const { getWebhookEndpoints, getWebhookEndpointsForDisplay, saveWebhookEndpoints } =
  await import("../../server/services/webhookDispatcher");

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

beforeEach(() => {
  seed([
    { url: "https://a.example/hook", secret: "s3cr3t-a", events: "all", isActive: true },
    { url: "https://b.example/hook", secret: "s3cr3t-b", events: ["deal.created"], isActive: false },
  ]);
});

describe("the API never hands back the signing secret", () => {
  it("removes it entirely — not masked, not empty-stringed", () => {
    // A masked value ("****") is still a field a client might round-trip and
    // save as the literal mask, replacing the real key with eight asterisks.
    // Absent is the only shape that cannot be written back by accident.
    return getWebhookEndpointsForDisplay(1).then((out) => {
      for (const e of out) {
        expect("secret" in e, `${e.url} still carries a secret key`).toBe(false);
      }
      expect(JSON.stringify(out)).not.toContain("s3cr3t");
    });
  });

  it("still reports WHETHER signing is configured", async () => {
    // The UI legitimately needs to say "signing is on" without holding the key.
    const out = await getWebhookEndpointsForDisplay(1);
    expect(out.map((e) => e.hasSecret)).toEqual([true, true]);
  });

  it("reports hasSecret false for an endpoint with no key", async () => {
    seed([{ url: "https://c.example/hook", events: "all", isActive: true }]);
    const out = await getWebhookEndpointsForDisplay(1);
    expect(out[0].hasSecret).toBe(false);
  });

  it("keeps the rest of the endpoint intact", async () => {
    const out = await getWebhookEndpointsForDisplay(1);
    expect(out[0]).toMatchObject({
      url: "https://a.example/hook",
      events: "all",
      isActive: true,
    });
  });

  it("the DISPATCHER still gets the real secret", async () => {
    // Redacting the shared reader would have broken signing outright. The
    // unredacted function is what signs deliveries and must stay unredacted.
    const raw = await getWebhookEndpoints(1);
    expect(raw[0].secret).toBe("s3cr3t-a");
  });
});

describe("a redacted round-trip does not erase the key", () => {
  it("preserves the stored secret when the caller omits it", async () => {
    // Exactly what the client does: GET (redacted) → PUT. Without preservation
    // this silently disables signature verification everywhere, with no error.
    await saveWebhookEndpoints(1, [
      { url: "https://a.example/hook", events: "all", isActive: true },
      { url: "https://b.example/hook", events: ["deal.created"], isActive: true },
    ] as never);
    const saved = savedEndpoints();
    expect(saved.map((e) => e.secret)).toEqual(["s3cr3t-a", "s3cr3t-b"]);
    // ...and the caller's real edit is still applied.
    expect(saved[1].isActive).toBe(true);
  });

  it("lets an explicit new secret REPLACE the stored one", async () => {
    // Preservation must not become "the secret can never be rotated".
    await saveWebhookEndpoints(1, [
      { url: "https://a.example/hook", secret: "rotated", events: "all", isActive: true },
    ] as never);
    expect(savedEndpoints()[0].secret).toBe("rotated");
  });

  it("adds a NEW endpoint with no secret without inventing one", async () => {
    // An endpoint the org has not configured signing for must stay unsigned
    // rather than silently inheriting another endpoint's key.
    await saveWebhookEndpoints(1, [
      { url: "https://new.example/hook", events: "all", isActive: true },
    ] as never);
    expect(savedEndpoints()[0].secret).toBeUndefined();
  });

  it("matches by URL, which is the endpoint's identity here", async () => {
    // Changing the URL makes it a different endpoint, so the old key must NOT
    // follow it to a destination the operator did not sign for.
    await saveWebhookEndpoints(1, [
      { url: "https://elsewhere.example/hook", events: "all", isActive: true },
    ] as never);
    expect(savedEndpoints()[0].secret).toBeUndefined();
  });
});
