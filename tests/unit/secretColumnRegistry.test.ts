/**
 * Every ciphertext / credential column in the schema is in the secret-column
 * registry (server/utils/secretColumns.ts) — or recorded here as reviewed.
 *
 * The response guard (server/middleware/secretColumnGuard.ts) removes only
 * what the registry names, so the registry is the guard's population. A new
 * ciphertext column that lands unregistered would be served by any handler
 * that sends whole rows. This test derives the expected set INDEPENDENTLY of
 * the registry, from the schema itself, through two lanes:
 *
 *   NAME lane    — every column of every pgTable whose SQL name matches a
 *                  secret-material pattern (encrypt, cipher, secret, password,
 *                  tin, tax_id, ein, ssn, *token, api_key, key hashes,
 *                  private_key, credential, hmac, routing/account numbers).
 *   COMMENT lane — every column whose schema declaration carries a comment
 *                  saying its value is ciphertext / encrypted / plaintext /
 *                  at rest. (`leads.tax_id` is documented as ciphertext only
 *                  in its comment; this lane is how that kind of column is
 *                  found.) Comments are the signal here, so they are read on
 *                  purpose rather than stripped.
 *
 * Each flagged column must be registered or carry a reviewed reason below.
 * Canaries prove each pattern and the comment lane fire; floors prove the
 * population was read.
 *
 * idempotent: true — Drizzle metadata plus source reads, no DB.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig, pgTable, text, integer, serial } from "drizzle-orm/pg-core";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { stripComments } from "../helpers/stripComments";
import { SECRET_COLUMNS } from "../../server/utils/secretColumns";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

// ── Population: every schema source file ────────────────────────────────────

/** The barrel plus every module beside it (two are imported by direct path, not through the barrel). */
const SCHEMA_FILES = [
  "shared/schema.ts",
  ...fs
    .readdirSync(path.join(ROOT, "shared/schema"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `shared/schema/${f}`),
  ...fs
    .readdirSync(path.join(ROOT, "shared/models"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => `shared/models/${f}`),
];

interface Col {
  table: string;
  key: string;
  column: string;
}

async function loadTables(): Promise<Map<string, Col[]>> {
  const tables = new Map<string, Col[]>();
  for (const file of SCHEMA_FILES) {
    const mod = (await import(path.join(ROOT, file))) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      let name: string;
      try {
        name = getTableConfig(value as never).name;
      } catch {
        continue; // not a pgTable
      }
      if (!name || tables.has(name)) continue;
      const cols = getTableColumns(value as never) as Record<string, { name: string }>;
      tables.set(
        name,
        Object.entries(cols).map(([key, c]) => ({ table: name, key, column: c.name })),
      );
    }
  }
  return tables;
}

// ── The predicates ──────────────────────────────────────────────────────────

/** Secret-material shapes of an SQL column name. */
const NAME_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "encrypt", re: /encrypt/ },
  { id: "cipher", re: /cipher/ },
  { id: "secret", re: /secret/ },
  { id: "password", re: /password/ },
  { id: "tin", re: /(^|_)tin(_|$)/ },
  { id: "tax_id", re: /(^|_)tax_id/ },
  { id: "ein", re: /(^|_)ein(_|$)/ },
  { id: "ssn", re: /(^|_)ssn(_|$)/ },
  { id: "token", re: /(^|_)token(_hash)?$/ },
  { id: "api_key", re: /(^|_)api_key(_hash)?$/ },
  { id: "key_hash", re: /(^|_)(key_hash|hashed_key)$/ },
  { id: "private_key", re: /private_key/ },
  { id: "credential", re: /credential/ },
  { id: "hmac", re: /hmac/ },
  { id: "routing_number", re: /routing_number/ },
  { id: "account_number", re: /account_number/ },
];

/** A comment that describes the column's VALUE as ciphertext / credential material at rest. */
const COMMENT_PATTERN = /\bcipher(text)?\b|\bencrypted\b|\bencryption\b|\bplaintext\b|\bat rest\b/i;

/**
 * Flagged columns that are not secret material, with the reason. Keyed
 * `table.sql_column`. A reviewed entry that stops being flagged fails the
 * stale-entry check, so this list cannot outlive the columns it covers.
 */
