/**
 * An org's provider credentials are stored in TWO shapes and were read in two
 * shapes, by different halves of the codebase. That is not a style
 * inconsistency — it is simultaneously a security defect, a correctness defect
 * and a billing defect, and it has all three because nothing related the
 * writers to the readers.
 *
 * THE TWO WRITERS
 *   POST /api/integrations/:provider  →  { encrypted: "<envelope>" }
 *   POST /api/settings/save-api-key   →  { apiKey: "sk_live_..." }   IN THE CLEAR
 *
 * The second is the route behind the BYOK panel in Settings — the one a
 * customer actually uses. Nothing in the client calls the first.
 *
 * THE READERS, SPLIT DOWN THE MIDDLE
 *   `.encrypted` only:  comps.ts · directMail.ts · directMailService.ts ·
 *                       emailService.ts · resolveProviderCredential.ts ·
 *                       routes-properties.ts · financeAgent.ts · seven
 *                       test/validate routes in routes-integrations.ts
 *   `.apiKey` only:     mailProvider.ts · parcel.ts · the BYOK status route
 *
 * So a key set through the panel was invisible to almost everything:
 *
 *   - comps and directMail did not find it, so the org's lookups and mail ran
 *     on the PLATFORM's key — AcreOS paying a vendor bill for a customer who
 *     had supplied their own account.
 *   - routes-properties decided whether to charge credits with
 *     `credentials?.encrypted`, so that same customer was ALSO billed ten cents
 *     a comps query for lookups their own key was meant to cover. Charged for a
 *     key they gave us and we then ignored — the two halves of one wrong answer.
 *   - `hasConnectedSendingIdentity` reported no connected sending identity for
 *     an org that had connected one.
 *   - `POST /api/integrations/:provider/test` read `.encrypted` unguarded and
 *     handed `undefined` to `JSON.parse`, so it threw a 500 rather than saying
 *     what was wrong.
 *
 * This is the same class as units 30–38 — a rule that exists and is applied to
 * some surfaces and not others — but here the rule is a data shape rather than
 * a permission, and the cost lands on the customer's invoice rather than on
 * their privacy.
 *
 * WHY A REGISTRY DERIVED FROM SOURCE. The defect is invisible file by file:
 * every one of those readers looks correct on its own. It is only visible when
 * the set is enumerated, which is exactly why the scan below builds the set
 * from source rather than from a hand-written list — a hand-written list is how
 * the set got out of sync in the first place.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

process.env.FIELD_ENCRYPTION_KEY =
  "4242424242424242424242424242424242424242424242424242424242424242";

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const { readIntegrationCredentials, sealIntegrationCredentials } = await import(
  "../../server/services/integrationCredentials"
);
const { encryptJsonCredentials } = await import("../../server/services/fieldEncryption");

const ROOT = path.resolve(__dirname, "../..");

describe("credentials are read the same way wherever they are stored", () => {
  it("reads the legacy PLAINTEXT shape", () => {
    const creds = readIntegrationCredentials<{ apiKey?: string }>({
      credentials: { apiKey: "sk_plain" },
    });
    expect(creds?.apiKey).toBe("sk_plain");
  });

  it("reads the ENVELOPE shape", () => {
    const creds = readIntegrationCredentials<{ apiKey?: string }>({
      credentials: { encrypted: encryptJsonCredentials({ apiKey: "sk_sealed" }) },
    });
    expect(creds?.apiKey).toBe("sk_sealed");
  });

  it("merges when a row carries BOTH, with the plaintext field winning", () => {
    // A row can carry both because upsertOrganizationIntegration replaces
    // `credentials` wholesale while save-api-key merged onto whatever was
    // there. An envelope write therefore erases any plaintext sibling, so a
    // plaintext sibling can only have been written AFTER an envelope — which
    // makes it the more recent value. Fields only the envelope holds survive,
    // which is what save-api-key was trying to express when it wrote
    // `{ ...existing.credentials, apiKey }` and could not see inside.
    const creds = readIntegrationCredentials<{ apiKey?: string; fromEmail?: string }>({
      credentials: {
        encrypted: encryptJsonCredentials({ apiKey: "sk_old", fromEmail: "a@b.c" }),
        apiKey: "sk_new",
      },
    });
    expect(creds?.apiKey).toBe("sk_new");
    expect(creds?.fromEmail, "a field only the envelope held was dropped").toBe("a@b.c");
  });

  it("a blank plaintext field cannot blank a real key", () => {
    // Otherwise an empty form field silently disables an org's integration and
    // sends its traffic back to the platform key, with nothing reporting it.
    const creds = readIntegrationCredentials<{ apiKey?: string }>({
      credentials: { encrypted: encryptJsonCredentials({ apiKey: "sk_real" }), apiKey: "  " },
    });
    expect(creds?.apiKey).toBe("sk_real");
  });

  it("an unreadable envelope reads as NOT configured, not as a usable key", () => {
    const creds = readIntegrationCredentials({
      credentials: { encrypted: "enc:v1:" + Buffer.from("not json").toString("base64") },
    });
    expect(creds).toBeNull();
  });

  it("still returns the plaintext siblings when the envelope cannot be opened", () => {
    // A row can hold both, and one being unreadable is no reason to discard the
    // other. The org keeps working on the key it most recently set.
    const creds = readIntegrationCredentials<{ apiKey?: string }>({
      credentials: {
        encrypted: "enc:v1:" + Buffer.from("not json").toString("base64"),
        apiKey: "sk_new",
      },
    });
    expect(creds?.apiKey).toBe("sk_new");
  });

  it("null for absent, empty and missing integrations", () => {
    expect(readIntegrationCredentials(null)).toBeNull();
    expect(readIntegrationCredentials(undefined)).toBeNull();
    expect(readIntegrationCredentials({})).toBeNull();
    expect(readIntegrationCredentials({ credentials: {} })).toBeNull();
    expect(readIntegrationCredentials({ credentials: { apiKey: "" } })).toBeNull();
  });

  it("seals to the envelope shape, and round-trips", () => {
    const sealed = sealIntegrationCredentials({ apiKey: "sk_round", region: "us-east-1" }, 7);
    expect(sealed.encrypted.startsWith("enc:v1:")).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain("sk_round");
    const back = readIntegrationCredentials<{ apiKey?: string; region?: string }>(
      { credentials: sealed },
      7,
    );
    expect(back).toEqual({ apiKey: "sk_round", region: "us-east-1" });
  });
});

// ─── The registry, derived from source ────────────────────────────────────────

function serverFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) found.push(p);
    }
  };
  walk(path.join(ROOT, "server"));
  return found;
}

/**
 * Reads of the RAW COLUMN's shape — `<something>.credentials?.encrypted` and
 * friends — as opposed to `credentials.apiKey` on a bag the accessor already
 * decoded, which is the correct thing to write and appears everywhere.
 */
