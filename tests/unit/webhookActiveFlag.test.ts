/**
 * The webhooks page said "Active" for endpoints that could never fire.
 *
 * `client/src/pages/webhooks.tsx` wrote `enabled`, rendered its Active/Paused
 * badge from `enabled`, and toggled `enabled`. `dispatchWebhook` has always
 * filtered on `isActive`. `saveWebhookEndpoints` persisted whatever the client
 * sent, so an endpoint added through the UI was stored as
 * `{ url, events, enabled: true }` — with no `isActive` at all.
 *
 * So the entire webhooks feature, as reachable by a customer, delivered nothing:
 *
 *   - every endpoint added through the panel was `isActive: undefined` →
 *     filtered out of every dispatch, forever;
 *   - the panel read its own field back and displayed **"Active"**;
 *   - the toggle flipped a field nothing read, so pausing and resuming both
 *     did exactly nothing;
 *   - and no error was raised anywhere, because nothing was wrong — two halves
 *     of the system simply never agreed on the name of the fact.
 *
 * This is the repo's most common defect class ("built but unwired") wearing its
 * least visible costume. There is no missing wire to grep for: the route is
 * mounted, the service is called, the row is written, the UI renders. The only
 * evidence is that two identifiers differ.
 *
 * IT IS ALSO A FABRICATION. A badge reading "Active" for an endpoint that is
 * structurally incapable of receiving anything is a claim about system state
 * that the system does not have. The constitution's rule is refuse-not-fabricate
 * everywhere, and a UI asserting a state it did not read is the same defect as
 * an invented number.
 *
 * NORMALISED ON READ, not only on write. Rows already in the column carry
 * `enabled` and no `isActive`; fixing only the writer would leave every existing
 * customer's webhooks silent until somebody happened to re-save them. Reading
 * `isActive ?? enabled` repairs them in place. Absent BOTH still means off — an
 * endpoint nobody ever expressed as active is not one to start delivering to.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

process.env.FIELD_ENCRYPTION_KEY =
  "4242424242424242424242424242424242424242424242424242424242424242";

const rows: Array<{ credentials: unknown }> = [];
const updates: unknown[] = [];
const inserts: unknown[] = [];

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
    update: () => ({ set: (v: unknown) => ({ where: async () => updates.push(v) }) }),
    insert: () => ({ values: async (v: unknown) => inserts.push(v) }),
  },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
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
  resolveTestSigning,
} = await import("../../server/services/webhookDispatcher");
const { encrypt } = await import("../../server/services/fieldEncryption");

function seed(endpoints: unknown[]) {
  rows.length = 0;
  rows.push({ credentials: { endpoints } });
  updates.length = 0;
  inserts.length = 0;
}

function savedEndpoints(): Array<Record<string, unknown>> {
  const written = (updates[0] ?? inserts[0]) as
    | { credentials?: { endpoints?: Array<Record<string, unknown>> } }
    | undefined;
  return written?.credentials?.endpoints ?? [];
}

const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  seed([]);
});

describe("an endpoint the UI called enabled actually delivers", () => {
  it("dispatches to a legacy row that has `enabled` and no `isActive`", async () => {
    // The exact shape the webhooks panel wrote. Before this it matched nothing
    // and the org received not one delivery, with nothing reporting it.
    seed([{ url: "https://a.example/hook", events: "all", enabled: true }]);
    const result = await dispatchWebhook(1, "lead.created", { lead: { id: 1 } });
    expect(result).toEqual({ dispatched: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honours a legacy PAUSE", async () => {
    // Normalisation must not mean "everything is on now". A user who toggled an
    // endpoint off expressed a real intent through the only field the UI had.
    seed([{ url: "https://a.example/hook", events: "all", enabled: false }]);
    expect(await dispatchWebhook(1, "lead.created", {})).toEqual({ dispatched: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an endpoint expressing NEITHER stays off", async () => {
    // Nobody ever said this one was active. Defaulting it on would start
    // delivering an org's lead and deal events to a URL on no one's authority.
    seed([{ url: "https://a.example/hook", events: "all" }]);
    expect(await dispatchWebhook(1, "lead.created", {})).toEqual({ dispatched: 0, failed: 0 });
  });

  it("isActive wins when a row somehow carries both", async () => {
    seed([{ url: "https://a.example/hook", events: "all", isActive: false, enabled: true }]);
    expect(await dispatchWebhook(1, "lead.created", {})).toEqual({ dispatched: 0, failed: 0 });
  });
});

describe("the panel is told the same fact the dispatcher acts on", () => {
  it("reports isActive for a legacy `enabled` row", async () => {
    // The badge and the dispatch filter must read one field. When they read
    // two, the badge said Active and the dispatcher sent nothing.
    seed([{ url: "https://a.example/hook", events: "all", enabled: true }]);
    const [shown] = await getWebhookEndpointsForDisplay(1);
    expect(shown.isActive).toBe(true);
    expect("enabled" in shown, "the legacy field is still being handed to the UI").toBe(false);
  });

  it("reports isActive false for a legacy paused row", async () => {
    seed([{ url: "https://a.example/hook", events: "all", enabled: false }]);
    expect((await getWebhookEndpointsForDisplay(1))[0].isActive).toBe(false);
  });

  it("the decrypting read agrees with the display read", async () => {
    // Two readers of the same rows. If they normalised differently, the panel
    // and the dispatcher would disagree again by a different route.
    seed([
      { url: "https://a.example/hook", events: "all", enabled: true },
      { url: "https://b.example/hook", events: "all", isActive: false },
    ]);
    const dispatcherView = (await getWebhookEndpoints(1)).map((e) => e.isActive);
    const panelView = (await getWebhookEndpointsForDisplay(1)).map((e) => e.isActive);
    expect(dispatcherView).toEqual(panelView);
  });
});

describe("saving stores one name for one fact", () => {
  it("normalises a legacy `enabled` payload to isActive", async () => {
    // An older client build still in a browser tab sends `enabled`.
    await saveWebhookEndpoints(1, [
      { url: "https://a.example/hook", events: "all", enabled: true },
    ] as never);
    expect(savedEndpoints()[0].isActive).toBe(true);
    expect(savedEndpoints()[0]).not.toHaveProperty("enabled");
  });

  it("never stores both, so they cannot drift apart again", async () => {
    await saveWebhookEndpoints(1, [
      { url: "https://a.example/hook", events: "all", isActive: true, enabled: false },
    ] as never);
    const saved = savedEndpoints()[0];
    expect(saved.isActive).toBe(true);
    expect(saved).not.toHaveProperty("enabled");
  });

  it("keeps the rest of the endpoint", async () => {
    await saveWebhookEndpoints(1, [
      { url: "https://a.example/hook", events: ["deal.created"], enabled: true, description: "CRM sync" },
    ] as never);
    expect(savedEndpoints()[0]).toMatchObject({
      url: "https://a.example/hook",
      events: ["deal.created"],
      description: "CRM sync",
    });
  });
});

describe("the client speaks the same name", () => {
  const page = fs.readFileSync(
    path.resolve(__dirname, "../../client/src/pages/webhooks.tsx"),
    "utf8",
  );

  it("renders and toggles isActive, not enabled", () => {
    // A source assertion because the defect WAS the identifier: no behaviour
    // test on the server can see the client calling the field something else.
    expect(page).toContain("isActive");
    const code = stripComments(page);
    expect(
      /\benabled\b/.test(code),
      "the page still uses `enabled` — the field the dispatcher does not read",
    ).toBe(false);
  });

  it("the comment stripper left the code behind (vacuity guard)", () => {
    // The doc comment on the interface mentions `enabled` on purpose, so the
    // assertion above depends on stripping comments — and would pass on an
    // empty string if stripping went wrong.
    const code = stripComments(page);
    expect(code).toContain("isActive: !e.isActive");
    expect(code.length).toBeGreaterThan(page.length / 2);
  });
});

/**
 * The second half of "the panel does not do what it says": the TEST button.
 *
 * `POST /api/webhooks/test` signed only when the caller passed a secret, and the
 * client passes only a url — it cannot pass the secret, because unit 38 redacted
 * the read. So every test event went out UNSIGNED while every real delivery went
 * out signed, and the one message sent to prove an endpoint works was the one
 * message a signature-verifying receiver would reject. The customer's correctly
 * configured endpoint reported itself broken.
 */
