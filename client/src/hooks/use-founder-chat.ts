/**
 * useFounderChat — primary chat hook for the Atlas thread.
 *
 * Bridges between:
 *   - REST: GET /api/founder/chat/threads/:id/messages (initial hydration)
 *   - SSE:  /api/founder/chat/stream                   (live deltas)
 *   - REST: POST /api/founder/chat/threads/:id/messages (submit)
 *
 * Phase B owns those endpoints. This hook is defensive about partial
 * responses (so the UI works even before Phase B ships) — when the
 * endpoints don't exist yet, messages return `[]` and the SSE
 * connection silently fails. Tom can still type and see his own
 * message bubble; the assistant side just stays empty until the
 * backend is wired in.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  Artifact,
  ChatMessage,
  ChatStreamEvent,
} from "@shared/founder-chat/artifacts";

export type ChatStatus = "idle" | "submitting" | "streaming" | "error";

interface UseFounderChatResult {
  messages: ChatMessage[];
  status: ChatStatus;
  error: Error | null;
  sendMessage: (text: string) => Promise<void>;
  /** Drop a local placeholder message — used by Composer for optimistic echo. */
  appendLocal: (message: ChatMessage) => void;
  /** True while the streaming response is still arriving. */
  isStreaming: boolean;
  /** Live tool-call list for the in-flight assistant message. */
  activeToolCalls: Array<{ name: string; status: "running" | "complete" | "failed" }>;
}