const REVIEWED_NOT_SECRET: Record<string, string> = {
  "organizations.tax_id_type": "EIN/SSN/ITIN label; served by GET /api/organization/tax-identity and read by settings/tax-identity",
  "contractors.tax_id_type": "ein/ssn label; read by pages/contractors",
  "acquired_notes.payer_tin_type": "SSN/EIN/ITIN label; read by pages/note-detail (W-9 on-file indicator)",
  "platform_config.is_secret": "boolean flag",
  "founder_documents.encryption_kid": "key identifier, not key material",
  "founder_income_sources.encryption_kid": "key identifier, not key material",
  "founder_tax_returns.encryption_kid": "key identifier, not key material",
  "founder_estimated_payments.encryption_kid": "key identifier, not key material",
  "byok_credentials.credential_key_fingerprint": "fingerprint for display; not reversible to the key",
  "integration_credentials.credential_type": "category label",
  "organization_integrations.credentials":
    "handlers serve a masked projection under this key that integrations-settings reads (credentials.maskedKey); a stored enc:v1 envelope inside it is removed by the guard's envelope lane",
  "users.password_reset_expires_at": "timestamp",
  "title_orders.wire_instructions_hmac": "integrity MAC over the issued instructions, not a key",
  "chart_of_accounts.account_number": "general-ledger account code (e.g. 1000), not a bank account",
  "shared_deal_links.token": "the share token is the link the owner copies; served to the owner by design",
  "email_sender_identities.verification_token": "DNS TXT value the customer publishes; public by design",
  "solene_agent_identity_decisions.session_token": "dispatch-run correlation id, not a credential",
  "solene_capital_events.session_token": "dispatch-run correlation id, not a credential",
  // Flagged by the comment lane only — the comment mentions encryption but
  // describes another column or the absence of one:
  "organization_invitations.invite_token_last4": "last 4 characters only; the comment explains the plaintext is never stored",
  "platform_connections.value_plain": "documented as the value for NON-secret fields; secret fields use secret_encrypted",
  "api_keys.prefix": "display prefix/last 4; the full key is stored only as hashed_key",
  "founder_tax_profile.has_spouse": "boolean; the comment points at founder_documents.encrypted_blob, which is registered",
  "acquired_notes.borrower_id": "foreign key to leads; the comment points at leads.tax_id, which is registered",
  "tenants.date_of_birth": "the comment above it names a tax-id column the table does not have; this column is a date",
};

function flagByName(c: Col): string[] {
  return NAME_PATTERNS.filter((p) => p.re.test(c.column)).map((p) => p.id);
}

/**
 * COMMENT lane over raw source: for each column declaration line, its trailing
 * `//` comment and the comment block directly above it. Attributed to the
 * nearest preceding `pgTable("name"`.
 */
