/**
 * The client-safe form schemas must accept exactly what drizzle-zod accepts.
 *
 * WHY THEY EXIST. Ten client modules value-imported `@shared/schema`, a barrel
 * re-exporting 84 drizzle modules. Drizzle's column chains (`text("x").notNull()`)
 * are un-annotated calls no bundler can prove side-effect-free, so ONE value
 * import dragged all 541 table definitions into the client ENTRY chunk — ~364 KB
 * raw / 71 KB gzip of Postgres DDL, downloaded and parsed by every user on every
 * route, for tables a browser can never query. Measured: importing a single plain
 * constant still yielded 438/438 tables present. All-or-nothing.
 *
 * So the forms were rewritten in plain zod. That trade buys the bundle back and
 * costs a duplicate definition — and a duplicate definition drifts. This test is
 * the payment: it runs on the SERVER, where importing drizzle is free, and
 * compares each hand-written schema against `createInsertSchema(table)` FIELD BY
 * FIELD. A column added to a table, or an optionality changed, fails here rather
 * than silently rejecting a valid form submission in production.
 *
 * ── WHAT IT COMPARES, AND WHY THAT AND NOT MORE ───────────────────────────
 * The field NAME SET and each field's OPTIONALITY. Those are the two properties
 * a form actually depends on: a missing field means the form cannot send a
 * value the server will store, and a required/optional mismatch means the form
 * rejects a submission the server would have accepted (or vice versa).
 *
 * It does NOT compare inner types. drizzle-zod's numeric handling and a
 * hand-written `z.string()` are deliberately allowed to differ in
 * representation — this repo's `numeric()` columns come back as strings and the
 * forms already coerce. Pinning the full type tree would fail on differences
 * that do not affect what the form can express, and a gate that fails on
 * harmless differences gets loosened until it fails on nothing.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { insertLeadSchema as drizzleLead } from "@shared/schema";
import { insertPropertySchema as drizzleProperty } from "@shared/schema";
import { insertDealSchema as drizzleDeal } from "@shared/schema";
import { insertNoteSchema as drizzleNote } from "@shared/schema";
import { insertTargetCountySchema as drizzleCounty } from "@shared/schema";
import { insertCampaignSchema as drizzleCampaign } from "@shared/schema";
import { insertAgentTaskSchema as drizzleAgentTask } from "@shared/schema";

import { insertLeadSchema as plainLead } from "@shared/forms/lead";
import { insertPropertySchema as plainProperty } from "@shared/forms/property";
import { insertDealSchema as plainDeal } from "@shared/forms/deal";
import { insertNoteSchema as plainNote } from "@shared/forms/note";
import { insertTargetCountySchema as plainCounty } from "@shared/forms/target-county";
import { insertCampaignSchema as plainCampaign } from "@shared/forms/campaign";
import { insertAgentTaskSchema as plainAgentTask } from "@shared/forms/agent-task";

/** Field name -> whether the schema accepts the object with that key absent. */
function shape(schema: z.ZodTypeAny): Map<string, boolean> {
  const obj = schema as unknown as z.ZodObject<z.ZodRawShape>;
  const raw = obj.shape;
  const out = new Map<string, boolean>();
  for (const [name, field] of Object.entries(raw)) {
    // isOptional() is the property a form depends on: may this key be absent?
    out.set(name, (field as z.ZodTypeAny).isOptional());
  }
  return out;
}

const PAIRS: Array<{ name: string; drizzle: z.ZodTypeAny; plain: z.ZodTypeAny }> = [
  { name: "insertLeadSchema", drizzle: drizzleLead, plain: plainLead },
  { name: "insertPropertySchema", drizzle: drizzleProperty, plain: plainProperty },
  { name: "insertDealSchema", drizzle: drizzleDeal, plain: plainDeal },
  { name: "insertNoteSchema", drizzle: drizzleNote, plain: plainNote },
  { name: "insertTargetCountySchema", drizzle: drizzleCounty, plain: plainCounty },
  { name: "insertCampaignSchema", drizzle: drizzleCampaign, plain: plainCampaign },
  { name: "insertAgentTaskSchema", drizzle: drizzleAgentTask, plain: plainAgentTask },
];

describe("every client-safe form schema still matches its drizzle-zod original", () => {
  it("the pair list covers every schema under shared/forms", async () => {
    // Derived, not trusted: a seventh form module added without a pair here
    // would be unchecked, and unchecked is exactly how a duplicate drifts.
    const { readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const files = readdirSync(path.join(process.cwd(), "shared", "forms"))
      .filter((f) => f.endsWith(".ts"));
    expect(files.length, "shared/forms is empty — this whole suite is vacuous")
      .toBeGreaterThan(0);
    expect(
      files.length,
      `shared/forms holds ${files.length} module(s) but only ${PAIRS.length} are ` +
        "compared here. An uncompared client schema is a duplicate nobody checks.",
    ).toBe(PAIRS.length);
  });

  for (const { name, drizzle, plain } of PAIRS) {
    it(`${name}: same fields, same optionality`, () => {
      const a = shape(drizzle);
      const b = shape(plain);

      const missing = [...a.keys()].filter((k) => !b.has(k));
      const extra = [...b.keys()].filter((k) => !a.has(k));
      expect(
        { missing, extra },
        `${name} field sets diverged. A field the form cannot send is a value the ` +
          "server will never receive; a field the form sends that the server " +
          "rejects is a submission that fails with no useful message.",
      ).toEqual({ missing: [], extra: [] });

      const optionalityDrift: string[] = [];
      for (const [field, drizzleOptional] of a) {
        const plainOptional = b.get(field);
        if (plainOptional !== drizzleOptional) {
          optionalityDrift.push(
            `${field}: drizzle ${drizzleOptional ? "optional" : "REQUIRED"}, ` +
              `client ${plainOptional ? "optional" : "REQUIRED"}`,
          );
        }
      }
      expect(
        optionalityDrift,
        `${name} optionality diverged. createInsertSchema makes a .notNull() ` +
          "column WITHOUT a default required and everything else optional — if " +
          "the client copy disagrees, a form either blocks a valid submission or " +
          "lets an invalid one reach the server.",
      ).toEqual([]);
    });
  }
});
