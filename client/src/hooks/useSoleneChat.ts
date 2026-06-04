/**
 * useSoleneChat — SSE consumption hook for the Phase 2 Solene chat backend.
 *
 * Consumes /api/founder/solene-chat/conversations/:id/messages — which streams
 * Server-Sent Events of shape `{ type, data }` per the turn-runner contract
 * (see server/services/solene/chat/turnRunner.ts).
 *
 * State machine:
 *   - turn_start       → insert a new "pending" assistant message (isStreaming).
 *   - text_delta       → append to the pending message's text block.
 *   - thinking_delta   → append to the pending message's `thinking` field.
 *   - tool_use         → append a tool_use block to the pending message.
 *   - tool_result      → append a new tool-role message.
 *   - approval_pending → set pendingApproval (the inline UI prompt picks it up).
 *   - turn_done        → finalize pending (clear streaming + record cost/model).
 *   - error            → surface via onError + finalize with an error indicator.
 *
 * AbortController exposed via abortCurrentTurn — cancels the fetch + the
 * server detects req.on("close") and aborts the turn runner.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ContentBlock } from "@shared/schema/solene-conversations";
import type { ChatTier } from "@shared/schema/solene-chat-config";
import { clientLogger } from "@/lib/clientLogger";

// ─── Public types ──────────────────────────────────────────────────────────

export interface PendingApproval {
  token: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  conversationId: number;
}

export interface UiMessage {
  /** Server primary key once persisted; "pending" while streaming. */
  id: number | "pending";
  role: "user" | "assistant" | "tool" | "system";
  content: ContentBlock[];
  sentAt: Date;
  modelUsed?: string;
  estimatedCostUsd?: number;
  /** Accumulated thinking_delta tokens. */
  thinking?: string;
  /** True while the turn runner is still streaming into this message. */
  isStreaming?: boolean;
  /** Non-empty when the turn ended in an error event. */
  errorMessage?: string;
}

export interface UseSoleneChatOptions {
  conversationId: number | null;
  onError?: (err: Error) => void;
}

export interface UseSoleneChatReturn {
  messages: UiMessage[];
  loading: boolean;
  streaming: boolean;
  pendingApproval: PendingApproval | null;
  sendMessage: (content: ContentBlock[], tierHint?: ChatTier) => Promise<void>;
  approveTool: (token: string, decision: "approve" | "reject") => Promise<void>;
  abortCurrentTurn: () => void;
  refetchHistory: () => Promise<void>;
  /** Cumulative cost from finalized assistant turns this session. */
  totalCostUsd: number;
}

// ─── Server response shapes ────────────────────────────────────────────────

interface ServerMessageRow {
  id: number;
  conversationId: number;
  role: string;
  content: ContentBlock[];
  sentAt: string;
  modelUsed?: string | null;
  estimatedCostUsd?: string | number | null;
  errorMessage?: string | null;
}

