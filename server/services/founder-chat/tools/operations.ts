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
import {
  blameLine,
  getCheckRuns,
  getCommitDiff,
  GithubClientError,
  listCommits,
  readFile as ghReadFile,
  searchCode,
} from "../providers/github";
import { registerTool } from "../tool-registry";
import { logger } from "../../../utils/logger";

const READ_FILE_MAX_BYTES = 4096;

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

// ─── repo_search ─────────────────────────────────────────────────────────────
registerTool({
  name: "repo_search",
  description:
    "Search the AcreOS repo for code matching a query. Optional fileGlob narrows results by path (e.g. '*.ts'). Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    query: z.string().min(2).describe("Search query string"),
    fileGlob: z.string().optional().describe("Optional path glob (e.g. '*.ts')"),
  }),
  artifactType: "text",
  slashAliases: ["grep", "repo-search"],
  handler: async ({ query, fileGlob }) => {
    try {
      const result = await searchCode(query, fileGlob);
      if (!result.total_count || !result.items.length) {
        return FALLBACK_TEXT(`No matches for **${query}**${fileGlob ? ` in \`${fileGlob}\`` : ""}.`);
      }
      const lines = result.items.slice(0, 20).map((it) => `- \`${it.path}\``);
      const head = `### ${result.total_count} match${result.total_count === 1 ? "" : "es"} for "${query}"${fileGlob ? ` in \`${fileGlob}\`` : ""}`;
      return FALLBACK_TEXT(`${head}\n\n${lines.join("\n")}`);
    } catch (err) {
      if (err instanceof GithubClientError) {
        logger.warn("repo_search failed", { metadata: { status: err.status } });
        return FALLBACK_TEXT(`GitHub search unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── read_file ───────────────────────────────────────────────────────────────
registerTool({
  name: "read_file",
  description:
    "Read a file from the AcreOS repo at an optional ref (branch/tag/sha). Output capped at 4 KB. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    path: z.string().min(1).describe("Repo-relative path to the file"),
    ref: z.string().optional().describe("Optional branch, tag, or commit sha"),
  }),
  artifactType: "text",
  slashAliases: ["cat", "read-file"],
  handler: async ({ path, ref }) => {
    try {
      const file = await ghReadFile(path, ref);
      const raw = file.encoding === "base64"
        ? Buffer.from(file.content, "base64").toString("utf8")
        : file.content;
      const truncated = raw.length > READ_FILE_MAX_BYTES;
      const body = truncated ? raw.slice(0, READ_FILE_MAX_BYTES) : raw;
      const note = truncated
        ? `\n\n_…truncated. File is ${file.size} bytes; showing first ${READ_FILE_MAX_BYTES}._`
        : "";
      const head = `### \`${file.path}\`${ref ? ` @ ${ref}` : ""}`;
      return FALLBACK_TEXT(`${head}\n\n\`\`\`\n${body}\n\`\`\`${note}`);
    } catch (err) {
      if (err instanceof GithubClientError) {
        logger.warn("read_file failed", { metadata: { status: err.status, path } });
        return FALLBACK_TEXT(`GitHub read_file unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── git_log ─────────────────────────────────────────────────────────────────
registerTool({
  name: "git_log",
  description: "List recent commits on a branch (default main, limit 20). Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    branch: z.string().optional().default("main"),
    limit: z.number().int().min(1).max(100).optional().default(20),
  }),
  artifactType: "text",
  slashAliases: ["log"],
  handler: async ({ branch, limit }) => {
    try {
      const commits = await listCommits(branch ?? "main", limit ?? 20);
      if (!commits.length) {
        return FALLBACK_TEXT(`No commits found on \`${branch ?? "main"}\`.`);
      }
      const lines = commits.map((c) => {
        const short = c.sha.slice(0, 7);
        const subject = c.commit.message.split("\n")[0];
        const who = c.author?.login ?? c.commit.author?.name ?? "—";
        const when = c.commit.author?.date ?? "";
        return `- \`${short}\` · ${subject} · ${who}${when ? ` · ${when.slice(0, 10)}` : ""}`;
      });
      return FALLBACK_TEXT(`### Recent commits on \`${branch ?? "main"}\`\n\n${lines.join("\n")}`);
    } catch (err) {
      if (err instanceof GithubClientError) {
        return FALLBACK_TEXT(`GitHub git_log unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── git_diff ────────────────────────────────────────────────────────────────
registerTool({
  name: "git_diff",
  description: "Show the unified diff for a commit by sha. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    sha: z.string().min(4).describe("Commit sha (full or short)"),
  }),
  artifactType: "text",
  slashAliases: ["diff"],
  handler: async ({ sha }) => {
    try {
      const diff = await getCommitDiff(sha);
      const head = `### Commit \`${diff.sha.slice(0, 7)}\`\n\n> ${diff.commit.message.split("\n")[0]}`;
      if (!diff.files.length) {
        return FALLBACK_TEXT(`${head}\n\n_No file changes recorded._`);
      }
      const fileBlocks = diff.files.map((f) => {
        const header = `**${f.filename}** · ${f.status} · +${f.additions} / -${f.deletions}`;
        if (!f.patch) return header;
        return `${header}\n\n\`\`\`diff\n${f.patch}\n\`\`\``;
      });
      return FALLBACK_TEXT(`${head}\n\n${fileBlocks.join("\n\n")}`);
    } catch (err) {
      if (err instanceof GithubClientError) {
        return FALLBACK_TEXT(`GitHub git_diff unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── git_blame ───────────────────────────────────────────────────────────────
registerTool({
  name: "git_blame",
  description:
    "Approximate blame for a file/line via the most recent commit that touched the file. True line-level blame requires GraphQL — this is the REST proxy. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    path: z.string().min(1),
    line: z.number().int().min(1),
  }),
  artifactType: "text",
  slashAliases: ["blame"],
  handler: async ({ path, line }) => {
    try {
      const commit = await blameLine(path, line);
      if (!commit) {
        return FALLBACK_TEXT(`No commit history found for \`${path}\`.`);
      }
      const short = commit.sha.slice(0, 7);
      const subject = commit.commit.message.split("\n")[0];
      const who = commit.author?.login ?? commit.commit.author?.name ?? "—";
      const when = commit.commit.author?.date ?? "";
      return FALLBACK_TEXT(
        `### Most-recent commit touching \`${path}\` (line ${line})\n\n` +
          `- \`${short}\` · ${subject}\n` +
          `- author: ${who}${when ? ` · ${when.slice(0, 10)}` : ""}\n\n` +
          `_Note: true per-line blame requires the GitHub GraphQL API; this is the REST proxy._`,
      );
    } catch (err) {
      if (err instanceof GithubClientError) {
        return FALLBACK_TEXT(`GitHub git_blame unavailable (${err.status}). ${err.message}`);
      }
      throw err;
    }
  },
});

// ─── view_ci_status ──────────────────────────────────────────────────────────
registerTool({
  name: "view_ci_status",
  description: "Show GitHub check-run status for a ref (default: main HEAD). Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    ref: z.string().optional().describe("sha, branch, or tag (default: main)"),
  }),
  artifactType: "text",
  slashAliases: ["ci"],
  handler: async ({ ref }) => {
    try {
      const target = ref ?? "main";
      const data = await getCheckRuns(target);
      if (!data.total_count || !data.check_runs.length) {
        return FALLBACK_TEXT(`No check runs found for \`${target}\`.`);
      }
      const lines = data.check_runs.map((c) => {
        const conclusion = c.conclusion ?? c.status;
        const icon = c.conclusion === "success"
          ? "✓"
          : c.conclusion === "failure" || c.conclusion === "timed_out" || c.conclusion === "action_required"
            ? "✗"
            : c.conclusion === "neutral" || c.conclusion === "skipped" || c.conclusion === "cancelled"
              ? "○"
              : "…";
        return `- ${icon} **${c.name}** · ${c.status}${c.conclusion ? ` → ${conclusion}` : ""}`;
      });
      return FALLBACK_TEXT(`### CI status for \`${target}\` (${data.total_count})\n\n${lines.join("\n")}`);
    } catch (err) {
      if (err instanceof GithubClientError) {
        return FALLBACK_TEXT(`GitHub view_ci_status unavailable (${err.status}). ${err.message}`);
      }
      throw err;
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

// ─── Phase I batch 1 — DB + Sentry read-only operational tools ───────────────
// Appended at the end of the file so concurrent Phase H GitHub additions
// upstream can auto-merge.

import {
  DbOpsError,
  getRecentRows,
  getTableList,
  getTableSchema,
  parseSqlSafety,
  runReadOnlyQuery,
  type DbQueryResult,
} from "../providers/db-ops";
import {
  SentryClientError,
  getLatestEventForIssue,
  listRecentIssues,
} from "../providers/sentry-ops";

/** Render a small markdown table from rows. Cap at 50 rendered rows. */
function renderRowsAsMarkdownTable(result: DbQueryResult): string {
  if (result.rows.length === 0) {
    return "_(no rows)_";
  }
  const RENDER_CAP = 50;
  const displayed = result.rows.slice(0, RENDER_CAP);
  const headers = Array.from(
    displayed.reduce((acc, r) => {
      Object.keys(r).forEach((k) => acc.add(k));
      return acc;
    }, new Set<string>()),
  );

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") return JSON.stringify(v).slice(0, 80);
    const s = String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  };

  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = displayed
    .map((r) => `| ${headers.map((h) => escape(r[h])).join(" | ")} |`)
    .join("\n");

  let footer = "";
  if (result.rows.length > RENDER_CAP) {
    footer = `\n\n_Rendered ${RENDER_CAP} of ${result.rows.length} rows._`;
  }
  if (result.truncated) {
    footer += `\n\n_Query was capped at 1000 rows by the read-only gateway._`;
  }
  return `${head}\n${sep}\n${body}${footer}`;
}

// ─── db_query ───────────────────────────────────────────────────────────────
registerTool({
  name: "db_query",
  description:
    "Run a read-only SQL query (SELECT/EXPLAIN/SHOW only) against the database. Rejects INSERT/UPDATE/DELETE/DROP/etc. Capped at 1000 rows; renders the first 50.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    sql: z.string().min(1).describe("Read-only SQL — SELECT, EXPLAIN, or SHOW"),
  }),
  artifactType: "text",
  slashAliases: ["query", "sql"],
  handler: async ({ sql: rawSql }) => {
    const safety = parseSqlSafety(rawSql);
    if (!safety.isReadOnly) {
      return FALLBACK_TEXT(
        `**Refused — SQL is not read-only.**\n\n> ${safety.reason}\n\nThe read-only gateway only runs SELECT / EXPLAIN / SHOW. Destructive operations land in Phase I batch 2 behind a confirmation flow.`,
      );
    }
    try {
      const result = await runReadOnlyQuery(rawSql);
      const table = renderRowsAsMarkdownTable(result);
      return FALLBACK_TEXT(
        `### Query result (${result.rows.length} row${result.rows.length === 1 ? "" : "s"})\n\n${table}`,
      );
    } catch (err) {
      if (err instanceof DbOpsError) {
        return FALLBACK_TEXT(`Query failed (${err.kind}): ${err.message}`);
      }
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "db_query unexpected error",
      );
      return FALLBACK_TEXT(
        `Query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

// ─── db_list_tables ─────────────────────────────────────────────────────────
registerTool({
  name: "db_list_tables",
  description: "List every table in the public schema. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({}),
  artifactType: "text",
  slashAliases: ["tables"],
  handler: async () => {
    try {
      const tables = await getTableList();
      if (!tables.length) {
        return FALLBACK_TEXT("No tables found in the public schema.");
      }
      const lines = tables.map((t) => `- \`${t}\``);
      return FALLBACK_TEXT(
        `### Public-schema tables (${tables.length})\n\n${lines.join("\n")}`,
      );
    } catch (err) {
      if (err instanceof DbOpsError) {
        return FALLBACK_TEXT(`db_list_tables failed (${err.kind}): ${err.message}`);
      }
      return FALLBACK_TEXT(
        `db_list_tables failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

// ─── db_table_schema ────────────────────────────────────────────────────────
registerTool({
  name: "db_table_schema",
  description:
    "List the columns of a public-schema table with data types and nullability. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    tableName: z.string().min(1).describe("Public-schema table name"),
  }),
  artifactType: "text",
  slashAliases: ["schema", "describe"],
  handler: async ({ tableName }) => {
    try {
      const cols = await getTableSchema(tableName);
      if (!cols.length) {
        return FALLBACK_TEXT(
          `Table \`${tableName}\` not found in the public schema (or has no columns).`,
        );
      }
      const lines = cols.map(
        (c) =>
          `- \`${c.column_name}\` — ${c.data_type}${c.is_nullable === "NO" ? " · NOT NULL" : ""}`,
      );
      return FALLBACK_TEXT(
        `### \`${tableName}\` columns (${cols.length})\n\n${lines.join("\n")}`,
      );
    } catch (err) {
      if (err instanceof DbOpsError) {
        return FALLBACK_TEXT(`db_table_schema failed (${err.kind}): ${err.message}`);
      }
      return FALLBACK_TEXT(
        `db_table_schema failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

// ─── db_recent_rows ─────────────────────────────────────────────────────────
registerTool({
  name: "db_recent_rows",
  description:
    "Last N rows of a public-schema table, ordered by id (or primary key) DESC. Table name is validated against information_schema to prevent injection. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    tableName: z.string().min(1),
    limit: z.number().int().min(1).max(1000).default(10),
  }),
  artifactType: "text",
  slashAliases: ["recent"],
  handler: async ({ tableName, limit }) => {
    try {
      const result = await getRecentRows(tableName, limit);
      const table = renderRowsAsMarkdownTable(result);
      return FALLBACK_TEXT(
        `### Recent rows from \`${tableName}\` (${result.rows.length})\n\n${table}`,
      );
    } catch (err) {
      if (err instanceof DbOpsError) {
        return FALLBACK_TEXT(`db_recent_rows failed (${err.kind}): ${err.message}`);
      }
      return FALLBACK_TEXT(
        `db_recent_rows failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

// ─── sentry_recent_issues ───────────────────────────────────────────────────
registerTool({
  name: "sentry_recent_issues",
  description:
    "List unresolved Sentry issues over a time window (default 24h). Optional severity filter (fatal/error/warning/info/debug). Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    since: z
      .string()
      .regex(/^\d+[hdwm]$/i)
      .optional()
      .describe("Stats period, e.g. '24h', '7d'. Defaults to 24h."),
    severity: z
      .enum(["fatal", "error", "warning", "info", "debug"])
      .optional(),
  }),
  artifactType: "text",
  slashAliases: ["errors", "sentry"],
  handler: async ({ since, severity }) => {
    try {
      const issues = await listRecentIssues(since ?? "24h", severity);
      if (!issues.length) {
        return FALLBACK_TEXT(
          `No unresolved Sentry issues in the last ${since ?? "24h"}${severity ? ` at level ${severity}` : ""}.`,
        );
      }
      const lines = issues.map((i) => {
        const lvl = i.level ? ` · **${i.level}**` : "";
        const count = i.count !== undefined ? ` · ${i.count} events` : "";
        const users = i.userCount !== undefined ? ` · ${i.userCount} users` : "";
        const lastSeen = i.lastSeen
          ? ` · ${Math.round((Date.now() - new Date(i.lastSeen).getTime()) / 60_000)}m ago`
          : "";
        return `- \`${i.shortId ?? i.id}\` · ${i.title}${lvl}${count}${users}${lastSeen}`;
      });
      return FALLBACK_TEXT(
        `### Recent Sentry issues (${issues.length})\n\n${lines.join("\n")}`,
      );
    } catch (err) {
      if (err instanceof SentryClientError) {
        return FALLBACK_TEXT(`Sentry unavailable (${err.status}). ${err.message}`);
      }
      return FALLBACK_TEXT(
        `Sentry lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

// ─── sentry_event ───────────────────────────────────────────────────────────
registerTool({
  name: "sentry_event",
  description:
    "Show the latest event for a Sentry issue — stack-trace summary, tags, first/last seen. Read-only.",
  category: "inquiry",
  destructive: false,
  tier: 1,
  schema: z.object({
    issueId: z.string().min(1).describe("Sentry issue id (numeric or shortId)"),
  }),
  artifactType: "text",
  slashAliases: ["error"],
  handler: async ({ issueId }) => {
    try {
      const event = await getLatestEventForIssue(issueId);
      const exceptionEntry = event.entries?.find((e) => e.type === "exception");
      const exc = exceptionEntry?.data?.values?.[0];
      const frames = exc?.stacktrace?.frames ?? [];
      // Show the deepest 5 in-app frames (Sentry orders oldest → newest).
      const interesting = frames
        .filter((f) => f.in_app !== false)
        .slice(-5)
        .reverse();
      const stackLines = interesting.length
        ? interesting.map((f) => {
            const loc =
              f.filename && f.lineno
                ? `${f.filename}:${f.lineno}`
                : f.filename ?? "—";
            return `- \`${f.function ?? "<anonymous>"}\` · ${loc}`;
          })
        : ["- _(no in-app frames in this event)_"];
      const tagLines = (event.tags ?? [])
        .slice(0, 8)
        .map((t) => `\`${t.key}=${t.value}\``)
        .join(" · ");
      const title = exc?.type
        ? `${exc.type}: ${exc.value ?? event.title ?? "(no message)"}`
        : event.title ?? event.message ?? "(no title)";
      const dateLine = event.dateCreated
        ? `\n_Captured ${event.dateCreated}_\n`
        : "";
      return FALLBACK_TEXT(
        `### Sentry event ${event.eventID ?? event.id ?? "(latest)"}\n\n**${title}**${dateLine}\n${tagLines ? `\n${tagLines}\n` : ""}\n#### Stack (deepest 5 in-app frames)\n\n${stackLines.join("\n")}`,
      );
    } catch (err) {
      if (err instanceof SentryClientError) {
        return FALLBACK_TEXT(`Sentry unavailable (${err.status}). ${err.message}`);
      }
      return FALLBACK_TEXT(
        `Sentry event lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});
