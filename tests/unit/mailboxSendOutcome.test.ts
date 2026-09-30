/**
 * Quality directive 2026-09-29 — a native-mailbox send says only what the
 * provider said. Graph `sendMail` answers 202 Accepted with no body; the
 * client parsed it as JSON, so an ACCEPTED send threw, the route answered
 * 500 and the UI invited a second send. A connection failure after a send
 * left is an UNKNOWN outcome, not a failure. (The route half — who may use a
 * mailbox — is in mailboxActsAsItsOwner.test.ts.)
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@clerk/express", () => ({
  createClerkClient: () => ({
    users: {
      getUser: async () => ({
        externalAccounts: [
          { id: "ea_a", provider: "oauth_microsoft", emailAddress: "ana@land.co" },
          { id: "ea_b", provider: "oauth_microsoft", emailAddress: "bo@land.co" },
          { id: "eg_a", provider: "oauth_google", emailAddress: "ana@land.co" },
        ],
      }),
      getUserOauthAccessToken: async () => ({
        data: [
          { externalAccountId: "ea_a", token: "tok-ana" },
          { externalAccountId: "ea_b", token: "tok-bo" },
          { externalAccountId: "eg_a", token: "tok-g-ana" },
        ],
      }),
    },
  }),
}));

describe("a send reports what the provider said", () => {
  it("Graph's empty 202 is accepted — not an error", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendMessage } = await import("../../server/services/mailbox/mailboxClient");
    const out = await sendMessage(
      { userId: "user_1", provider: "outlook", emailAddress: "bo@land.co" },
      { to: "seller@example.com", subject: "Re: land", body: "<p>Yes</p>" },
    );
    expect(out.outcome).toBe("accepted_by_provider");
    expect((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer tok-bo" });
    vi.unstubAllGlobals();
  });

  it("a connection failure on a send is an UNKNOWN outcome; on a read it is a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("socket hang up");
    }));
    const { sendMessage, listMessages, MailboxApiError } = await import("../../server/services/mailbox/mailboxClient");
    const acct = { userId: "user_1", provider: "gmail" as const, emailAddress: "ana@land.co" };
    const sendErr = await sendMessage(acct, { to: "s@example.com", subject: "x", body: "y" }).catch((e) => e);
    expect(sendErr).toBeInstanceOf(MailboxApiError);
    expect(sendErr.outcome).toBe("unknown");
    const readErr = await listMessages(acct).catch((e) => e);
    expect(readErr.outcome).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe("an Outlook reply threads through Graph's reply endpoint", () => {
  it("POSTs to /messages/{id}/reply and never sends an In-Reply-To header Graph rejects", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendMessage } = await import("../../server/services/mailbox/mailboxClient");
    const out = await sendMessage(
      { userId: "user_1", provider: "outlook", emailAddress: "bo@land.co" },
      { to: "seller@example.com", subject: "Re: land", body: "<p>Yes</p>", inReplyTo: "<abc@mail>", replyToMessageId: "AAMk=1" },
    );
    expect(out.outcome).toBe("accepted_by_provider");
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/messages/AAMk%3D1/reply");
    expect(String(init.body)).not.toContain("internetMessageHeaders");
    expect(JSON.parse(String(init.body)).message.body.content).toBe("<p>Yes</p>");
    vi.unstubAllGlobals();
  });

  it("a new Outlook message still goes through sendMail", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { sendMessage } = await import("../../server/services/mailbox/mailboxClient");
    await sendMessage({ userId: "user_1", provider: "outlook", emailAddress: "bo@land.co" }, { to: "s@example.com", subject: "Hi", body: "<p>x</p>" });
    expect(String((fetchSpy.mock.calls[0] as unknown as [string])[0])).toMatch(/\/sendMail$/);
    vi.unstubAllGlobals();
  });
});