const RAW_SHAPE = [
  /\.credentials\s*\??\.\s*(encrypted|apiKey)\b/,
  /\.credentials\s+as\b[^\n]*\?\.\s*(encrypted|apiKey)\b/,
];

/**
 * Sites that read the raw shape ON PURPOSE. Each needs a reason that survives
 * reading, because every entry here is a place the defect above could come back.
 */
const REGISTERED = [
  {
    file: "server/jobs/indexAnalyzer.ts",
    why:
      "Not a credential. The platform index-analysis report has no column of " +
      "its own and is round-tripped as plain JSON through the `encrypted` slot " +
      "on a PLATFORM_ORG_ID row — it is never decrypted and never a secret.",
  },
  {
    file: "server/routes-integrations.ts",
    why:
      "The display surfaces distinguish 'configured but unreadable' from 'not " +
      "configured'. The accessor deliberately returns null for both, so telling " +
      "them apart needs the raw field — and reporting 'not configured' for a key " +
      "the org really did set would be false.",
  },
];

function rawShapeHits(): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = [];
  for (const abs of serverFiles()) {
    const rel = path.relative(ROOT, abs);
    if (rel === "server/services/integrationCredentials.ts") continue;
    const lines = stripComments(fs.readFileSync(abs, "utf8")).split("\n");
    lines.forEach((text, i) => {
      if (RAW_SHAPE.some((re) => re.test(text))) {
        hits.push({ file: rel, line: i + 1, text: text.trim() });
      }
    });
  }
  return hits;
}

