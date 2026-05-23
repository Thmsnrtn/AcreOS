/**
 * Atlas operational-hands tools (Phase G — read-only batch 1).
 *
 * Wraps the Fly Machines API client with Tier-1 inquiry tools so Atlas
 * can answer "what's the state of prod?" without any destructive
 * capability yet. Destructive operations (restart, scale, deploy,
 * secret set/unset) land in a follow-up commit gated by Tier-3
 * confirmation + the sealed-paste flow.
 *
 * Stripe/Clerk/GitHub/DB read-only tools follow this same pattern in
 * sibling files (stripe-ops.ts, clerk-ops.ts, github-ops.ts, db-ops.ts).
 */

import { z } from "zod";
import {
  FlyClientError,
  getAppHealth,
  listMachines,
  listReleases,
  listSecretNames,
} from "../providers/fly";
import {
  getActiveSubscriptions,
  getCustomerInvoices,
  lookupCustomer,
} from "../providers/stripe-ops";
import { registerTool } from "../tool-registry";
import { logger } from "../../../utils/logger";

const FALLBACK_TEXT = (markdown: string) =>
  ({ artifact: { type: "text" as const, markdown } });

// ─── fly_status ──────────────────────────────────────────────────────────────
registerTool({
  name: "fly_status",
  description:
    "Summarize the current Fly app health: machine count, state breakdown, regions, age of the oldest machine. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    app: z.string().optional().describe("Fly app name override (defaults to FLY_APP_NAME or 'acreos')"),
  }),
  artifactType: "text",
  slashAliases: ["fly", "fly-status"],
  handler: async ({ app }) => {
    try {
      const h = await getAppHealth(app);
      const lines: string[] = [];
      lines.push(`**Fly app:** \`${h.appName}\``);
      lines.push(`**Machines:** ${h.machineCount}`);
      const stateBits = Object.entries(h.states)
        .map(([s, n]) => `${s} (${n})`)
        .join(", ");
      lines.push(`**States:** ${stateBits || "—"}`);
      lines.push(`**Regions:** ${h.regions.length ? h.regions.join(", ") : "—"}`);
      if (h.oldestMachineAgeHours !== null) {
        lines.push(`**Oldest machine:** ${h.oldestMachineAgeHours}h`);
      }
      return FALLBACK_TEXT(lines.join("\n"));
    } catch (err) {
      if (err instanceof FlyClientError) {
        logger.warn({ status: err.status }, "fly_status failed");
        return FALLBACK_TEXT(`Fly API unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── fly_releases ────────────────────────────────────────────────────────────
registerTool({
  name: "fly_releases",
  description: "List the most recent Fly releases (deploys) for an app. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    limit: z.number().int().min(1).max(50).default(10),
    app: z.string().optional(),
  }),
  artifactType: "text",
  slashAliases: ["releases", "fly-releases"],
  handler: async ({ limit, app }) => {
    try {
      const releases = await listReleases(limit, app);
      if (!releases.length) {
        return FALLBACK_TEXT(
          "No recent releases visible via the Machines API on this app. (The release list endpoint isn't always exposed; deploys still happen — they're just not enumerable here.)",
        );
      }
      const lines = releases.map((r) => {
        const age = r.created_at
          ? `${Math.round((Date.now() - new Date(r.created_at).getTime()) / 3_600_000)}h ago`
          : "—";
        return `- **v${r.version}** · ${r.status} · ${age}${r.user_email ? ` · ${r.user_email}` : ""}`;
      });
      return FALLBACK_TEXT(`### Recent releases\n\n${lines.join("\n")}`);
    } catch (err) {
      if (err instanceof FlyClientError) {
        return FALLBACK_TEXT(`Fly releases unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── fly_machines ────────────────────────────────────────────────────────────
registerTool({
  name: "fly_machines",
  description: "List every Fly machine for an app with id, name, region, state. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    app: z.string().optional(),
  }),
  artifactType: "text",
  slashAliases: ["machines"],
  handler: async ({ app }) => {
    try {
      const machines = await listMachines(app);
      if (!machines.length) {
        return FALLBACK_TEXT("No machines found.");
      }
      const lines = machines.map(
        (m) =>
          `- \`${m.id}\` · ${m.name} · ${m.region} · **${m.state}**${
            m.config?.image ? ` · ${m.config.image.split("/").pop()}` : ""
          }`,
      );
      return FALLBACK_TEXT(`### Machines (${machines.length})\n\n${lines.join("\n")}`);
    } catch (err) {
      if (err instanceof FlyClientError) {
        return FALLBACK_TEXT(`Fly machines unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── stripe_lookup_customer ──────────────────────────────────────────────────
registerTool({
  name: "stripe_lookup_customer",
  description:
    "Look up a Stripe customer by email, customer id (cus_…), or partial name. Returns up to 5 matches. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    query: z.string().min(3).describe("Email, cus_ id, or partial name"),
  }),
  artifactType: "text",
  slashAliases: ["customer", "stripe-customer"],
  handler: async ({ query }) => {
    try {
      const matches = await lookupCustomer(query);
      if (!matches.length) {
        return FALLBACK_TEXT(`No Stripe customer found for **${query}**.`);
      }
      const lines = matches.map((c) => {
        const flags: string[] = [];
        if (!c.livemode) flags.push("test");
        if (c.delinquent) flags.push("delinquent");
        const flagBits = flags.length ? ` _(${flags.join(", ")})_` : "";
        return `- \`${c.id}\` · **${c.name ?? c.email ?? "—"}** · ${c.email ?? "—"}${flagBits}`;
      });
      return FALLBACK_TEXT(
        `### Stripe customers matching "${query}"\n\n${lines.join("\n")}`,
      );
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "stripe_lookup_customer failed");
      return FALLBACK_TEXT(
        `Stripe customer lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

// ─── stripe_customer_invoices ────────────────────────────────────────────────
registerTool({
  name: "stripe_customer_invoices",
  description: "Recent invoices for a Stripe customer (by id). Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    customerId: z.string().regex(/^cus_[A-Za-z0-9]{4,}$/),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  artifactType: "text",
  handler: async ({ customerId, limit }) => {
    try {
      const invoices = await getCustomerInvoices(customerId, limit);
      if (!invoices.length) {
        return FALLBACK_TEXT(`No invoices found for ${customerId}.`);
      }
      const lines = invoices.map((inv) => {
        const date = new Date(inv.created * 1000).toISOString().split("T")[0];
        const amt = (inv.amount_paid / 100).toFixed(2);
        return `- **$${amt}** · ${inv.status ?? "—"} · ${date}${
          inv.hosted_invoice_url ? ` · [view](${inv.hosted_invoice_url})` : ""
        }`;
      });
      return FALLBACK_TEXT(`### Invoices for ${customerId}\n\n${lines.join("\n")}`);
    } catch (err) {
      return FALLBACK_TEXT(
        `Invoice lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

// ─── stripe_customer_subscriptions ───────────────────────────────────────────
registerTool({
  name: "stripe_customer_subscriptions",
  description: "Active subscriptions for a Stripe customer. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    customerId: z.string().regex(/^cus_[A-Za-z0-9]{4,}$/),
  }),
  artifactType: "text",
  handler: async ({ customerId }) => {
    try {
      const subs = await getActiveSubscriptions(customerId);
      if (!subs.length) {
        return FALLBACK_TEXT(`No active subscriptions for ${customerId}.`);
      }
      const lines = subs.map((s) => {
        const items = s.items.map((it) => `${it.nickname ?? it.price_id} × ${it.quantity}`).join(", ");
        const renews = new Date(s.current_period_end * 1000).toISOString().split("T")[0];
        const flag = s.cancel_at_period_end ? " · _cancels at period end_" : "";
        return `- \`${s.id}\` · **${s.status}** · ${items} · renews ${renews}${flag}`;
      });
      return FALLBACK_TEXT(`### Subscriptions for ${customerId}\n\n${lines.join("\n")}`);
    } catch (err) {
      return FALLBACK_TEXT(
        `Subscription lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

// ─── fly_secrets_list ────────────────────────────────────────────────────────
// CRITICAL: names only. Never values. The plan's secret-handling rule is
// non-negotiable — Atlas never sees secret values.
registerTool({
  name: "fly_secrets_list",
  description:
    "List the NAMES of secrets set on a Fly app. Never returns secret values — only names. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    app: z.string().optional(),
  }),
  artifactType: "text",
  slashAliases: ["secrets"],
  handler: async ({ app }) => {
    try {
      const secrets = await listSecretNames(app);
      if (!secrets.length) {
        return FALLBACK_TEXT("No secrets set (or the API returned an empty list).");
      }
      const lines = secrets
        .map((s) => `- \`${s.name}\`${s.created_at ? ` · set ${s.created_at}` : ""}`)
        .sort();
      return FALLBACK_TEXT(
        `### Secret names (${secrets.length})\n\n_Values are never returned — names only._\n\n${lines.join("\n")}`,
      );
    } catch (err) {
      if (err instanceof FlyClientError) {
        return FALLBACK_TEXT(`Fly secrets unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});
