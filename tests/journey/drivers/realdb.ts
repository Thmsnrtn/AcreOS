/**
 * Journey-proof harness — the realdb driver (CI rehearsal).
 *
 * Executes a walk spec against the real API sequence on a real database
 * built from this repository — the same environment the `test` workflow's
 * shards run in (ACREOS_REAL_DATABASE_URL + ACREOS_REQUIRE_REAL_DB).
 *
 * The driver never imports server code at module scope: route modules and
 * server/db are imported dynamically inside methods, AFTER the rehearsal
 * test file has registered its mocks (auth passthrough, email-transport
 * spy) and called useRealDb(). Importing server code at the top of this
 * file would run before the mocks and before DATABASE_URL is pointed at
 * the real database.
 *
 * NO SEND: the email transport is a spy owned by the test file (passed in
 * as `sentCount`). The driver reports its count; the runner fails the walk
 * if it is ever non-zero.
 */
import express from "express";
import request from "supertest";
import type { WalkDriver } from "../runner";
import type { WalkSpec } from "../walk-spec";

export interface RealDbDriverOptions {
  /** Reads the test file's transport-spy counter. The driver never owns the spy. */
  sentCount: () => number;
  /** Operator values for manual steps, if a rehearsal ever needs them. */
  manualInputs?: Record<string, string>;
}

export class RealDbDriver implements WalkDriver {
  readonly name = "realdb" as const;
  readonly label = "CI realdb rehearsal (Postgres built from this repo)";
  private app: express.Express | null = null;
  private userId = "";
  private orgId = 0;

  constructor(private readonly opts: RealDbDriverOptions) {}

  sentCount = (): number | null => {
    return this.opts.sentCount();
  };

  async version(): Promise<{ sha: string }> {
    // A rehearsal runs against a local checkout, not a deployed image.
    return { sha: "unknown" };
  }

  async collectManualInput(step: { collects?: { key: string; prompt: string }[] }): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const c of step.collects ?? []) {
      const value = this.opts.manualInputs?.[c.key];
      if (value === undefined) throw new Error(`manual input ${c.key} not provided (${c.prompt})`);
      out[c.key] = value;
    }
    return out;
  }

  async setupOrg(spec: WalkSpec, tag: string): Promise<{ orgId: number | string }> {
    const { db } = await import("../../../server/db");
    const { organizations } = await import("@shared/schema");
    this.userId = `${tag}-user`;
    const [org] = await db
      .insert(organizations)
      .values({
        name: `${tag} ${spec.org.nameSuffix}`,
        slug: tag,
        ownerId: `${tag}-owner`,
        legalEntityName: `${tag} ${spec.org.nameSuffix}`,
        onboardingCompleted: true,
        onboardingData: { businessType: spec.org.businessType },
      } as never)
      .returning();
    this.orgId = org.id;
    this.app = await this.buildApp(spec);
    return { orgId: org.id };
  }

  private async buildApp(spec: WalkSpec): Promise<express.Express> {
    const app = express();
    app.use(express.json());
    const orgId = this.orgId;
    const userId = this.userId;
    app.use(async (req: any, _res, next) => {
      const { storage } = await import("../../../server/storage");
      req.organization = await storage.getOrganization(orgId);
      req.organizationId = orgId;
      req.user = { id: userId };
      next();
    });
    for (const route of spec.realdbRoutes ?? []) {
      const mod: any = await import(route.module);
      if (route.kind === "router") {
        app.use(route.mount ?? "/", mod.default);
      } else {
        const register = mod[route.exportName ?? ""];
        if (typeof register !== "function") {
          throw new Error(`realdb route ${route.module} exports no function ${route.exportName ?? ""}`);
        }
        register(app);
      }
    }
    return app;
  }

  api: WalkDriver["api"] = async (method, path, body) => {
    if (!this.app) throw new Error("realdb driver: setupOrg must run before api");
    const req = request(this.app);
    const lower = method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
    const res = body === undefined ? await req[lower](path) : await req[lower](path).send(body as Record<string, unknown>);
    return { status: res.status, body: res.body };
  };

  sql: WalkDriver["sql"] = async (query, params = []) => {
    const { pool } = await import("../../../server/db");
    const result = await pool.query(query, params);
    return result.rows as Record<string, unknown>[];
  };

  async cleanup(spec: WalkSpec, orgId: number | string): Promise<void> {
    const { pool } = await import("../../../server/db");
    const numericOrg = Number(orgId);
    // One LITERAL statement per table, from a fixed allowlist — never a
    // dynamic-table DELETE (`DELETE FROM "${table}" …`). A template whose
    // table is interpolated cannot be resolved by the raw-SQL scanner
    // (tests/unit/rawSqlColumnsExist.test.ts counts it unresolved, and the
    // ratchet ceiling does not move for it), and a delete whose target is
    // data is exactly the shape that gate exists to keep visible. A spec
    // that names a table with no literal statement here fails loudly:
    // add the statement (in the spec's FK-safe order) in the same change
    // that adds the table to a spec.
    for (const table of spec.cleanupTables) {
      switch (table) {
        case "buyer_blast_recipients":
          await pool.query(`DELETE FROM buyer_blast_recipients WHERE organization_id = $1`, [numericOrg]);
          break;
        case "buyer_blasts":
          await pool.query(`DELETE FROM buyer_blasts WHERE organization_id = $1`, [numericOrg]);
          break;
        case "buyer_property_matches":
          await pool.query(`DELETE FROM buyer_property_matches WHERE organization_id = $1`, [numericOrg]);
          break;
        case "buyer_profiles":
          await pool.query(`DELETE FROM buyer_profiles WHERE organization_id = $1`, [numericOrg]);
          break;
        case "outcomes":
          await pool.query(`DELETE FROM outcomes WHERE organization_id = $1`, [numericOrg]);
          break;
        case "decision_snapshots":
          await pool.query(`DELETE FROM decision_snapshots WHERE organization_id = $1`, [numericOrg]);
          break;
        case "scenarios":
          await pool.query(`DELETE FROM scenarios WHERE organization_id = $1`, [numericOrg]);
          break;
        case "generated_documents":
          await pool.query(`DELETE FROM generated_documents WHERE organization_id = $1`, [numericOrg]);
          break;
        case "contract_assignments":
          await pool.query(`DELETE FROM contract_assignments WHERE organization_id = $1`, [numericOrg]);
          break;
        case "deals":
          await pool.query(`DELETE FROM deals WHERE organization_id = $1`, [numericOrg]);
          break;
        case "properties":
          await pool.query(`DELETE FROM properties WHERE organization_id = $1`, [numericOrg]);
          break;
        case "leads":
          await pool.query(`DELETE FROM leads WHERE organization_id = $1`, [numericOrg]);
          break;
        default:
          throw new Error(
            `realdb cleanup: no literal cleanup statement for table ${JSON.stringify(table)} — add one to the allowlist in tests/journey/drivers/realdb.ts`,
          );
      }
    }
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [numericOrg]);
  }
}