describe("a test event is signed the way a real delivery is", () => {
  it("signs with the CONFIGURED endpoint's own stored secret", async () => {
    seed([
      { url: "https://a.example/hook", secret: encrypt("stored-key"), events: "all", isActive: true },
    ]);
    expect(await resolveTestSigning(1, "https://a.example/hook")).toEqual({
      kind: "signed",
      secret: "stored-key",
    });
  });

  it("ignores a caller-supplied secret for a CONFIGURED endpoint", async () => {
    // The button tests the endpoint as configured. Letting the request decide
    // the key would test something the org does not actually send.
    seed([
      { url: "https://a.example/hook", secret: encrypt("stored-key"), events: "all", isActive: true },
    ]);
    expect(await resolveTestSigning(1, "https://a.example/hook", "caller-key")).toEqual({
      kind: "signed",
      secret: "stored-key",
    });
  });

  it("refuses rather than sending unsigned when the secret cannot be read", async () => {
    // Same rule as the dispatcher. Sending unsigned here would report success
    // for an endpoint that will receive nothing in production.
    seed([
      {
        url: "https://a.example/hook",
        secret: "enc:v1:" + Buffer.from("not json").toString("base64"),
        events: "all",
        isActive: true,
      },
    ]);
    const out = await resolveTestSigning(1, "https://a.example/hook");
    expect(out.kind).toBe("refused");
  });

  it("sends unsigned for a configured endpoint with no secret", async () => {
    seed([{ url: "https://a.example/hook", events: "all", isActive: true }]);
    expect(await resolveTestSigning(1, "https://a.example/hook")).toEqual({ kind: "unsigned" });
  });

  it("accepts a caller-supplied secret only for an UNCONFIGURED url", async () => {
    // An ad-hoc probe at a url the org has not saved. There is no stored key to
    // prefer, so the caller's own value is the only thing on offer.
    seed([{ url: "https://a.example/hook", secret: encrypt("stored-key"), events: "all", isActive: true }]);
    expect(await resolveTestSigning(1, "https://elsewhere.example/hook", "caller-key")).toEqual({
      kind: "signed",
      secret: "caller-key",
    });
  });

  it("the route reports which of the two it did", async () => {
    // Without `signed` in the response the panel would say "test event sent"
    // for both cases, and an unsigned test would read as proof that signing
    // works.
    const route = fs.readFileSync(
      path.resolve(__dirname, "../../server/routes-integrations.ts"),
      "utf8",
    );
    const at = route.indexOf('"/api/webhooks/test"');
    expect(at, "the test route is gone — renamed?").toBeGreaterThan(-1);
    const handler = route.slice(at, at + 2600);
    expect(handler).toContain("resolveTestSigning(");
    expect(handler).toMatch(/signed:\s*!!signingKey/);
  });
});
