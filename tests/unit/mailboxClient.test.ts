/**
 * Native inbox — mailboxClient pure-logic unit tests (R1c slices 2-3).
 *
 * The live Gmail/Graph network path can't be exercised without Clerk mail
 * scopes configured, so these tests pin the PURE, network-free helpers:
 * MIME build, base64url round-trip, header parsing, Gmail/Graph normalization,
 * body extraction, and the token-safe error mapping.
 */

import { describe, it, expect } from "vitest";
import {
  toBase64Url,
  fromBase64Url,
  encodeMimeHeader,
  parseAddressHeader,
  buildMimeMessage,
  normalizeGmailMessage,
  extractGmailBody,
  normalizeGraphMessage,
  sanitizeDetail,
  MailboxNotConnectedError,
  MailboxApiError,
  type GmailMessage,
  type GraphMessage,
} from "../../server/services/mailbox/mailboxClient";

describe("base64url", () => {
  it("round-trips UTF-8 including non-ASCII", () => {
    const s = "Hello — señor café 🌱";
    expect(fromBase64Url(toBase64Url(s))).toBe(s);
  });

  it("produces URL-safe output (no +, /, or = padding)", () => {
    const out = toBase64Url("???>>>???");
    expect(out).not.toMatch(/[+/=]/);
  });

  it("decodes standard Gmail-style base64url part data", () => {
    const encoded = toBase64Url("<p>Hi there</p>");
    expect(fromBase64Url(encoded)).toBe("<p>Hi there</p>");
  });
});

describe("encodeMimeHeader", () => {
  it("passes ASCII through untouched", () => {
    expect(encodeMimeHeader("Re: your offer")).toBe("Re: your offer");
  });

  it("RFC-2047 encodes non-ASCII subjects", () => {
    const out = encodeMimeHeader("Café ☕");
    expect(out).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
  });
});

describe("parseAddressHeader", () => {
  it("parses a quoted display name + angle address", () => {
    expect(parseAddressHeader('"Jane Seller" <jane@example.com>')).toEqual({
      name: "Jane Seller",
      email: "jane@example.com",
    });
  });

  it("parses an unquoted display name", () => {
    expect(parseAddressHeader("Jane Seller <jane@example.com>")).toEqual({
      name: "Jane Seller",
      email: "jane@example.com",
    });
  });

  it("parses a bare address", () => {
    expect(parseAddressHeader("jane@example.com")).toEqual({
      name: "",
      email: "jane@example.com",
    });
  });

  it("handles null/undefined", () => {
    expect(parseAddressHeader(null)).toEqual({ name: "", email: "" });
    expect(parseAddressHeader(undefined)).toEqual({ name: "", email: "" });
  });
});

describe("buildMimeMessage", () => {
  it("builds RFC-2822 with To/Subject and base64 body", () => {
    const mime = buildMimeMessage({ to: "a@b.com", subject: "Hi", body: "<p>Yo</p>" });
    expect(mime).toContain("To: a@b.com");
    expect(mime).toContain("Subject: Hi");
    expect(mime).toContain('Content-Type: text/html; charset="UTF-8"');
    // Body is base64-encoded after the blank-line separator.
    const [, encodedBody] = mime.split("\r\n\r\n");
    expect(Buffer.from(encodedBody, "base64").toString("utf-8")).toBe("<p>Yo</p>");
  });

  it("omits From when not provided (Gmail fills it)", () => {
    const mime = buildMimeMessage({ to: "a@b.com", subject: "Hi", body: "x" });
    expect(mime).not.toContain("From:");
  });

  it("includes From when provided", () => {
    const mime = buildMimeMessage({ to: "a@b.com", subject: "Hi", body: "x", from: "me@x.com" });
    expect(mime).toContain("From: me@x.com");
  });

  it("adds In-Reply-To and mirrors References when replying", () => {
    const mime = buildMimeMessage({
      to: "a@b.com",
      subject: "Re: Hi",
      body: "x",
      inReplyTo: "<abc@mail>",
    });
    expect(mime).toContain("In-Reply-To: <abc@mail>");
    expect(mime).toContain("References: <abc@mail>");
  });
});

