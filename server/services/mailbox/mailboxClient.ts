/**
 * Native business inbox — on-demand read/send client (R1c, slices 2-3).
 *
 * MINIMAL-CUSTODY AT ITS FLOOR (reshape doctrine — connect, don't custody):
 * this module reads and sends mail ON-DEMAND through the customer's own
 * Gmail / Outlook, using a fresh OAuth token vended by Clerk at the point of
 * the call (see clerkMailbox.getMailboxAccessToken). It persists NOTHING —
 * no message bodies, no tokens. Every function normalizes the provider's
 * response into a provider-agnostic shape so the UI never branches on Gmail
 * vs Graph.
 *
 * SECURITY: the token is used only for the upstream Gmail/Graph call. It is
 * never logged, serialized, persisted, or included in a thrown error message.
 *
 * The pure helpers (MIME build, base64url, header parsing, normalization) are
 * exported so they can be unit-tested without a network — see
 * tests/unit/mailboxClient.test.ts. The live Gmail/Graph path can only be
 * exercised once Clerk mail scopes are configured (key-ready, not key-live).
 */

import { getMailboxAccessToken } from "./clerkMailbox";
import type { MailboxOAuthProvider } from "@shared/schema";

// ── Public normalized shapes ────────────────────────────────────────────────

export interface NormalizedMessage {
  id: string;
  threadId: string;
  /** Sender email address, e.g. "seller@example.com". */
  from: string;
  /** Sender display name, e.g. "Jane Seller" (may be ""). */
  fromName: string;
  subject: string;
  snippet: string;
  /** ISO-8601 timestamp. */
  date: string;
  unread: boolean;
}

export interface FullMessage extends NormalizedMessage {
  bodyHtml?: string;
  bodyText?: string;
  to?: string;
}

export interface ListMessagesOpts {
  query?: string;
  pageToken?: string;
  max?: number;
}

export interface ListMessagesResult {
  messages: NormalizedMessage[];
  nextPageToken?: string;
}

export interface SendMessageInput {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  threadId?: string;
}

// ── Typed errors ────────────────────────────────────────────────────────────

/** No linked/token-vending mailbox for this user+provider (Clerk returned null). */
export class MailboxNotConnectedError extends Error {
  readonly code = "MAILBOX_NOT_CONNECTED";
  constructor(provider: string) {
    super(`No connected ${provider} mailbox — link it in Settings, then try again.`);
    this.name = "MailboxNotConnectedError";
  }
}

/** An upstream Gmail/Graph call failed. Message is always safe (never leaks a token). */
export class MailboxApiError extends Error {
  readonly code = "MAILBOX_API_ERROR";
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "MailboxApiError";
    this.status = status;
  }
}

// ── Pure helpers (unit-tested without network) ──────────────────────────────

/** URL-safe base64 of a UTF-8 string (Gmail `raw` encoding). */
export function toBase64Url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode a URL-safe base64 string back to UTF-8 (Gmail body parts). */
export function fromBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf-8");
}

/** RFC-2047 encode a header value only when it contains non-ASCII. */
export function encodeMimeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

/**
 * Parse an RFC-2822 `From`/`To` header into name + email.
 * Handles `"Jane Seller" <jane@x.com>`, `Jane Seller <jane@x.com>`,
 * and a bare `jane@x.com`.
 */
export function parseAddressHeader(raw?: string | null): { name: string; email: string } {
  if (!raw) return { name: "", email: "" };
  const angle = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) return { name: angle[1].trim(), email: angle[2].trim() };
  return { name: "", email: raw.trim() };
}

/**
 * Build an RFC-2822 MIME message (HTML body). Pure — no network. `from` is
 * optional: Gmail fills the authenticated account's address when omitted.
 */