export function useFounderChat(threadId: string | null): UseFounderChatResult {
  const queryClient = useQueryClient();
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<
    Array<{ name: string; status: "running" | "complete" | "failed" }>
  >([]);
  const streamingMessageIdRef = useRef<string | null>(null);

  // Initial hydration. on404 fall back to empty list — Phase B will
  // populate this endpoint; pre-Phase-B we just start with a clean
  // thread.
  const { data: serverMessages = [] } = useQuery<ChatMessage[]>({
    queryKey: [`/api/founder/chat/threads/${threadId}/messages`],
    enabled: !!threadId,
    staleTime: 30_000,
    queryFn: async ({ queryKey }) => {
      const url = queryKey[0] as string;
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return [];
        return (await res.json()) as ChatMessage[];
      } catch {
        return [];
      }
    },
  });

  // Merge server-hydrated + locally-streamed messages. Local takes
  // precedence by id so an in-flight assistant message keeps its
  // accumulated text/artifacts even after a refetch.
  const localById = new Map(localMessages.map((m) => [m.id, m]));
  const messages: ChatMessage[] = [
    ...serverMessages.filter((m) => !localById.has(m.id)),
    ...localMessages,
  ];

  const appendLocal = useCallback((message: ChatMessage) => {
    setLocalMessages((prev) => [...prev, message]);
  }, []);

  const updateStreamingMessage = useCallback(
    (mutator: (msg: ChatMessage) => ChatMessage) => {
      setLocalMessages((prev) => {
        const id = streamingMessageIdRef.current;
        if (!id) return prev;
        return prev.map((m) => (m.id === id ? mutator(m) : m));
      });
    },
    [],
  );

  const handleStreamEvent = useCallback(
    (event: ChatStreamEvent) => {
      switch (event.type) {
        case "message_start": {
          streamingMessageIdRef.current = event.messageId;
          setActiveToolCalls([]);
          setLocalMessages((prev) => [
            ...prev,
            {
              id: event.messageId,
              role: "assistant",
              text: "",
              artifacts: [],
              toolCalls: [],
              createdAt: new Date().toISOString(),
            },
          ]);
          setStatus("streaming");
          break;
        }
        case "tool_call_start": {
          setActiveToolCalls((prev) => [
            ...prev,
            { name: event.toolName, status: "running" },
          ]);
          break;
        }
        case "tool_call_complete": {
          setActiveToolCalls((prev) =>
            prev.map((t) =>
              t.name === event.toolName
                ? { ...t, status: event.failed ? "failed" : "complete" }
                : t,
            ),
          );
          updateStreamingMessage((m) => ({
            ...m,
            toolCalls: [
              ...(m.toolCalls ?? []),
              {
                name: event.toolName,
                status: event.failed ? "failed" : "complete",
                summary: event.summary,
              },
            ],
          }));
          break;
        }
        case "artifact": {
          updateStreamingMessage((m) => ({
            ...m,
            artifacts: [...(m.artifacts ?? []), event.artifact],
          }));
          break;
        }
        case "text_delta": {
          updateStreamingMessage((m) => ({
            ...m,
            text: (m.text ?? "") + event.delta,
          }));
          break;
        }
        case "text_complete": {
          updateStreamingMessage((m) => ({ ...m, text: event.text }));
          break;
        }
        case "message_end": {
          streamingMessageIdRef.current = null;
          setActiveToolCalls([]);
          setStatus("idle");
          // Refetch the canonical list once the message is finalized so
          // we drop the local optimistic copies.
          queryClient.invalidateQueries({
            queryKey: [`/api/founder/chat/threads/${threadId}/messages`],
          });
          break;
        }
        case "error": {
          setError(new Error(event.message));
          setStatus("error");
          streamingMessageIdRef.current = null;
          break;
        }
      }
    },
    [queryClient, threadId, updateStreamingMessage],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!threadId || !text.trim()) return;
      setError(null);
      setStatus("submitting");

      const userMessageId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      appendLocal({
        id: userMessageId,
        role: "user",
        text,
        createdAt: new Date().toISOString(),
      });

      try {
        // Phase B owns the actual streaming. We POST the user message
        // and open an SSE connection in parallel — when Phase B is
        // live, the POST seeds a turn and the SSE stream emits the
        // assistant response. Pre-Phase-B the POST may 404; we still
        // surface the user message so the UI works.
        await apiRequest(
          "POST",
          `/api/founder/chat/threads/${threadId}/messages`,
          { text },
        ).catch(() => {
          // Pre-Phase-B fallback: stub a "Atlas backend is not wired
          // yet" assistant message so the UI shows something.
          const stubId = `stub-${Date.now()}`;
          appendLocal({
            id: stubId,
            role: "assistant",
            text: "_Atlas backend pending (Phase B). Your message was captured locally._",
            artifacts: [],
            createdAt: new Date().toISOString(),
          });
          setStatus("idle");
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
      }
    },
    [appendLocal, threadId],
  );

  // SSE connection. Lives for the lifetime of the active thread.
  useEffect(() => {
    if (!threadId) return;

    let es: EventSource | null = null;
    try {
      es = new EventSource(
        `/api/founder/chat/stream?threadId=${encodeURIComponent(threadId)}`,
        { withCredentials: true } as EventSourceInit,
      );
    } catch {
      // EventSource not constructable in this environment — silently
      // skip. Tests that don't need streaming still work.
      return;
    }

    es.onmessage = (evt) => {
      if (!evt.data) return;
      try {
        const parsed = JSON.parse(evt.data) as ChatStreamEvent;
        handleStreamEvent(parsed);
      } catch {
        // Ignore malformed events — Phase B's job to ensure they're
        // well-formed; this is just defensive.
      }
    };

    es.onerror = () => {
      // Phase B will own auto-reconnect on the server. Browser default
      // EventSource also auto-reconnects with backoff; we leave the
      // connection in place.
    };

    return () => {
      es?.close();
    };
  }, [threadId, handleStreamEvent]);

  return {
    messages,
    status,
    error,
    sendMessage,
    appendLocal,
    isStreaming: status === "streaming",
    activeToolCalls,
  };
}

export function useChatConfirm() {
  return useMutation({
    mutationFn: async (requestId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/chat/confirm/${encodeURIComponent(requestId)}`,
      );
      return res.json();
    },
  });
}

export function useChatCancel() {
  return useMutation({
    mutationFn: async (requestId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/chat/cancel/${encodeURIComponent(requestId)}`,
      );
      return res.json();
    },
  });
}

/** Re-export the Artifact union for renderer consumers. */
export type { Artifact };
