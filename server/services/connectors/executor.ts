// Connector Tool Executor
// Handles actual API calls for each connector tool.
// Called from tools.ts when Pax invokes a connector tool.

import { storage } from "../../storage";
import type { Organization } from "@shared/schema";

interface ConnectorCredentials {
  // Google OAuth
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  // API keys
  apiKey?: string;
  secretKey?: string;
  // Webhook
  webhookUrl?: string;
  defaultChannel?: string;
  // MLS
  mlsUrl?: string;
  accessToken2?: string; // alias used for MLS
}

async function getCredentials(orgId: number, connectorId: string): Promise<ConnectorCredentials | null> {
  const instance = await storage.getPaxConnector(orgId, connectorId);
  if (!instance || instance.status !== "connected" || !instance.credentialsEncrypted) return null;
  try {
    const { decryptCredentials } = await import("../fieldEncryption");
    return JSON.parse(decryptCredentials(instance.credentialsEncrypted, orgId));
  } catch {
    return null;
  }
}

// ── Gmail ─────────────────────────────────────────────────────────────────

async function gmailFetch(accessToken: string, path: string, method = "GET", body?: object) {
  const res = await fetch(`https://gmail.googleapis.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API error ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

export async function searchGmail(org: Organization, args: { query: string; maxResults?: number }) {
  const creds = await getCredentials(org.id, "gmail");
  if (!creds?.accessToken) return { success: false, error: "Gmail is not connected. Ask the user to connect Gmail in Pax Connectors settings." };

  const { query, maxResults = 10 } = args;
  const list = await gmailFetch(creds.accessToken,
    `/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`);

  if (!list.messages?.length) return { success: true, data: { messages: [], total: 0 } };

  // Fetch snippets for first 5
  const messages = await Promise.all(
    list.messages.slice(0, 5).map(async (m: any) => {
      const msg = await gmailFetch(creds.accessToken!, `/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
      const headers: Record<string, string> = {};
      for (const h of msg.payload?.headers ?? []) headers[h.name] = h.value;
      return { id: m.id, from: headers.From, subject: headers.Subject, date: headers.Date, snippet: msg.snippet };
    })
  );

  return { success: true, data: { messages, total: list.resultSizeEstimate ?? messages.length } };
}

export async function sendGmail(org: Organization, args: { to: string; subject: string; body: string }) {
  const creds = await getCredentials(org.id, "gmail");
  if (!creds?.accessToken) return { success: false, error: "Gmail is not connected." };

  const raw = Buffer.from(
    `To: ${args.to}\r\nSubject: ${args.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${args.body}`
  ).toString("base64url");

  await gmailFetch(creds.accessToken, "/gmail/v1/users/me/messages/send", "POST", { raw });
  return { success: true, data: { sent: true, to: args.to, subject: args.subject } };
}

// ── Slack ─────────────────────────────────────────────────────────────────

export async function sendSlackMessage(org: Organization, args: { message: string; channel?: string }) {
  const creds = await getCredentials(org.id, "slack");
  if (!creds?.webhookUrl) return { success: false, error: "Slack is not connected. Connect it in Pax Connectors settings." };

  const channel = args.channel || creds.defaultChannel;
  const payload: Record<string, any> = { text: args.message };
  if (channel) payload.channel = channel;

  const res = await fetch(creds.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) return { success: false, error: `Slack webhook error: ${res.status}` };
  return { success: true, data: { sent: true, channel } };
}

// ── Stripe ────────────────────────────────────────────────────────────────

async function stripeFetch(secretKey: string, path: string, method = "GET", params?: Record<string, string>) {
  const url = new URL(`https://api.stripe.com${path}`);
  if (method === "GET" && params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${secretKey}` },
    body: method !== "GET" && params ? new URLSearchParams(params) : undefined,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Stripe error: ${err.error?.message ?? res.status}`);
  }
  return res.json();
}

export async function getStripeCustomer(org: Organization, args: { email?: string; customerId?: string }) {
  const creds = await getCredentials(org.id, "stripe");
  if (!creds?.secretKey) return { success: false, error: "Stripe is not connected." };

  if (args.customerId) {
    const customer = await stripeFetch(creds.secretKey, `/v1/customers/${args.customerId}`);
    return { success: true, data: customer };
  }
  const list = await stripeFetch(creds.secretKey, "/v1/customers", "GET", { email: args.email ?? "", limit: "5" });
  return { success: true, data: list.data };
}

