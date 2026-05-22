/**
 * useFounderChatThreads — thread list + createThread mutation.
 *
 * Phase B owns the endpoint /api/founder/chat/threads. Pre-Phase-B
 * we return a single hard-coded default thread so the UI works.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ChatThread } from "@shared/founder-chat/artifacts";

/** Fallback thread used pre-Phase-B and on cold-start. */
const FALLBACK_DEFAULT_THREAD: ChatThread = {
  id: "default",
  title: null,
  isDefault: true,
  lastActivityAt: new Date(0).toISOString(),
};

export function useFounderChatThreads() {
  const queryClient = useQueryClient();

  const query = useQuery<ChatThread[]>({
    queryKey: ["/api/founder/chat/threads"],
    staleTime: 60_000,
    queryFn: async ({ queryKey }) => {
      const url = queryKey[0] as string;
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return [FALLBACK_DEFAULT_THREAD];
        const body = (await res.json()) as ChatThread[];
        // Ensure there's always a default thread in the list.
        if (!body.some((t) => t.isDefault)) {
          return [FALLBACK_DEFAULT_THREAD, ...body];
        }
        return body;
      } catch {
        return [FALLBACK_DEFAULT_THREAD];
      }
    },
  });

  const createThread = useMutation({
    mutationFn: async (input: { title?: string }) => {
      const res = await apiRequest("POST", "/api/founder/chat/threads", input);
      return (await res.json()) as ChatThread;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/chat/threads"] });
    },
  });

  return {
    threads: query.data ?? [FALLBACK_DEFAULT_THREAD],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    createThread,
  };
}
