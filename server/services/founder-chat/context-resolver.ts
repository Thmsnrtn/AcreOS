/**
 * Context resolver — builds the FounderToolContext that every tool
 * handler receives. Reads page-context hints from the chat client
 * (currentPath, currentOrgId), parses recent mentions from the thread
 * history, and provides an auditLog closure that posts to founder_audit.
 *
 * This is the lighter "per-tool-call" context. The heavier "what does
 * Atlas see in its prompt window" context is built by context-loader.ts.
 */

import { db } from "../../db";
import { founderAudit } from "@shared/schema";
import type { FounderToolContext } from "./tool-registry";

type RecentMention = FounderToolContext["recentMentions"][number];

interface BuildContextOpts {
  founderUserId: string;
  organizationId: number;
  threadId: number;
  currentPath?: string;
  /** Recent thread messages — used to mine entity mentions. */
  recentMessages?: Array<{ role: string; content: string; toolCalls?: unknown }>;
}

const PATH_RESOLVERS: Array<{
  pattern: RegExp;
  resolve: (m: RegExpMatchArray) => Partial<FounderToolContext>;
}> = [
  {
    pattern: /^\/founder\/inspector\/org\/(\d+)/,
    resolve: (m) => ({ currentOrgId: Number(m[1]) }),
  },
  {
    pattern: /^\/founder\/inspector\/cost-event\/(\d+)/,
    resolve: (m) => ({ currentLedgerEventId: Number(m[1]) }),
  },
  {
    pattern: /^\/founder\/inspector\/provider\/([a-z0-9_-]+)/i,
    resolve: (m) => ({ currentProviderName: m[1].toLowerCase() }),
  },
  {
    pattern: /^\/outreach\/mail\/shipment\/(\d+)/,
    resolve: (m) => ({ currentShipmentId: Number(m[1]) }),
  },
];

function resolvePathHints(currentPath?: string): Partial<FounderToolContext> {
  if (!currentPath) return {};
  for (const r of PATH_RESOLVERS) {
    const m = currentPath.match(r.pattern);
    if (m) return r.resolve(m);
  }
  return {};
}

/**
 * Mine the last few thread messages for entity references. Looks at
 * tool-call args + assistant message content for IDs that Atlas can
 * resolve "them / it / this org" to.
 */
function mineRecentMentions(
  messages: BuildContextOpts["recentMessages"] = [],
): RecentMention[] {
  const mentions: RecentMention[] = [];
  const ID_PATTERNS: Array<{ kind: string; regex: RegExp }> = [
    { kind: "org", regex: /\borg(?:_id)?\s*[=:]\s*(\d+)/gi },
    { kind: "shipment", regex: /\bshipment(?:_id)?\s*[=:]\s*(\d+)/gi },
    { kind: "ledger", regex: /\bledger(?:_id)?\s*[=:]\s*(\d+)/gi },
    { kind: "decision", regex: /\bdecision(?:_id)?\s*[=:]\s*(\d+)/gi },
    { kind: "trigger", regex: /\btrigger(?:_id)?\s*[=:]\s*(\d+)/gi },
  ];
  for (const msg of [...messages].reverse().slice(0, 20)) {
    const text = `${msg.content ?? ""} ${JSON.stringify(msg.toolCalls ?? "")}`;
    for (const { kind, regex } of ID_PATTERNS) {
      // Reset regex state for each text since we use the global flag.
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const id = Number(match[1]);
        if (Number.isFinite(id) && !mentions.find((m) => m.kind === kind && m.id === id)) {
          mentions.push({ kind, id });
          if (mentions.length >= 10) return mentions;
        }
      }
    }
  }
  return mentions;
}

export async function buildFounderToolContext(opts: BuildContextOpts): Promise<FounderToolContext> {
  const pathHints = resolvePathHints(opts.currentPath);
  const recentMentions = mineRecentMentions(opts.recentMessages);

  const auditLog: FounderToolContext["auditLog"] = async (action, before, after) => {
    try {
      await db.insert(founderAudit).values({
        founderId: opts.founderUserId,
        area: "atlas.tool_call",
        action,
        before: (before as any) ?? null,
        after: (after as any) ?? null,
        note: `thread=${opts.threadId}${opts.currentPath ? `; path=${opts.currentPath}` : ""}`,
      } as any);
    } catch {
      // Never throw from audit-log — must not break the tool call.
    }
  };

  return {
    founderUserId: opts.founderUserId,
    organizationId: opts.organizationId,
    currentPath: opts.currentPath,
    ...pathHints,
    recentMentions,
    threadId: opts.threadId,
    auditLog,
  };
}