export async function listStripePayments(org: Organization, args: { limit?: number; customerId?: string }) {
  const creds = await getCredentials(org.id, "stripe");
  if (!creds?.secretKey) return { success: false, error: "Stripe is not connected." };

  const params: Record<string, string> = { limit: String(args.limit ?? 10) };
  if (args.customerId) params.customer = args.customerId;

  const list = await stripeFetch(creds.secretKey, "/v1/charges", "GET", params);
  return {
    success: true,
    data: list.data.map((c: any) => ({
      id: c.id, amount: c.amount / 100, currency: c.currency,
      status: c.status, description: c.description, created: new Date(c.created * 1000).toISOString(),
      customerEmail: c.receipt_email,
    })),
  };
}

export async function createStripePaymentLink(org: Organization, args: { amount: number; description: string; currency?: string }) {
  const creds = await getCredentials(org.id, "stripe");
  if (!creds?.secretKey) return { success: false, error: "Stripe is not connected." };

  // Create a Price first, then a Payment Link
  const price = await stripeFetch(creds.secretKey, "/v1/prices", "POST", {
    unit_amount: String(Math.round(args.amount * 100)),
    currency: args.currency ?? "usd",
    product_data: JSON.stringify({ name: args.description }),
  } as any);

  const link = await stripeFetch(creds.secretKey, "/v1/payment_links", "POST", {
    "line_items[0][price]": price.id,
    "line_items[0][quantity]": "1",
  } as any);

  return { success: true, data: { url: link.url, id: link.id, amount: args.amount } };
}

// ── Google Drive ───────────────────────────────────────────────────────────

async function driveFetch(accessToken: string, path: string) {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive API error ${res.status}`);
  return res.json();
}

export async function searchDrive(org: Organization, args: { query: string; maxResults?: number }) {
  const creds = await getCredentials(org.id, "google_drive");
  if (!creds?.accessToken) return { success: false, error: "Google Drive is not connected." };

  const q = encodeURIComponent(`name contains '${args.query}' or fullText contains '${args.query}'`);
  const data = await driveFetch(creds.accessToken,
    `/drive/v3/files?q=${q}&pageSize=${args.maxResults ?? 10}&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)`);

  return {
    success: true,
    data: (data.files ?? []).map((f: any) => ({
      id: f.id, name: f.name, type: f.mimeType,
      modified: f.modifiedTime, url: f.webViewLink, size: f.size,
    })),
  };
}

export async function getDriveFile(org: Organization, args: { fileId: string }) {
  const creds = await getCredentials(org.id, "google_drive");
  if (!creds?.accessToken) return { success: false, error: "Google Drive is not connected." };

  const meta = await driveFetch(creds.accessToken, `/drive/v3/files/${args.fileId}?fields=id,name,mimeType,webViewLink`);
  return { success: true, data: meta };
}

// ── Google Calendar ────────────────────────────────────────────────────────

async function calFetch(accessToken: string, path: string, method = "GET", body?: object) {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Calendar API error ${res.status}`);
  return res.json();
}

export async function listCalendarEvents(org: Organization, args: { days?: number }) {
  const creds = await getCredentials(org.id, "google_calendar");
  if (!creds?.accessToken) return { success: false, error: "Google Calendar is not connected." };

  const now = new Date();
  const end = new Date(now.getTime() + (args.days ?? 7) * 24 * 60 * 60 * 1000);
  const data = await calFetch(creds.accessToken,
    `/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20`);

  return {
    success: true,
    data: (data.items ?? []).map((e: any) => ({
      id: e.id, title: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      location: e.location, attendees: (e.attendees ?? []).map((a: any) => a.email),
      description: e.description?.slice(0, 200),
    })),
  };
}

export async function createCalendarEvent(org: Organization, args: {
  title: string; startDateTime: string; endDateTime: string;
  description?: string; location?: string; attendees?: string[];
}) {
  const creds = await getCredentials(org.id, "google_calendar");
  if (!creds?.accessToken) return { success: false, error: "Google Calendar is not connected." };

  const event = await calFetch(creds.accessToken, "/calendar/v3/calendars/primary/events", "POST", {
    summary: args.title,
    description: args.description,
    location: args.location,
    start: { dateTime: args.startDateTime },
    end: { dateTime: args.endDateTime },
    attendees: (args.attendees ?? []).map((e) => ({ email: e })),
  });

  return { success: true, data: { id: event.id, link: event.htmlLink, title: event.summary } };
}

// ── PropStream ─────────────────────────────────────────────────────────────

