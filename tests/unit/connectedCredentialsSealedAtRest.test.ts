/**
 * Connected-account credentials are encrypted at rest — every write path.
 *
 * Verified 2026-10-09: POST /api/integrations/:provider and the settings
 * API-key save seal through sealIntegrationCredentials; webhook signing
 * secrets are field-encrypted; BYOK keys live in the key vault; connected
 * mailboxes store no tokens (Clerk holds them). One path did not:
 * smsService.saveTwilioCredentials (POST /api/settings/twilio) wrote the
 * Twilio auth token into organization_integrations.credentials in the clear.
 *
 * Behavioural: the Twilio save writes an envelope with no plaintext token,
 * and the two readers (configuration check, the Twilio adapter) read it back.
 * Population: every write of organization_integrations.credentials in
 * server/ is a sealIntegrationCredentials(...) call or a named, non-secret
 * config writer.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";

const H = vi.hoisted(() => ({ writes: [] as any[], row: null as any }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const c: any = { from: () => c, where: () => c, limit: async () => (H.row ? [H.row] : []) };
  return {
    db: {
      select: () => c,
      insert: () => ({ values: async (v: any) => { H.writes.push(v); H.row = { ...v, id: 1 }; } }),
      update: () => ({ set: (v: any) => ({ where: async () => { H.writes.push(v); H.row = { ...H.row, ...v }; } }) }),
    },
  };
});

describe("the Twilio save seals; its readers unseal", () => {
  it("no plaintext token at rest, and the configuration check still reads it", async () => {
    process.env.ENCRYPTION_KEY ||= "0".repeat(64);
    process.env.FIELD_ENCRYPTION_KEY ||= "0".repeat(64);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({}) })) as any;
    try {
      const sms = await import("../../server/services/smsService");
      const token = "a".repeat(32);
      const r = await sms.saveTwilioCredentials(7, "AC" + "1".repeat(32), token, "+15125550100");
      expect(r.success).toBe(true);
      const written = JSON.stringify(H.writes.at(-1).credentials);
      expect(written).not.toContain(token);
      expect(Object.keys(H.writes.at(-1).credentials)).toEqual(["encrypted"]);
      const { readIntegrationCredentials } = await import("../../server/services/integrationCredentials");
      expect(readIntegrationCredentials(H.row, 7)).toEqual(expect.objectContaining({ authToken: token }));
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("population: every credentials write is sealed or named non-secret config", () => {
  const ROOT = path.resolve(__dirname, "../..");
  /** Writers whose `credentials` holds configuration, not a secret (reviewed 2026-10-09). */
  const NON_SECRET_CONFIG: Record<string, string> = {
    "server/services/commissionService.ts": "commission plan config",
    "server/services/territoryService.ts": "territory definitions",
    "server/services/dealHandoffService.ts": "deal handoff records",
    "server/jobs/indexAnalyzer.ts": "index-analyzer findings",
    "server/services/stripeConnect.ts": "the connected account id (acct_…) — an identifier, not a secret; no customer key is stored",
    "server/services/webhookDispatcher.ts": "webhook endpoints; each signing secret is field-encrypted (encrypt()) before it is stored",
  };

  function credentialWrites(file: string, text: string): Array<{ line: number; expr: string }> {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const out: Array<{ line: number; expr: string }> = [];
    const visit = (n: ts.Node) => {
      // x.insert(organizationIntegrations).values({...}) / x.update(organizationIntegrations).set({...}) / upsertOrganizationIntegration({...})
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const recv = n.expression.expression;
        const onTable = ts.isCallExpression(recv) && recv.arguments.some((a) => a.getText(sf) === "organizationIntegrations");
        const isUpsert = method === "upsertOrganizationIntegration";
        if ((onTable && (method === "values" || method === "set")) || isUpsert) {
          const arg = n.arguments[0];
          if (arg && ts.isObjectLiteralExpression(arg)) {
            for (const p of arg.properties) {
              if (ts.isPropertyAssignment(p) && p.name.getText(sf) === "credentials") out.push({ line: sf.getLineAndCharacterOfPosition(p.getStart()).line + 1, expr: p.initializer.getText(sf) });
              if (ts.isShorthandPropertyAssignment(p) && p.name.text === "credentials") out.push({ line: sf.getLineAndCharacterOfPosition(p.getStart()).line + 1, expr: "credentials" });
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  /** A shorthand `credentials` is sealed when its declaration's initializer is a seal call. */
  function sealedDecl(text: string): boolean {
    return /const credentials\s*=\s*sealIntegrationCredentials\(/.test(text);
  }

  it("canary: an unsealed literal write is seen", () => {
    expect(credentialWrites("f.ts", "await db.insert(organizationIntegrations).values({ organizationId, credentials: { authToken } });")).toHaveLength(1);
  });

  it("holds over server/", () => {
    const files = execSync("git ls-files server", { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const offenders: string[] = [];
    let writes = 0;
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      if (!text.includes("organizationIntegrations") && !text.includes("upsertOrganizationIntegration")) continue;
      for (const w of credentialWrites(f, text)) {
        writes++;
        if (/^sealIntegrationCredentials\(/.test(w.expr)) continue;
        if (w.expr === "credentials" && sealedDecl(text)) continue;
        if (f in NON_SECRET_CONFIG) continue;
        // storage passthrough: the repo writes whatever its callers built (they are checked here).
        if (f === "server/storage/integrationsRepo.ts") continue;
        offenders.push(`${f}:${w.line} credentials: ${w.expr.slice(0, 80)}`);
      }
    }
    expect(writes).toBeGreaterThanOrEqual(10);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