function flagByDocumentation(source: string): Array<{ table: string; column: string; comment: string }> {
  const out: Array<{ table: string; column: string; comment: string }> = [];
  const lines = source.split("\n");
  let table: string | null = null;
  let pending: string[] = [];
  const TABLE_OPEN = /pgTable\(\s*"([a-z0-9_]+)"/;
  let carryTable = false;
  for (const line of lines) {
    const t = TABLE_OPEN.exec(line);
    if (t) table = t[1]!;
    else if (/pgTable\(\s*$/.test(line)) carryTable = true;
    else if (carryTable) {
      const m = /^\s*"([a-z0-9_]+)"/.exec(line);
      if (m) table = m[1]!;
      carryTable = false;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      pending.push(trimmed);
      continue;
    }
    const decl = /^\s*\w+:\s*[a-zA-Z]+(?:<[^>]*>)?\(\s*"([a-z0-9_]+)"/.exec(line);
    if (decl && table) {
      const trailing = line.includes("//") ? line.slice(line.indexOf("//")) : "";
      const comment = [...pending, trailing].join(" ");
      if (COMMENT_PATTERN.test(comment)) out.push({ table, column: decl[1]!, comment });
    }
    pending = [];
  }
  return out;
}

// ── The census ──────────────────────────────────────────────────────────────

const registered = new Set(SECRET_COLUMNS.map((e) => `${e.table}.${e.column}`));

describe("secret-column registry covers the schema", () => {
  it("reads a real population (vacuity floors)", async () => {
    const tables = await loadTables();
    // 725 tables measured 2026-10-06 (722 through the barrel + 3 in the two direct-import modules).
    expect(tables.size).toBeGreaterThanOrEqual(700);
    expect(SCHEMA_FILES.length).toBeGreaterThanOrEqual(95);
    expect(tables.has("ach_mandates"), "direct-import module read").toBe(true);
    expect(SECRET_COLUMNS.length).toBeGreaterThanOrEqual(40);
  });

  it("every pgTable in the repo is defined in a file this census reads", () => {
    const population = new Set(SCHEMA_FILES);
    const strays: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${ent.name}`;
        if (ent.isDirectory()) {
          if (ent.name === "node_modules") continue;
          walk(rel);
        } else if (/\.tsx?$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) {
          const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
          if (/\bpgTable\s*\(/.test(src) && !population.has(rel)) strays.push(rel);
        }
      }
    };
    for (const dir of ["shared", "server"]) walk(dir);
    // shared/forms/* mention pgTable only in comments (stripped above).
    expect(strays).toEqual([]);
  });

  it("every secret-shaped column (by name) is registered or reviewed", async () => {
    const tables = await loadTables();
    const missing: string[] = [];
    let flagged = 0;
    for (const cols of tables.values()) {
      for (const c of cols) {
        const hits = flagByName(c);
        if (hits.length === 0) continue;
        flagged += 1;
        const id = `${c.table}.${c.column}`;
        if (!registered.has(id) && !(id in REVIEWED_NOT_SECRET)) missing.push(`${id}  [${hits.join(",")}]`);
      }
    }
    // 58 measured 2026-10-06.
    expect(flagged, "name lane flagged too few — predicate stopped matching").toBeGreaterThanOrEqual(55);
    expect(
      missing,
      "Register these in server/utils/secretColumns.ts (or record a reviewed reason in this test):\n  " +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("every column documented as ciphertext / encrypted is registered or reviewed", () => {
    const missing: string[] = [];
    const found = new Set<string>();
    for (const file of SCHEMA_FILES) {
      for (const hit of flagByDocumentation(fs.readFileSync(path.join(ROOT, file), "utf8"))) {
        const id = `${hit.table}.${hit.column}`;
        found.add(id);
        if (!registered.has(id) && !(id in REVIEWED_NOT_SECRET)) missing.push(`${id}  (${file}: ${hit.comment.slice(0, 80)})`);
      }
    }
    // Per-member vacuity: the lane must still see the columns it exists for.
    for (const known of ["leads.tax_id", "organizations.ein", "contractors.tax_id_encrypted", "platform_config.encrypted_value"]) {
      expect(found.has(known), `comment lane no longer sees ${known}`).toBe(true);
    }
    expect(missing, "Columns documented as ciphertext but not registered:\n  " + missing.join("\n  ")).toEqual([]);
  });

  it("registry and reviewed entries name real columns, and reviewed entries are still flagged", async () => {
    const tables = await loadTables();
    const all = new Map<string, Col>();
    for (const cols of tables.values()) for (const c of cols) all.set(`${c.table}.${c.column}`, c);
    for (const e of SECRET_COLUMNS) {
      const c = all.get(`${e.table}.${e.column}`);
      expect(c, `${e.table}.${e.column}`).toBeDefined();
      expect(c!.key, `${e.table}.${e.column} key`).toBe(e.key);
    }
    const commentFlagged = new Set<string>();
    for (const file of SCHEMA_FILES) {
      for (const hit of flagByDocumentation(fs.readFileSync(path.join(ROOT, file), "utf8"))) commentFlagged.add(`${hit.table}.${hit.column}`);
    }
    const stale: string[] = [];
    for (const id of Object.keys(REVIEWED_NOT_SECRET)) {
      const c = all.get(id);
      if (!c) stale.push(`${id} (no such column)`);
      else if (flagByName(c).length === 0 && !commentFlagged.has(id)) stale.push(`${id} (no longer flagged)`);
      if (registered.has(id)) stale.push(`${id} (both registered and reviewed)`);
    }
    expect(stale).toEqual([]);
  });
});

// ── Canaries: the predicates fire on a column they have never seen ──────────

describe("canaries", () => {
  const canary = pgTable("canary_vault", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id"),
    payoutEncrypted: text("payout_encrypted"),
    payoutCiphertext: text("payout_ciphertext"),
    webhookSecret: text("webhook_secret"),
    portalPassword: text("portal_password"),
    recipientTin: text("recipient_tin"),
    vendorTaxId: text("vendor_tax_id"),
    payerEin: text("payer_ein"),
    ownerSsn: text("owner_ssn"),
    refreshToken: text("refresh_token"),
    partnerApiKey: text("partner_api_key"),
    keyHash: text("key_hash"),
    signingPrivateKey: text("signing_private_key"),
    vendorCredentials: text("vendor_credentials"),
    hmacKey: text("hmac_key"),
    routingNumber: text("routing_number"),
    bankAccountNumber: text("bank_account_number"),
    label: text("label"),
  });
  const cols = Object.entries(getTableColumns(canary) as Record<string, { name: string }>).map(
    ([key, c]) => ({ table: "canary_vault", key, column: c.name }),
  );

  it("each name pattern catches its canary column, and none flags a plain column", () => {
    for (const p of NAME_PATTERNS) {
      expect(cols.some((c) => p.re.test(c.column)), `pattern ${p.id} has no canary`).toBe(true);
    }
    const flagged = cols.filter((c) => flagByName(c).length > 0).map((c) => c.column);
    expect(flagged).toHaveLength(cols.length - 3); // id, organization_id, label are not secret-shaped
    expect(flagged).not.toContain("label");
    for (const c of cols) {
      if (flagByName(c).length > 0) expect(registered.has(`${c.table}.${c.column}`)).toBe(false);
    }
  });

  it("the comment lane catches a column documented as ciphertext, in both table-opening shapes", () => {
    const src = [
      'export const vaultA = pgTable("canary_a", {',
      "  id: serial(\"id\").primaryKey(),",
      '  payout: text("payout"), // ciphertext of the payout account',
      "});",
      "export const vaultB = pgTable(",
      '  "canary_b",',
      "  {",
      "    // stored encrypted at rest",
      '    blob: text("blob"),',
      '    label: text("label"), // a label',
      "  },",
      ");",
    ].join("\n");
    const hits = flagByDocumentation(src).map((h) => `${h.table}.${h.column}`);
    expect(hits).toEqual(["canary_a.payout", "canary_b.blob"]);
  });
});