export async function propstreamLookup(org: Organization, args: { address: string }) {
  const creds = await getCredentials(org.id, "propstream");
  if (!creds?.apiKey) return { success: false, error: "PropStream is not connected." };

  // PropStream API endpoint (simplified - actual endpoint varies by subscription)
  const res = await fetch(`https://api.propstream.com/property/search?address=${encodeURIComponent(args.address)}`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  });
  if (!res.ok) return { success: false, error: `PropStream error: ${res.status}` };
  const data = await res.json();
  return { success: true, data };
}

export async function propstreamComps(org: Organization, args: { address: string; radius?: number }) {
  const creds = await getCredentials(org.id, "propstream");
  if (!creds?.apiKey) return { success: false, error: "PropStream is not connected." };

  const res = await fetch(`https://api.propstream.com/comps?address=${encodeURIComponent(args.address)}&radius=${args.radius ?? 1}`, {
    headers: { Authorization: `Bearer ${creds.apiKey}` },
  });
  if (!res.ok) return { success: false, error: `PropStream comps error: ${res.status}` };
  return { success: true, data: await res.json() };
}

// ── BatchLeads ─────────────────────────────────────────────────────────────
//
// `batchLeadsSkipTrace` was deleted 2026-08-20, deletion-revealed: the FCRA
// gate in ai/tools.ts made its only caller unreachable, and Pax was its only
// caller. What it did was run a consumer-report lookup with a bare `fetch` —
// no provider registry, so no `provider_cache`, no circuit breaker, no
// telemetry, and no license check. AcreOS already has a governed skip-trace
// path: `services/providers/batchdata-provider.ts` registers the category with
// a cost, a circuit breaker, and `license: "proprietary"` marking the feed as
// non-redistributable. Two skip-trace implementations, one governed and one
// not, and the ungoverned one was the one a customer could reach by typing a
// sentence.
//
// If skip-trace through a BatchLeads key is wanted again, it belongs in the
// registry as a provider — not as a second raw fetch.

// ── Zapier / Make webhooks ────────────────────────────────────────────────

export async function triggerZapier(org: Organization, args: { data: Record<string, any> }) {
  const creds = await getCredentials(org.id, "zapier");
  if (!creds?.webhookUrl) return { success: false, error: "Zapier is not connected." };

  const res = await fetch(creds.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "pax", orgId: org.id, ...args.data }),
  });
  return { success: res.ok, data: { triggered: res.ok, status: res.status } };
}

export async function triggerMake(org: Organization, args: { data: Record<string, any> }) {
  const creds = await getCredentials(org.id, "make");
  if (!creds?.webhookUrl) return { success: false, error: "Make is not connected." };

  const res = await fetch(creds.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "pax", orgId: org.id, ...args.data }),
  });
  return { success: res.ok, data: { triggered: res.ok, status: res.status } };
}

// ── MLS ───────────────────────────────────────────────────────────────────

export async function searchMlsListings(org: Organization, args: { city?: string; state?: string; minPrice?: number; maxPrice?: number; status?: string; limit?: number }) {
  const creds = await getCredentials(org.id, "mls");
  if (!creds?.accessToken) return { success: false, error: "MLS is not connected." };

  const params = new URLSearchParams({
    $top: String(args.limit ?? 10),
    $filter: [
      args.city ? `City eq '${args.city}'` : "",
      args.state ? `StateOrProvince eq '${args.state}'` : "",
      args.minPrice ? `ListPrice ge ${args.minPrice}` : "",
      args.maxPrice ? `ListPrice le ${args.maxPrice}` : "",
      args.status ? `StandardStatus eq '${args.status}'` : "",
    ].filter(Boolean).join(" and ") || "StandardStatus eq 'Active'",
  });

  const baseUrl = (creds as any).mlsUrl ?? "https://replication.sparkplatform.com/api/v1";
  const res = await fetch(`${baseUrl}/Property?${params}`, {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  });
  if (!res.ok) return { success: false, error: `MLS API error: ${res.status}` };
  const data = await res.json();
  return { success: true, data: data.value ?? data };
}

export async function getMlsComps(org: Organization, args: { address: string; radius?: number; limit?: number }) {
  const creds = await getCredentials(org.id, "mls");
  if (!creds?.accessToken) return { success: false, error: "MLS is not connected." };

  const params = new URLSearchParams({
    $top: String(args.limit ?? 10),
    $filter: `StandardStatus eq 'Closed' and UnparsedAddress eq '${args.address}'`,
  });
  const baseUrl = (creds as any).mlsUrl ?? "https://replication.sparkplatform.com/api/v1";
  const res = await fetch(`${baseUrl}/Property?${params}`, {
    headers: { Authorization: `Bearer ${creds.accessToken}` },
  });
  if (!res.ok) return { success: false, error: `MLS comps error: ${res.status}` };
  return { success: true, data: await res.json() };
}
