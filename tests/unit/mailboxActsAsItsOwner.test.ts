/**
 * Quality directive 2026-09-29 (reachable false claims) — a native-mailbox
 * send says only what the provider said, and a mailbox acts as exactly the
 * account that was connected, for exactly the person who connected it.
 *
 *  - Graph `sendMail` answers 202 Accepted with no body. The client parsed it
 *    as JSON, so an ACCEPTED send threw, the route answered 500, and the UI
 *    invited the user to send again.
 *  - A connection failure after the request left was reported as a failure;
 *    for a send its outcome is UNKNOWN (the message may already be delivered).
 *  - The mailbox row was resolved by org alone and the REQUESTER's token used:
 *    a teammate opening another member's mailbox read and sent from their own
 *    account under the other member's address.
 *  - The token was `list[0]` — the first linked account of that provider —
 *    so a row naming one address could act as another.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const C = vi.hoisted(() => ({
  accounts: [] as Array<{ id: string; provider: string; emailAddress: string }>,
  tokens: [] as Array<{ externalAccountId: string; token: string }>,
}));
vi.mock("@clerk/express", () => ({
  createClerkClient: () => ({
    users: {
      getUser: async () => ({ externalAccounts: C.accounts }),
      getUserOauthAccessToken: async () => ({ data: C.tokens }),
    },
  }),
}));

import { getMailboxAccessToken, getLinkedMailAccount } from "../../server/services/mailbox/clerkMailbox";

beforeEach(() => {
  C.accounts = [
    { id: "ea_a", provider: "oauth_google", emailAddress: "ana@land.co" },
    { id: "ea_b", provider: "oauth_google", emailAddress: "bo@land.co" },
  ];
  C.tokens = [
    { externalAccountId: "ea_a", token: "tok-ana" },
    { externalAccountId: "ea_b", token: "tok-bo" },
  ];
});

describe("the token belongs to the connected address", () => {
  it("chooses the token of the external account whose address the row names", async () => {
    expect(await getMailboxAccessToken("user_1", "gmail", "bo@land.co")).toBe("tok-bo");
    expect(await getMailboxAccessToken("user_1", "gmail", "ANA@land.co")).toBe("tok-ana");
  });

  it("an address no longer linked gets no token — not another account's", async () => {
    expect(await getMailboxAccessToken("user_1", "gmail", "gone@land.co")).toBeNull();
  });

  it("with two accounts linked, connecting must say which", async () => {
    expect(await getLinkedMailAccount("user_1", "gmail")).toEqual({ ambiguous: ["ana@land.co", "bo@land.co"] });
    expect(await getLinkedMailAccount("user_1", "gmail", "bo@land.co")).toEqual({ emailAddress: "bo@land.co" });
  });
});

// ── Route: a mailbox is used only by the member who connected it ──────────────
const R = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  sent: [] as Array<{ account: unknown; input: { body: string } }>,
  updates: 0,
  sendThrows: null as null | Error,
  memberRole: null as null | string,
}));
vi.mock("../../server/db", () => ({
  db: {
    select: (proj?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          // the role lookup projects { role }; everything else reads the mailbox row
          limit: async () =>
            proj && "role" in proj ? (R.memberRole ? [{ role: R.memberRole }] : []) : R.row ? [R.row] : [],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            R.updates++;
            return [{ id: 1, settings: {} }];
          },
        }),
      }),
    }),
  },
}));
vi.mock("../../server/services/mailbox/threadSummary", () => ({ summarizeThread: async () => "" }));
vi.mock("../../server/services/mailbox/mailboxClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/mailbox/mailboxClient")>();
  return {
    ...actual,
    sendMessage: vi.fn(async (account: unknown, input: { body: string }) => {
      if (R.sendThrows) throw R.sendThrows;
      R.sent.push({ account, input });
      return { id: "m1", outcome: "accepted_by_provider" };
    }),
    listMessages: vi.fn(async () => ({ messages: [] })),
  };
});

async function app(userId: string) {
  const { default: router } = await import("../../server/routes-mailbox");
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { user: { id: string }; organization: { id: number } }).user = { id: userId };
    (req as unknown as { organization: { id: number } }).organization = { id: 5 };
    next();
  });
  a.use("/api/mailboxes", router);
  return a;
}

describe("the mailbox routes act as the connecting member only", () => {
  beforeEach(() => {
    R.row = { id: 1, organizationId: 5, userId: "user_owner", provider: "gmail", emailAddress: "ana@land.co", settings: { signature: "Ana <Owner>" }, revokedAt: null };
    R.sent = [];
    R.updates = 0;
    R.sendThrows = null;
    R.memberRole = "member";
  });

  it("a teammate cannot send, read, or rewrite the signature of another member's mailbox", async () => {
    const a = await app("user_teammate");
    const send = await request(a).post("/api/mailboxes/1/send").send({ to: "s@example.com", subject: "x", body: "y" });
    expect(send.status).toBe(403);
    expect(R.sent).toEqual([]);
    expect((await request(a).get("/api/mailboxes/1/messages")).status).toBe(403);
    expect((await request(a).patch("/api/mailboxes/1/settings").send({ signature: "wire funds to …" })).status).toBe(403);
    expect(R.updates).toBe(0);
  });

  it("the owner sends as the row's own address, signature escaped, outcome = accepted", async () => {
    const a = await app("user_owner");
    const r = await request(a).post("/api/mailboxes/1/send").send({ to: "s@example.com", subject: "x", body: "<p>y</p>" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, outcome: "accepted_by_provider", from: "ana@land.co" });
    expect(R.sent[0].account).toEqual({ userId: "user_owner", provider: "gmail", emailAddress: "ana@land.co" });
    expect(R.sent[0].input.body).toBe("<p>y</p><br><br>Ana &lt;Owner&gt;");
  });

  it("an unknown send outcome is not presented as a plain failure", async () => {
    const { MailboxApiError } = await import("../../server/services/mailbox/mailboxClient");
    R.sendThrows = new MailboxApiError("Check your Sent folder", undefined, "unknown");
    const a = await app("user_owner");
    const r = await request(a).post("/api/mailboxes/1/send").send({ to: "s@example.com", subject: "x", body: "y" });
    expect(r.status).toBe(502);
    expect(r.body.error).toBe("send_outcome_unknown");
    expect(r.body.details).toEqual({ outcome: "unknown" });
  });
});

describe("disconnecting a mailbox", () => {
  beforeEach(() => {
    R.row = { id: 1, organizationId: 5, userId: "user_owner", provider: "gmail", emailAddress: "ana@land.co", settings: {}, revokedAt: null };
    R.updates = 0;
  });

  it("a plain member cannot revoke a teammate's mailbox", async () => {
    R.memberRole = "member";
    const r = await request(await app("user_teammate")).delete("/api/mailboxes/1");
    expect(r.status).toBe(403);
    expect(R.updates).toBe(0);
  });

  it("an org admin can, and so can the member who linked it", async () => {
    R.memberRole = "admin";
    expect((await request(await app("user_admin")).delete("/api/mailboxes/1")).status).toBe(200);
    R.memberRole = "member";
    expect((await request(await app("user_owner")).delete("/api/mailboxes/1")).status).toBe(200);
  });
});
