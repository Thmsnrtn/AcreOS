// Pax Connector Registry
// Defines all available connectors, their capabilities, and auth requirements.
// Actual OAuth credentials (client_id/secret) come from env vars.
// Per-org credentials (tokens, API keys) are stored in pax_connector_instances.

export type ConnectorAuthType = "oauth" | "apikey" | "webhook" | "none";
export type ConnectorCategory =
  | "communication"
  | "finance"
  | "storage"
  | "productivity"
  | "real_estate"
  | "automation";

export interface CredentialField {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  helpText?: string;
}

export interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  icon: string;           // lucide icon name used on client
  category: ConnectorCategory;
  authType: ConnectorAuthType;
  capabilities: string[]; // human-readable capabilities shown in UI
  tools: string[];        // tool names exposed to Pax when connected
  // For OAuth connectors
  oauthScopes?: string[];
  // For API key / webhook connectors
  credentialFields?: CredentialField[];
  // External docs / setup URL shown in the UI
  setupUrl?: string;
  isPremium?: boolean;
}

export const CONNECTOR_REGISTRY: ConnectorDef[] = [
  // ── Communication ─────────────────────────────────────────────────────────
  {
    id: "gmail",
    name: "Gmail",
    description: "Search and send emails. Pax can read threads from leads and send follow-ups on your behalf.",
    icon: "Mail",
    category: "communication",
    authType: "oauth",
    oauthScopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    capabilities: [
      "Search emails from leads",
      "Read email threads",
      "Send emails and follow-ups",
      "Draft emails for your review",
    ],
    tools: ["search_gmail", "send_gmail"],
    setupUrl: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send deal alerts, lead notifications, and summaries to your Slack channels.",
    icon: "Hash",
    category: "communication",
    authType: "apikey",
    credentialFields: [
      {
        key: "webhookUrl",
        label: "Incoming Webhook URL",
        placeholder: "https://hooks.slack.com/services/...",
        secret: true,
        helpText: "Create an Incoming Webhook in your Slack app settings.",
      },
      {
        key: "defaultChannel",
        label: "Default Channel (optional)",
        placeholder: "#deals",
        secret: false,
      },
    ],
    capabilities: [
      "Send deal alerts to channels",
      "Post lead notifications",
      "Share AI summaries with team",
      "Trigger Slack from Pax actions",
    ],
    tools: ["send_slack_message"],
    setupUrl: "https://api.slack.com/messaging/webhooks",
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    id: "stripe",
    name: "Stripe",
    description: "Access payment data, customer info, and create payment links for deals directly in Pax.",
    icon: "CreditCard",
    category: "finance",
    authType: "apikey",
    credentialFields: [
      {
        key: "secretKey",
        label: "Secret Key",
        placeholder: "sk_live_...",
        secret: true,
        helpText: "Find your secret key in the Stripe dashboard → Developers → API Keys.",
      },
    ],
    capabilities: [
      "Check customer payment status",
      "List recent charges",
      "Create payment links for deals",
      "Look up subscription data",
    ],
    tools: ["get_stripe_customer", "list_stripe_payments", "create_stripe_payment_link"],
    setupUrl: "https://dashboard.stripe.com/apikeys",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    description: "Sync deal financials with QuickBooks. Pull P&L, track deal expenses, and reconcile payments.",
    icon: "BookOpen",
    category: "finance",
    authType: "oauth",
    oauthScopes: ["com.intuit.quickbooks.accounting"],
    capabilities: [
      "Pull P&L reports",
      "Track deal expenses",
      "Reconcile payments",
      "Export deal data to QuickBooks",
    ],
    tools: ["get_quickbooks_pnl", "list_quickbooks_transactions"],
    setupUrl: "https://developer.intuit.com/app/developer/qbo/docs/get-started",
    isPremium: true,
  },

  // ── Storage & Documents ───────────────────────────────────────────────────
  {
    id: "google_drive",
    name: "Google Drive",
    description: "Search, access, and upload property documents. Pax can organize your Drive by deal.",
    icon: "HardDrive",
    category: "storage",
    authType: "oauth",
    oauthScopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    capabilities: [
      "Search property documents",
      "Access deal folders",
      "Upload due diligence files",
      "Create folders per deal",
    ],
    tools: ["search_drive", "get_drive_file", "upload_drive_file"],
    setupUrl: "https://console.cloud.google.com/apis/library/drive.googleapis.com",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Access your Dropbox files. Pax can search and retrieve property documents.",
    icon: "Archive",
    category: "storage",
    authType: "oauth",
    oauthScopes: ["files.content.read", "files.content.write"],
    capabilities: [
      "Search property files",
      "Retrieve documents",
      "Share files with sellers",
    ],
    tools: ["search_dropbox", "get_dropbox_file"],
    setupUrl: "https://www.dropbox.com/developers",
    isPremium: true,
  },
  {
    id: "docusign",
    name: "DocuSign",
    description: "Send contracts and offer letters for e-signature. Pax can prepare and send documents without leaving the chat.",
    icon: "FileSignature",
    category: "storage",
    authType: "oauth",
    oauthScopes: ["signature"],
    capabilities: [
      "Send offer letters for signature",
      "Check signature status",
      "Create signing envelopes",
      "Get signed document copies",
    ],
    tools: ["send_docusign_envelope", "get_docusign_status"],
    setupUrl: "https://developers.docusign.com/docs/esign-rest-api/quickstart/",
  },

  // ── Productivity ─────────────────────────────────────────────────────────
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Schedule showings, closings, and follow-ups. Pax can check your calendar and book appointments.",
    icon: "Calendar",
    category: "productivity",
    authType: "oauth",
    oauthScopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    capabilities: [
      "List upcoming events",
      "Schedule showings and closings",
      "Check calendar availability",
      "Create follow-up reminders",
    ],
    tools: ["list_calendar_events", "create_calendar_event"],
    setupUrl: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
  },

  // ── Real Estate ───────────────────────────────────────────────────────────
  {
    id: "propstream",
    name: "PropStream",
    description: "Pull owner data, property history, equity, and liens. Skip trace directly from Pax.",
    icon: "Home",
    category: "real_estate",
    authType: "apikey",
    credentialFields: [
      {
        key: "apiKey",
        label: "API Key",
        placeholder: "ps_...",
        secret: true,
        helpText: "Find your API key in your PropStream account settings.",
      },
    ],
    capabilities: [
      "Owner lookup and skip trace",
      "Equity and lien data",
      "Property history",
      "Comparable sales",
    ],
    tools: ["propstream_lookup", "propstream_comps"],
    setupUrl: "https://www.propstream.com/",
  },
  {
    id: "batch_leads",
    name: "BatchLeads",
    description: "Skip trace leads and pull list data directly from Pax conversations.",
    icon: "Users",
    category: "real_estate",
    authType: "apikey",
    credentialFields: [
      {
        key: "apiKey",
        label: "API Key",
        placeholder: "bl_...",
        secret: true,
      },
    ],
    capabilities: [
      "Skip trace contacts",
      "Pull targeted lists",
      "Get owner phone numbers",
      "Cross-reference properties",
    ],
    tools: ["batch_leads_skip_trace"],
    setupUrl: "https://batchleads.io/",
  },
  {
    id: "mls",
    name: "MLS / RESO API",
    description: "Connect to your local MLS via RESO-compliant API. Pull active listings, comps, and days-on-market.",
    icon: "Building2",
    category: "real_estate",
    authType: "apikey",
    credentialFields: [
      { key: "mlsUrl", label: "RESO API Base URL", placeholder: "https://replication.yourmlsname.com/reso/odata", secret: false },
      { key: "accessToken", label: "Access Token", placeholder: "bearer_...", secret: true },
    ],
    capabilities: [
      "Active MLS listings",
      "Sold comps",
      "Days on market data",
      "Price history",
    ],
    tools: ["search_mls_listings", "get_mls_comps"],
    setupUrl: "https://www.nar.realtor/reso",
  },

  // ── Automation ────────────────────────────────────────────────────────────
  {
    id: "zapier",
    name: "Zapier",
    description: "Trigger Zapier workflows from Pax. Connect 6,000+ apps when Pax takes an action.",
    icon: "Zap",
    category: "automation",
    authType: "webhook",
    credentialFields: [
      {
        key: "webhookUrl",
        label: "Zapier Webhook URL",
        placeholder: "https://hooks.zapier.com/hooks/catch/...",
        secret: true,
        helpText: "Create a Zapier 'Catch Hook' trigger and paste the URL here.",
      },
    ],
    capabilities: [
      "Trigger Zaps from Pax actions",
      "Send lead data to any app",
      "Automate follow-up sequences",
      "Connect 6,000+ apps",
    ],
    tools: ["trigger_zapier"],
    setupUrl: "https://zapier.com/app/editor",
  },
  {
    id: "make",
    name: "Make (Integromat)",
    description: "Trigger Make scenarios from Pax. Build complex automation workflows without code.",
    icon: "Workflow",
    category: "automation",
    authType: "webhook",
    credentialFields: [
      {
        key: "webhookUrl",
        label: "Make Webhook URL",
        placeholder: "https://hook.eu1.make.com/...",
        secret: true,
        helpText: "Add a Webhook module as a trigger in your Make scenario.",
      },
    ],
    capabilities: [
      "Trigger Make scenarios",
      "Send structured data to any app",
      "Complex multi-step automation",
    ],
    tools: ["trigger_make"],
    setupUrl: "https://www.make.com/en/help/tools/webhooks",
  },
];

// Look up a connector by ID
export function getConnector(id: string): ConnectorDef | undefined {
  return CONNECTOR_REGISTRY.find((c) => c.id === id);
}

// Get all tool names exposed by connected connectors
export function getConnectorTools(connectedIds: string[]): string[] {
  return CONNECTOR_REGISTRY
    .filter((c) => connectedIds.includes(c.id))
    .flatMap((c) => c.tools);
}

// Build a system-prompt summary of connected connectors
export function buildConnectorContextBlock(connectedIds: string[]): string {
  const connected = CONNECTOR_REGISTRY.filter((c) => connectedIds.includes(c.id));
  if (connected.length === 0) return "";

  const lines = connected.map((c) =>
    `- ${c.name}: ${c.capabilities.join(", ")}. Tools: ${c.tools.join(", ")}.`
  );
  return `\n\n=== CONNECTED INTEGRATIONS ===\nYou have access to the following external services via configured connectors. Use their tools when relevant:\n${lines.join("\n")}\n=== END CONNECTED INTEGRATIONS ===`;
}
