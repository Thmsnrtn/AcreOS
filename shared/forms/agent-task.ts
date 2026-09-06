/**
 * Client-safe `insertAgentTaskSchema` — plain zod, no drizzle, no schema barrel.
 *
 * WHY THIS FILE EXISTS. `shared/routes.ts` is imported by three client hooks
 * (use-leads, use-properties, use-notes) and used `insertAgentTaskSchema` from
 * `@shared/schema` as a VALUE. That barrel re-exports 84 drizzle modules, and
 * drizzle's column chains are un-annotated calls no bundler can prove pure — so
 * one value import dragged all 541 table definitions into the client entry
 * chunk: ~364 KB raw / 71 KB gzip of Postgres DDL, shipped to every user on
 * every route, for tables a browser can never query. It is all-or-nothing;
 * severing ten of eleven paths saves nothing.
 *
 * WHAT MUST STAY TRUE. This must accept exactly what
 * `createInsertSchema(agentTasks).omit({ id, createdAt, startedAt, completedAt })`
 * accepts. createInsertSchema makes a `.notNull()` column WITHOUT a default
 * required and everything else optional — that is the rule this file follows,
 * column by column. `agentTaskFormSchemaMatchesDrizzle` in
 * `tests/unit/clientFormSchemasMatchDrizzle.test.ts` compares the two field sets
 * on the server, where importing drizzle is free, so drift fails CI rather than
 * reaching a form.
 *
 * DO NOT "simplify" this back to `import { insertAgentTaskSchema } from
 * "@shared/schema"`. That restores the entire payload in one line.
 */
import { z } from "zod";

export const insertAgentTaskSchema = z.object({
  // .notNull() with no default -> required
  organizationId: z.number().int(),
  agentType: z.string(),
  // `jsonb("input").notNull()` with no default -> REQUIRED. Plain `z.unknown()`
  // is OPTIONAL in zod (it accepts undefined), so it silently let a form submit
  // without the one field the task cannot run without. The equivalence test
  // below caught it; `.refine` keeps the value unconstrained while making the
  // key mandatory, which is what drizzle-zod produces here.
  input: z.unknown().refine((v) => v !== undefined, { message: "input is required" }),

  // .notNull().default(...) -> optional on insert
  status: z.string().optional(),

  // nullable columns -> optional, and explicitly nullable
  agentConfigId: z.number().int().nullable().optional(),
  priority: z.number().int().nullable().optional(),
  output: z.unknown().nullable().optional(),
  error: z.string().nullable().optional(),
  relatedLeadId: z.number().int().nullable().optional(),
  relatedPropertyId: z.number().int().nullable().optional(),
  relatedDealId: z.number().int().nullable().optional(),
  executionTimeMs: z.number().int().nullable().optional(),
  requiresReview: z.boolean().nullable().optional(),
  reviewedBy: z.number().int().nullable().optional(),
  reviewedAt: z.coerce.date().nullable().optional(),
  reviewNotes: z.string().nullable().optional(),

  // id / createdAt / startedAt / completedAt are .omit()ed by the original.
});

export type InsertAgentTask = z.infer<typeof insertAgentTaskSchema>;