describe("nothing reads the storage shape directly except by registration", () => {
  const hits = rawShapeHits();

  it("finds the registered sites (vacuity guard)", () => {
    // If the scan matched nothing at all, every assertion below would pass by
    // checking nothing — including after someone reintroduced a raw read.
    for (const r of REGISTERED) {
      expect(
        hits.filter((h) => h.file === r.file).length,
        `${r.file} no longer reads the raw shape — remove it from REGISTERED ` +
          `rather than leaving a registration that documents nothing.`,
      ).toBeGreaterThan(0);
    }
  });

  it("every raw read is registered with a reason", () => {
    const registered = new Set(REGISTERED.map((r) => r.file));
    const stray = hits.filter((h) => !registered.has(h.file));
    expect(
      stray.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n"),
      "These read organization_integrations.credentials by its STORAGE SHAPE. " +
        "A key stored the other way is invisible to them, which is how an org " +
        "ended up billed for lookups its own key was meant to cover while the " +
        "platform paid the vendor. Use readIntegrationCredentials() from " +
        "server/services/integrationCredentials.ts, or register the site above.",
    ).toBe("");
  });

  it("REGISTERED carries a reason for every entry", () => {
    for (const r of REGISTERED) {
      expect(r.why.length, `${r.file} is registered with no reason`).toBeGreaterThan(60);
    }
  });
});

describe("the surfaces this fixed stay fixed", () => {
  function code(rel: string): string {
    return stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  }

  it("the BYOK save route SEALS the key instead of storing it in the clear", () => {
    const src = code("server/routes-misc.ts");
    const at = src.indexOf('"/api/settings/save-api-key"');
    expect(at, "save-api-key route not found — renamed?").toBeGreaterThan(-1);
    const handler = src.slice(at, at + 2500);
    expect(handler, "save-api-key no longer seals the credential").toContain(
      "sealIntegrationCredentials(",
    );
    expect(
      /credentials:\s*\{\s*\.\.\.[\w.]*credentials[^}]*apiKey/.test(handler),
      "save-api-key is writing the key into the column in the clear again",
    ).toBe(false);
  });

  it("the credit gate asks whether a key EXISTS, not which shape it is in", () => {
    // The gate and the use must resolve the credential the same way. When they
    // disagreed, the org was charged for a query its own key then failed to be
    // used for — one wrong answer billed twice.
    const src = code("server/routes-properties.ts");
    const occurrences = src.split("usingOrgRegridCredentials =").slice(1);
    expect(occurrences.length, "the regrid credit gate is gone — renamed?").toBe(2);
    for (const tail of occurrences) {
      const decl = tail.slice(0, 400);
      expect(decl, "the credit gate is keyed on the storage shape again").not.toMatch(
        /credentials\s*\??\.\s*encrypted/,
      );
      expect(decl, "the credit gate no longer resolves the credential").toContain(
        "readIntegrationCredentials",
      );
    }
  });

  it("both integration writers seal, so neither can reintroduce a plaintext row", () => {
    for (const rel of ["server/routes-misc.ts", "server/routes-integrations.ts"]) {
      expect(code(rel), `${rel} writes credentials without sealing them`).toContain(
        "sealIntegrationCredentials(",
      );
    }
  });
});
