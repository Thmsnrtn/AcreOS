/**
 * Q8-V5 census cure (2026-11-25, rank #1) — the Communications tables
 * `conversations` and `messages` must be declared exactly ONCE.
 *
 * The census found the repo's only duplicated pgTable declarations: the pair
 * was declared in shared/schema.ts (the operative org/lead/channel-scoped
 * comms shape — the one migration 0000 created and every consumer resolves
 * to through the schema barrel) AND in shared/models/chat.ts (a minimal
 * id/title/role shape that matched no migration and no consumer, unreachable
 * because schema.ts's explicit declarations shadow its `export *` of the
 * chat module). Two divergent declarations of one physical table is a
 * standing trap: any future direct importer of models/chat would silently
 * query with the wrong columns.
 *
 * The cure made shared/models/chat.ts a pure re-export of the canonical
 * shared/schema.ts declarations. This test pins all three legs of that cure:
 *
 *   1. IDENTITY — every name exported by shared/models/chat IS (===) the
 *      canonical object from shared/schema, so both import paths can never
 *      drift apart again.
 *   2. CENSUS — across shared/** (tests excluded, comments stripped), the
 *      literal declarations pgTable("conversations") and pgTable("messages")
 *      each occur exactly once, in shared/schema.ts; shared/models/chat.ts
 *      declares no pgTable at all.
 *   3. SHAPE — the canonical tables keep the migrated column sets and the
 *      messages indexes, so a "dedup" that swapped in the minimal shape
 *      instead of deleting it would fail here, not in production.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { getTableConfig } from "drizzle-orm/pg-core";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { stripComments } from "../helpers/stripComments";
import * as chat from "../../shared/models/chat";
import {
  conversations,
  messages,
  insertConversationSchema,
  insertMessageSchema,
} from "../../shared/schema";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ls = (spec: string) =>
  execSync(`git ls-files ${spec}`).toString().trim().split("\n").filter(Boolean);

describe("comms tables — single canonical declaration", () => {
  it("models/chat re-exports the identical canonical objects", () => {
    expect(chat.conversations).toBe(conversations);
    expect(chat.messages).toBe(messages);
    expect(chat.insertConversationSchema).toBe(insertConversationSchema);
    expect(chat.insertMessageSchema).toBe(insertMessageSchema);
  });

  it("exactly one pgTable declaration per comms table name, in shared/schema.ts", () => {
    const files = ls("'shared/*.ts' 'shared/**/*.ts'").filter(
      (f) => !/\.(test|spec)\.ts$/.test(f),
    );
    expect(files.length).toBeGreaterThan(100); // population floor: a broken walk must not pass vacuously
    for (const table of ["conversations", "messages"]) {
      const decl = new RegExp(`pgTable\\(\\s*"${table}"`);
      const hits = files.filter((f) => decl.test(stripComments(readFileSync(f, "utf8"))));
      expect(hits).toEqual(["shared/schema.ts"]);
    }
    const chatSrc = stripComments(readFileSync("shared/models/chat.ts", "utf8"));
    expect(chatSrc).not.toMatch(/pgTable\s*\(/);
  });

  it("canonical conversations shape is the migrated org-scoped one", () => {
    const cfg = getTableConfig(conversations);
    expect(cfg.name).toBe("conversations");
    expect(cfg.columns.map((c) => c.name)).toEqual([
      "id",
      "organization_id",
      "lead_id",
      "property_id",
      "channel",
      "external_id",
      "status",
      "assigned_agent_id",
      "assigned_human_id",
      "last_message_at",
      "created_at",
    ]);
  });

  it("canonical messages shape and indexes are the migrated ones", () => {
    const cfg = getTableConfig(messages);
    expect(cfg.name).toBe("messages");
    expect(cfg.columns.map((c) => c.name)).toEqual([
      "id",
      "conversation_id",
      "organization_id",
      "direction",
      "sender",
      "content",
      "generated_by_agent",
      "agent_task_id",
      "status",
      "external_id",
      "metadata",
      "created_at",
    ]);
    const indexNames = (cfg.indexes ?? []).map((i) => i.config.name);
    expect(indexNames).toContain("messages_external_id_unique");
    expect(indexNames).toContain("messages_org_conversation_created_idx");
  });
});