export function buildMimeMessage(opts: {
  to: string;
  subject: string;
  body: string;
  from?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];
  if (opts.from) lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to}`);
  lines.push(`Subject: ${encodeMimeHeader(opts.subject)}`);
  if (opts.inReplyTo) {
    lines.push(`In-Reply-To: ${opts.inReplyTo}`);
    lines.push(`References: ${opts.references ?? opts.inReplyTo}`);
  }
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: base64");
  // Base64-encode the body so non-ASCII HTML survives the 7-bit transport.
  const encodedBody = Buffer.from(opts.body, "utf-8").toString("base64");
  return `${lines.join("\r\n")}\r\n\r\n${encodedBody}`;
}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPayload {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPayload;
}

function gmailHeader(payload: GmailPayload | undefined, name: string): string | undefined {
  return payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/** Normalize a Gmail metadata-format message into NormalizedMessage. */
export function normalizeGmailMessage(msg: GmailMessage): NormalizedMessage {
  const fromRaw = gmailHeader(msg.payload, "From");
  const { name, email } = parseAddressHeader(fromRaw);
  const dateHeader = gmailHeader(msg.payload, "Date");
  let iso: string;
  const parsed = dateHeader ? new Date(dateHeader) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    iso = parsed.toISOString();
  } else if (msg.internalDate) {
    iso = new Date(Number(msg.internalDate)).toISOString();
  } else {
    iso = new Date(0).toISOString();
  }
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: email,
    fromName: name,
    subject: gmailHeader(msg.payload, "Subject") ?? "",
    snippet: msg.snippet ?? "",
    date: iso,
    unread: (msg.labelIds ?? []).includes("UNREAD"),
  };
}

/** Recursively pull the best HTML + text body out of a Gmail payload tree. */
export function extractGmailBody(payload: GmailPayload | undefined): {
  bodyHtml?: string;
  bodyText?: string;
} {
  let bodyHtml: string | undefined;
  let bodyText: string | undefined;
  const walk = (part?: GmailPayload) => {
    if (!part) return;
    const data = part.body?.data;
    if (data) {
      if (part.mimeType === "text/html" && bodyHtml === undefined) bodyHtml = fromBase64Url(data);
      else if (part.mimeType === "text/plain" && bodyText === undefined) bodyText = fromBase64Url(data);
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  return { bodyHtml, bodyText };
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  body?: { contentType?: string; content?: string };
}

/** Normalize a Microsoft Graph message into NormalizedMessage. */
export function normalizeGraphMessage(msg: GraphMessage): NormalizedMessage {
  const addr = msg.from?.emailAddress;
  const parsed = msg.receivedDateTime ? new Date(msg.receivedDateTime) : null;
  const iso =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
  return {
    id: msg.id,
    threadId: msg.conversationId ?? msg.id,
    from: addr?.address ?? "",
    fromName: addr?.name ?? "",
    subject: msg.subject ?? "",
    snippet: msg.bodyPreview ?? "",
    date: iso,
    unread: msg.isRead === false,
  };
}

// ── Fetch plumbing (network) ────────────────────────────────────────────────

/**
 * Fetch JSON with a bearer token and map any failure to a SAFE typed error.
 * The token is only ever placed in the Authorization header — never in a
 * thrown message, so a leaked stack trace can't expose it.
 */
async function authedFetch<T>(
  url: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // Network/DNS/TLS failure — never echo the URL (harmless) or token (absent here).
    throw new MailboxApiError("Couldn't reach your mail provider. Try again in a moment.");
  }
  if (!res.ok) {
    // Read a short upstream reason for logging context, but keep the client
    // message generic and status-scoped. The body never contains the token.
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    const safe =
      res.status === 401 || res.status === 403
        ? "Your mail provider rejected the request — reconnect the mailbox and try again."
        : `Your mail provider returned an error (${res.status}).`;
    throw new MailboxApiError(safe + (detail ? ` (${sanitizeDetail(detail)})` : ""), res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Strip anything token-shaped from an upstream error body before surfacing it. */
export function sanitizeDetail(detail: string): string {
  return detail
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/ya29\.[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/"access_token"\s*:\s*"[^"]*"/g, '"access_token":"[redacted]"');
}

// ── Provider adapters ───────────────────────────────────────────────────────

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0/me";

async function gmailList(token: string, opts: ListMessagesOpts): Promise<ListMessagesResult> {
  const params = new URLSearchParams();
  params.set("maxResults", String(opts.max ?? 25));
  if (opts.query) params.set("q", opts.query);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const listing = await authedFetch<{
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
  }>(`${GMAIL_BASE}/messages?${params.toString()}`, token);

  const ids = listing.messages ?? [];
  const messages = await Promise.all(
    ids.map(async ({ id }) => {
      const meta = await authedFetch<GmailMessage>(
        `${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=metadata` +
          "&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date",
        token,
      );
      return normalizeGmailMessage(meta);
    }),
  );
  return { messages, nextPageToken: listing.nextPageToken };
}

async function gmailGet(token: string, messageId: string): Promise<FullMessage> {
  const msg = await authedFetch<GmailMessage>(
    `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?format=full`,
    token,
  );
  const base = normalizeGmailMessage(msg);
  const body = extractGmailBody(msg.payload);
  const to = parseAddressHeader(gmailHeader(msg.payload, "To")).email || undefined;
  return { ...base, ...body, to };
}

async function gmailSend(
  token: string,
  input: SendMessageInput,
): Promise<{ id: string }> {
  const mime = buildMimeMessage({
    to: input.to,
    subject: input.subject,
    body: input.body,
    inReplyTo: input.inReplyTo,
  });
  const payload: { raw: string; threadId?: string } = { raw: toBase64Url(mime) };
  if (input.threadId) payload.threadId = input.threadId;
  const sent = await authedFetch<{ id: string; threadId?: string }>(
    `${GMAIL_BASE}/messages/send`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return { id: sent.id };
}

const GRAPH_SELECT =
  "id,conversationId,subject,from,bodyPreview,receivedDateTime,isRead";

async function graphList(token: string, opts: ListMessagesOpts): Promise<ListMessagesResult> {
  // A pageToken here is Graph's full @odata.nextLink URL. It is server-issued,
  // but it round-trips through the client, so we never fetch it verbatim (that
  // would let a crafted token steer this OAuth-bearing request at an internal
  // or metadata endpoint — SSRF). Instead we carry over ONLY its opaque
  // continuation query params and rebuild the request against our own constant
  // GRAPH_BASE, so the request origin is always a hardcoded literal.
  const params = new URLSearchParams();
  if (opts.pageToken) {
    let parsed: URL;
    try {
      parsed = new URL(opts.pageToken);
    } catch {
      throw new MailboxApiError("Invalid page token.");
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "graph.microsoft.com") {
      throw new MailboxApiError("Invalid page token.");
    }
    for (const [key, value] of parsed.searchParams) params.set(key, value);
  } else {
    params.set("$select", GRAPH_SELECT);
    params.set("$top", String(opts.max ?? 25));
    params.set("$orderby", "receivedDateTime desc");
    if (opts.query) params.set("$search", `"${opts.query}"`);
  }
  const url = `${GRAPH_BASE}/messages?${params.toString()}`;
  const listing = await authedFetch<{
    value?: GraphMessage[];
    "@odata.nextLink"?: string;
  }>(url, token);
  return {
    messages: (listing.value ?? []).map(normalizeGraphMessage),
    nextPageToken: listing["@odata.nextLink"],
  };
}

async function graphGet(token: string, messageId: string): Promise<FullMessage> {
  const msg = await authedFetch<GraphMessage>(
    `${GRAPH_BASE}/messages/${encodeURIComponent(messageId)}?$select=${GRAPH_SELECT},toRecipients,body`,
    token,
  );
  const base = normalizeGraphMessage(msg);
  const isHtml = (msg.body?.contentType ?? "").toLowerCase() === "html";
  const to = msg.toRecipients?.[0]?.emailAddress?.address;
  return {
    ...base,
    bodyHtml: isHtml ? msg.body?.content : undefined,
    bodyText: isHtml ? undefined : msg.body?.content,
    to,
  };
}

async function graphSend(
  token: string,
  input: SendMessageInput,
): Promise<{ id: string }> {
  const message: Record<string, unknown> = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.body },
    toRecipients: [{ emailAddress: { address: input.to } }],
  };
  if (input.inReplyTo) {
    // Best-effort threading header — Graph accepts standard internet headers.
    message.internetMessageHeaders = [{ name: "In-Reply-To", value: input.inReplyTo }];
  }
  await authedFetch<void>(`${GRAPH_BASE}/sendMail`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  // Graph sendMail returns 202 with no id; surface the thread anchor if any.
  return { id: input.threadId ?? "" };
}

// ── Public API (resolves a fresh token per call, never stored) ───────────────

async function tokenOrThrow(userId: string, provider: MailboxOAuthProvider): Promise<string> {
  const token = await getMailboxAccessToken(userId, provider);
  if (!token) throw new MailboxNotConnectedError(provider);
  return token;
}

export async function listMessages(
  userId: string,
  provider: MailboxOAuthProvider,
  opts: ListMessagesOpts = {},
): Promise<ListMessagesResult> {
  const token = await tokenOrThrow(userId, provider);
  return provider === "gmail" ? gmailList(token, opts) : graphList(token, opts);
}

export async function getMessage(
  userId: string,
  provider: MailboxOAuthProvider,
  messageId: string,
): Promise<FullMessage> {
  const token = await tokenOrThrow(userId, provider);
  return provider === "gmail" ? gmailGet(token, messageId) : graphGet(token, messageId);
}

export async function sendMessage(
  userId: string,
  provider: MailboxOAuthProvider,
  input: SendMessageInput,
): Promise<{ id: string }> {
  const token = await tokenOrThrow(userId, provider);
  return provider === "gmail" ? gmailSend(token, input) : graphSend(token, input);
}