describe("normalizeGmailMessage", () => {
  const msg: GmailMessage = {
    id: "m1",
    threadId: "t1",
    snippet: "the preview",
    labelIds: ["INBOX", "UNREAD"],
    internalDate: "1700000000000",
    payload: {
      headers: [
        { name: "From", value: '"Jane" <jane@x.com>' },
        { name: "Subject", value: "Offer" },
        { name: "Date", value: "Wed, 15 Nov 2023 10:00:00 +0000" },
      ],
    },
  };

  it("maps headers, snippet, and unread label", () => {
    const n = normalizeGmailMessage(msg);
    expect(n).toMatchObject({
      id: "m1",
      threadId: "t1",
      from: "jane@x.com",
      fromName: "Jane",
      subject: "Offer",
      snippet: "the preview",
      unread: true,
    });
    expect(n.date).toBe(new Date("Wed, 15 Nov 2023 10:00:00 +0000").toISOString());
  });

  it("marks read when UNREAD label is absent", () => {
    const n = normalizeGmailMessage({ ...msg, labelIds: ["INBOX"] });
    expect(n.unread).toBe(false);
  });

  it("falls back to internalDate when Date header is unparseable", () => {
    const n = normalizeGmailMessage({
      ...msg,
      payload: { headers: [{ name: "Date", value: "not-a-date" }] },
    });
    expect(n.date).toBe(new Date(1700000000000).toISOString());
  });
});

describe("extractGmailBody", () => {
  it("pulls html and text from a multipart payload", () => {
    const body = extractGmailBody({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: toBase64Url("plain hi") } },
        { mimeType: "text/html", body: { data: toBase64Url("<p>hi</p>") } },
      ],
    });
    expect(body.bodyText).toBe("plain hi");
    expect(body.bodyHtml).toBe("<p>hi</p>");
  });

  it("handles a single-part text/html body", () => {
    const body = extractGmailBody({
      mimeType: "text/html",
      body: { data: toBase64Url("<b>x</b>") },
    });
    expect(body.bodyHtml).toBe("<b>x</b>");
    expect(body.bodyText).toBeUndefined();
  });
});

describe("normalizeGraphMessage", () => {
  const g: GraphMessage = {
    id: "g1",
    conversationId: "c1",
    subject: "Graph subject",
    bodyPreview: "graph preview",
    receivedDateTime: "2023-11-15T10:00:00Z",
    isRead: false,
    from: { emailAddress: { name: "Bob", address: "bob@x.com" } },
  };

  it("maps Graph fields and inverts isRead into unread", () => {
    const n = normalizeGraphMessage(g);
    expect(n).toMatchObject({
      id: "g1",
      threadId: "c1",
      from: "bob@x.com",
      fromName: "Bob",
      subject: "Graph subject",
      snippet: "graph preview",
      unread: true,
    });
    expect(n.date).toBe(new Date("2023-11-15T10:00:00Z").toISOString());
  });

  it("treats read mail (isRead:true) as not unread", () => {
    expect(normalizeGraphMessage({ ...g, isRead: true }).unread).toBe(false);
  });

  it("falls back to id as threadId when conversationId is absent", () => {
    const { conversationId, ...rest } = g;
    void conversationId;
    expect(normalizeGraphMessage(rest).threadId).toBe("g1");
  });
});

describe("sanitizeDetail", () => {
  it("redacts bearer tokens and access_token fields", () => {
    const raw = 'Authorization: Bearer ya29.aAbBcC-_123 and {"access_token":"secret"}';
    const out = sanitizeDetail(raw);
    expect(out).not.toContain("ya29.aAbBcC");
    expect(out).not.toContain("secret");
    expect(out).toContain("[redacted]");
  });
});

describe("typed errors", () => {
  it("MailboxNotConnectedError carries a stable code and provider name", () => {
    const e = new MailboxNotConnectedError("gmail");
    expect(e.code).toBe("MAILBOX_NOT_CONNECTED");
    expect(e.message).toContain("gmail");
    expect(e).toBeInstanceOf(Error);
  });

  it("MailboxApiError carries code + optional status and never requires a token", () => {
    const e = new MailboxApiError("Your mail provider returned an error (500).", 500);
    expect(e.code).toBe("MAILBOX_API_ERROR");
    expect(e.status).toBe(500);
  });
});