interface ServerConversationResponse {
  conversation: {
    id: number;
    title: string | null;
    archived: boolean;
  };
  messages: ServerMessageRow[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function rowToUiMessage(row: ServerMessageRow): UiMessage {
  const cost =
    row.estimatedCostUsd == null
      ? undefined
      : typeof row.estimatedCostUsd === "string"
        ? Number(row.estimatedCostUsd)
        : row.estimatedCostUsd;
  return {
    id: row.id,
    role: row.role as UiMessage["role"],
    content: Array.isArray(row.content) ? row.content : [],
    sentAt: new Date(row.sentAt),
    modelUsed: row.modelUsed ?? undefined,
    estimatedCostUsd: Number.isFinite(cost) ? (cost as number) : undefined,
    errorMessage: row.errorMessage ?? undefined,
  };
}

/**
 * Mutate the pending assistant message in-place via a fresh array copy so
 * React notices the change. We always rebuild the last message rather than
 * splicing arbitrary indices — the streaming path only ever appends.
 */
function withUpdatedPending(
  prev: UiMessage[],
  updater: (m: UiMessage) => UiMessage,
): UiMessage[] {
  if (prev.length === 0) return prev;
  const last = prev[prev.length - 1];
  if (last.id !== "pending") return prev;
  const next = prev.slice(0, -1);
  next.push(updater(last));
  return next;
}

/** Append `delta` to the last text block on the pending message, or create one. */
function appendTextDelta(msg: UiMessage, delta: string): UiMessage {
  const blocks = [...msg.content];
  const lastIdx = blocks.length - 1;
  if (lastIdx >= 0 && blocks[lastIdx].type === "text") {
    const existing = blocks[lastIdx] as { type: "text"; text: string };
    blocks[lastIdx] = { type: "text", text: existing.text + delta };
  } else {
    blocks.push({ type: "text", text: delta });
  }
  return { ...msg, content: blocks };
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useSoleneChat(opts: UseSoleneChatOptions): UseSoleneChatReturn {
  const { conversationId, onError } = opts;
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [pendingApproval, setPendingApproval] =
    useState<PendingApproval | null>(null);
  const [totalCostUsd, setTotalCostUsd] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // ─── History fetch ──────────────────────────────────────────────────────
  const refetchHistory = useCallback(async () => {
    if (conversationId == null) {
      setMessages([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/founder/solene-chat/conversations/${conversationId}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        throw new Error(`Failed to load conversation: HTTP ${res.status}`);
      }
      const json = (await res.json()) as ServerConversationResponse;
      setMessages(json.messages.map(rowToUiMessage));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      clientLogger.error("[useSoleneChat] refetchHistory failed", error);
      onErrorRef.current?.(error);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  // Re-load on conversation change.
  useEffect(() => {
    setMessages([]);
    setPendingApproval(null);
    setTotalCostUsd(0);
    if (conversationId != null) {
      void refetchHistory();
    }
  }, [conversationId, refetchHistory]);

  // ─── Abort on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // ─── SSE event dispatcher ───────────────────────────────────────────────
  const handleEvent = useCallback(
    (event: string, data: Record<string, unknown>) => {
      switch (event) {
        case "turn_start": {
          setMessages((prev) => [
            ...prev,
            {
              id: "pending",
              role: "assistant",
              content: [],
              sentAt: new Date(),
              modelUsed:
                typeof data.model === "string" ? data.model : undefined,
              isStreaming: true,
            },
          ]);
          break;
        }
        case "text_delta": {
          const delta = typeof data.delta === "string" ? data.delta : "";
          if (!delta) break;
          setMessages((prev) =>
            withUpdatedPending(prev, (m) => appendTextDelta(m, delta)),
          );
          break;
        }
        case "thinking_delta": {
          const delta = typeof data.delta === "string" ? data.delta : "";
          if (!delta) break;
          setMessages((prev) =>
            withUpdatedPending(prev, (m) => ({
              ...m,
              thinking: (m.thinking ?? "") + delta,
            })),
          );
          break;
        }
        case "tool_use": {
          const id = typeof data.id === "string" ? data.id : "";
          const name = typeof data.name === "string" ? data.name : "";
          const input =
            data.input && typeof data.input === "object"
              ? (data.input as Record<string, unknown>)
              : {};
          if (!id || !name) break;
          setMessages((prev) =>
            withUpdatedPending(prev, (m) => ({
              ...m,
              content: [...m.content, { type: "tool_use", id, name, input }],
            })),
          );
          break;
        }
        case "tool_result": {
          const toolUseId =
            typeof data.toolUseId === "string" ? data.toolUseId : "";
          const output = typeof data.output === "string" ? data.output : "";
          if (!toolUseId) break;
          setMessages((prev) => [
            ...prev,
            {
              id: "pending",
              role: "tool",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: toolUseId,
                  content: output,
                },
              ],
              sentAt: new Date(),
            },
          ]);
          break;
        }
        case "approval_pending": {
          const token =
            typeof data.approvalToken === "string" ? data.approvalToken : "";
          const toolName =
            typeof data.toolName === "string" ? data.toolName : "";
          const toolInput =
            data.toolInput && typeof data.toolInput === "object"
              ? (data.toolInput as Record<string, unknown>)
              : {};
          if (!token || !toolName || conversationId == null) break;
          setPendingApproval({ token, toolName, toolInput, conversationId });
          break;
        }
        case "turn_done": {
          const cost =
            typeof data.totalCostUsd === "number" ? data.totalCostUsd : 0;
          setTotalCostUsd((prev) => prev + cost);
          setMessages((prev) =>
            withUpdatedPending(prev, (m) => ({
              ...m,
              isStreaming: false,
              estimatedCostUsd: cost || m.estimatedCostUsd,
            })),
          );
          setStreaming(false);
          // Invalidate cost summary so the footer re-fetches.
          void queryClient.invalidateQueries({
            queryKey: ["/api/founder/solene-chat/cost-summary"],
          });
          break;
        }
        case "error": {
          const message =
            typeof data.message === "string" ? data.message : "Stream error";
          const err = new Error(message);
          clientLogger.error("[useSoleneChat] stream error", err);
          onErrorRef.current?.(err);
          setMessages((prev) =>
            withUpdatedPending(prev, (m) => ({
              ...m,
              isStreaming: false,
              errorMessage: message,
            })),
          );
          setStreaming(false);
          break;
        }
        default:
          break;
      }
    },
    [conversationId, queryClient],
  );

  // ─── SSE parser ─────────────────────────────────────────────────────────
  /**
   * The backend writes SSE frames of the form:
   *   event: <name>\n
   *   data: <json>\n\n
   * Frames are separated by a blank line.
   */
  const parseSseBuffer = useCallback(
    (buffer: string): { events: { event: string; data: string }[]; rest: string } => {
      const events: { event: string; data: string }[] = [];
      let rest = buffer;
      while (true) {
        const sepIdx = rest.indexOf("\n\n");
        if (sepIdx === -1) break;
        const frame = rest.slice(0, sepIdx);
        rest = rest.slice(sepIdx + 2);
        let eventName = "message";
        const dataLines: string[] = [];
        for (const rawLine of frame.split("\n")) {
          const line = rawLine.replace(/\r$/, "");
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (dataLines.length > 0) {
          events.push({ event: eventName, data: dataLines.join("\n") });
        }
      }
      return { events, rest };
    },
    [],
  );

  // ─── sendMessage ────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (content: ContentBlock[], tierHint?: ChatTier): Promise<void> => {
      if (conversationId == null) {
        const err = new Error("No active conversation");
        onErrorRef.current?.(err);
        return;
      }
      if (streaming) {
        clientLogger.warn(
          "[useSoleneChat] sendMessage called while streaming; ignoring",
        );
        return;
      }

      // Optimistic user message.
      setMessages((prev) => [
        ...prev,
        {
          id: "pending",
          role: "user",
          content,
          sentAt: new Date(),
        },
      ]);
      setStreaming(true);
      setPendingApproval(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `/api/founder/solene-chat/conversations/${conversationId}/messages`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            credentials: "include",
            body: JSON.stringify({
              userMessage: content,
              ...(tierHint ? { tierHint } : {}),
            }),
            signal: controller.signal,
          },
        );

        if (!res.ok || !res.body) {
          throw new Error(`Stream failed: HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseSseBuffer(buffer);
          buffer = rest;
          for (const ev of events) {
            let parsed: Record<string, unknown> = {};
            try {
              parsed = JSON.parse(ev.data) as Record<string, unknown>;
            } catch (err) {
              clientLogger.warn(
                "[useSoleneChat] failed to parse SSE data",
                String(err),
              );
              continue;
            }
            handleEvent(ev.event, parsed);
          }
        }

        // Refetch persisted history so pending ids → real ids.
        await refetchHistory();
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") {
          clientLogger.info("[useSoleneChat] sendMessage aborted");
          setStreaming(false);
          return;
        }
        const error = err instanceof Error ? err : new Error(String(err));
        clientLogger.error("[useSoleneChat] sendMessage failed", error);
        onErrorRef.current?.(error);
        setMessages((prev) =>
          withUpdatedPending(prev, (m) => ({
            ...m,
            isStreaming: false,
            errorMessage: error.message,
          })),
        );
        setStreaming(false);
      } finally {
        abortRef.current = null;
      }
    },
    [conversationId, streaming, handleEvent, parseSseBuffer, refetchHistory],
  );

  // ─── approveTool ────────────────────────────────────────────────────────
  const approveTool = useCallback(
    async (token: string, decision: "approve" | "reject"): Promise<void> => {
      if (conversationId == null) return;
      try {
        const res = await fetch(
          `/api/founder/solene-chat/conversations/${conversationId}/approve-tool`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ approvalToken: token, decision }),
          },
        );
        if (!res.ok) {
          throw new Error(`approve-tool failed: HTTP ${res.status}`);
        }
        setPendingApproval(null);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        clientLogger.error("[useSoleneChat] approveTool failed", error);
        onErrorRef.current?.(error);
      }
    },
    [conversationId],
  );

  // ─── abortCurrentTurn ───────────────────────────────────────────────────
  const abortCurrentTurn = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  return {
    messages,
    loading,
    streaming,
    pendingApproval,
    sendMessage,
    approveTool,
    abortCurrentTurn,
    refetchHistory,
    totalCostUsd,
  };
}
