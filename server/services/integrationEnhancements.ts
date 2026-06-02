/**
 * Integration & Ecosystem Enhancements — Items 261-280
 * Zapier webhooks, Google Sheets, Slack, iCal, etc.
 */

// Item 276: Webhooks v2 — richer payloads
export function buildRichWebhookPayload(event: string, entity: any, metadata?: Record<string, any>): {
  event: string;
  timestamp: string;
  version: "2.0";
  data: any;
  metadata: Record<string, any>;
} {
  return {
    event,
    timestamp: new Date().toISOString(),
    version: "2.0",
    data: entity,
    metadata: { ...metadata, source: "acreos", apiVersion: "2.0" },
  };
}

// Item 278: iCal feed generation
export function generateICal(events: Array<{ title: string; date: Date; description?: string }>): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AcreOS//Deals//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const event of events) {
    const dateStr = event.date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    lines.push(
      "BEGIN:VEVENT",
      `DTSTART:${dateStr}`,
      `DTEND:${dateStr}`,
      `SUMMARY:${event.title}`,
      event.description ? `DESCRIPTION:${event.description.replace(/\n/g, "\\n")}` : "",
      `UID:${Date.now()}-${Math.random().toString(36)}@acreos.io`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).join("\r\n");
}

// Item 263: Slack notification payload
export function buildSlackNotification(event: string, details: string, url?: string): {
  text: string;
  blocks: any[];
} {
  return {
    text: `[AcreOS] ${event}: ${details}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `🏡 ${event}` } },
      { type: "section", text: { type: "mrkdwn", text: details } },
      ...(url ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "View in AcreOS" }, url }] }] : []),
    ],
  };
}

// Item 262: Google Sheets export format
export function prepareForGoogleSheets(data: any[]): { headers: string[]; rows: any[][] } {
  if (!data.length) return { headers: [], rows: [] };
  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => row[h] ?? ""));
  return { headers, rows };
}
