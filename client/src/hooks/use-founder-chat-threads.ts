/**
 * useFounderChatThreads — thread list + createThread mutation.
 *
 * Server contract (server/routes-founder-chat.ts):
 *   GET  /api/founder/chat/threads  → { threads: AiConversationRow[] }
 *   POST /api/founder/chat/threads  → { thread: { id, threadTitle } }
 *
 * Threads are serial integers. There is NO "default" thread id — the
 * server lazily creates the founder's default thread on the first
 * POST /stream. So when the founder has no threads yet we return an
 * empty list and let the chat hooks no-op until a real numeric id
 * exists (rather than fabricating a bogus "default" id, which used to
 * make the message-fetch 400 and the stream 404 on the Today surface).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ChatThread } from "@shared/founder-chat/artifacts";

/** Raw row shape returned by the server's aiConversations select. */
interface FounderThreadRow {
  id: number;
  threadTitle?: string | null;
  title?: string | null;
  isDefault?: boolean | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

function normalizeThread(row: FounderThreadRow): ChatThread {
  return {
    id: String(row.id),
    title: row.threadTitle ?? row.title ?? null,
    isDefault: Boolean(row.isDefault),
    lastActivityAt:
      row.updatedAt ?? row.createdAt ?? new Date(0).toISOString(),
  };
}

export function useFounderChatThreads() {
  const queryClient = useQueryClient();

  const query = useQuery<ChatThread[]>({
    queryKey: ["/api/founder/chat/threads"],
    staleTime: 60_000,
    queryFn: async ({ queryKey }) => {
      const url = queryKey[0] as string;
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return [];
        const body = (await res.json()) as { threads?: FounderThreadRow[] };
        const rows = Array.isArray(body?.threads) ? body.threads : [];
        return rows.map(normalizeThread);
      } catch {
        return [];
      }
    },
  });

  const createThread = useMutation({
    mutationFn: async (input: { title?: string }) => {
      // Server requires a non-empty threadTitle; fall back to a date stamp
      // when the caller (e.g. the "new thread" button) doesn't supply one.
      const threadTitle =
        input.title?.trim() ||
        `Atlas — ${new Date().toLocaleDateString()}`;
      const res = await apiRequest("POST", "/api/founder/chat/threads", {
        threadTitle,
      });
      const body = (await res.json()) as { thread?: FounderThreadRow };
      return body.thread ? normalizeThread(body.thread) : null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/chat/threads"] });
    },
  });

  return {
    threads: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    createThread,
  };
}
