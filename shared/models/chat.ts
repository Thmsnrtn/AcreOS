/**
 * Communications tables — the canonical declarations live in shared/schema.ts.
 *
 * This module previously declared its own `conversations` / `messages`
 * pgTables (a minimal id/title/role chat shape). Those declarations were
 * unreachable: shared/schema.ts both star-exports this module AND declares
 * the operative tables itself (the org/lead/channel-scoped comms shape that
 * migration 0000 created and every consumer uses), and explicit declarations
 * shadow star-exported ones — so the pair here was a second, divergent
 * declaration of the same physical tables (Q8-V5 census 2026-11-25, rank #1:
 * the repo's only duplicated table declarations).
 *
 * The cure keeps this module as the import path it has always been, but as a
 * pure re-export: every name below IS the canonical object/type declared in
 * shared/schema.ts (identical runtime identity, pinned by
 * tests/unit/commsTablesSingleDeclaration.test.ts). Do not redeclare a
 * pgTable here — declare comms table changes in shared/schema.ts.
 */
export {
  conversations,
  messages,
  insertConversationSchema,
  insertMessageSchema,
} from "../schema";
export type {
  Conversation,
  InsertConversation,
  Message,
  InsertMessage,
} from "../schema";
