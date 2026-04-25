/**
 * AgentTeamChat — Sovereign Company Protocol v3
 *
 * iMessage-style chat interface for the CEO to talk to their AI team.
 * Messages are routed to the right agent based on content.
 * Agent responses come in colored bubbles matching their theme.
 *
 * Philosophy: Texting your executive team, not operating a dashboard.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";
import { AGENT_AVATARS, AGENT_ROLES, AGENT_COLORS } from "@/lib/trust-language";

interface ChatMessage {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  agentCodename?: string;
  timestamp: string;
}

const AGENT_BUBBLE_CLASSES: Record<string, string> = {
  blue: "bg-blue-50 dark:bg-blue-950/40 border-blue-100 dark:border-blue-900/30",
  emerald: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/30",
  amber: "bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/30",
  purple: "bg-purple-50 dark:bg-purple-950/40 border-purple-100 dark:border-purple-900/30",
  red: "bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900/30",
  slate: "bg-slate-50 dark:bg-slate-950/40 border-slate-100 dark:border-slate-900/30",
  indigo: "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-900/30",
  cyan: "bg-cyan-50 dark:bg-cyan-950/40 border-cyan-100 dark:border-cyan-900/30",
  orange: "bg-orange-50 dark:bg-orange-950/40 border-orange-100 dark:border-orange-900/30",
  pink: "bg-pink-50 dark:bg-pink-950/40 border-pink-100 dark:border-pink-900/30",
};

/** Simple keyword-based agent routing */
function detectAgent(text: string): string {
  const lower = text.toLowerCase();
  if (/revenue|mrr|churn|subscription|pricing|cancel/i.test(lower)) return "forge_revenue";
  if (/support|ticket|customer|onboard|help/i.test(lower)) return "sophie_csm";
  if (/job|server|deploy|infrastructure|uptime|health/i.test(lower)) return "sentinel_devops";
  if (/market|campaign|seo|content|brand|lead gen/i.test(lower)) return "beacon_marketing";
  if (/cost|spend|budget|finance|invoice/i.test(lower)) return "ledger_finance";
  if (/metric|data|analytics|growth|signup/i.test(lower)) return "oracle_analytics";
  if (/roadmap|feature|product|backlog|sprint/i.test(lower)) return "compass_pm";
  if (/compliance|legal|privacy|terms/i.test(lower)) return "shield_legal";
  if (/test|quality|bug|error|regression/i.test(lower)) return "crucible_qa";
  if (/tech|code|architecture|database|api/i.test(lower)) return "atlas_cto";
  return "sophie_csm"; // Default to Sophie
}

/** Agent avatar row for selecting who to talk to */
function AgentSelector({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (agent: string | null) => void;
}) {
  const agents = [
    "forge_revenue", "sophie_csm", "sentinel_devops", "beacon_marketing",
    "oracle_analytics", "compass_pm", "atlas_cto", "ledger_finance",
    "shield_legal", "crucible_qa",
  ];

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto scrollbar-hide">
      <button
        onClick={() => onSelect(null)}
        className={`shrink-0 text-xs px-2 py-1 rounded-full transition-colors ${
          !selected ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Auto
      </button>
      {agents.map(agent => (
        <button
          key={agent}
          onClick={() => onSelect(agent === selected ? null : agent)}
          className={`shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors ${
            agent === selected ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"
          }`}
          title={AGENT_ROLES[agent]}
        >
          <span className="text-sm">{AGENT_AVATARS[agent]}</span>
          <span className="hidden sm:inline">{AGENT_ROLES[agent]}</span>
        </button>
      ))}
    </div>
  );
}

const CHAT_STORAGE_KEY = "acreos_chat_history";
const MAX_STORED_MESSAGES = 100;

function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(-MAX_STORED_MESSAGES);
    }
  } catch {}
  return [];
}

function saveMessages(messages: ChatMessage[]) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {}
}

export function AgentTeamChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages);
  const [input, setInput] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasLoadedServer = useRef(false);

  // Try loading chat history from server on first mount
  useEffect(() => {
    if (hasLoadedServer.current) return;
    hasLoadedServer.current = true;

    fetch("/api/founder/intelligence/chat-history")
      .then((res) => {
        if (!res.ok) throw new Error("not available");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data?.messages) && data.messages.length > 0) {
          setMessages((prev) => {
            // Merge server history with local, deduplicating by id
            const existingIds = new Set(prev.map((m) => m.id));
            const newMsgs = data.messages.filter((m: ChatMessage) => !existingIds.has(m.id));
            const merged = [...newMsgs, ...prev].slice(-MAX_STORED_MESSAGES);
            saveMessages(merged);
            return merged;
          });
        }
      })
      .catch(() => {
        // Server endpoint not available — local persistence is sufficient
      });
  }, []);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages]);

  const sendMessage = useMutation({
    mutationFn: async (text: string) => {
      const agent = selectedAgent || detectAgent(text);
      const res = await apiRequest("POST", "/api/founder/intelligence/agent-chat", {
        agentCodename: agent,
        message: text,
      });
      return res.json();
    },
    onMutate: (text) => {
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMsg]);
      setInput("");
    },
    onSuccess: (data) => {
      const agentMsg: ChatMessage = {
        id: data.messageId || `agent-${Date.now()}`,
        role: "assistant",
        content: data.response || data.message || "I'll look into that.",
        agentCodename: data.agentCodename,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, agentMsg]);
    },
    onError: () => {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: "Sorry, I couldn't process that right now. Try again in a moment.",
        agentCodename: "sophie_csm",
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sendMessage.isPending) return;
    sendMessage.mutate(input.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Agent selector */}
      <AgentSelector selected={selectedAgent} onSelect={setSelectedAgent} />

      {/* Messages area */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-label="Agent team conversation"
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px]"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <span className="text-3xl mb-3">💬</span>
            <p className="text-sm font-medium text-foreground">Talk to your team</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
              Ask about revenue, support tickets, infrastructure — they'll respond with live data.
            </p>
          </div>
        )}

        <AnimatePresence>
          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-end"
                >
                  <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5">
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                  </div>
                </motion.div>
              );
            }

            const agent = msg.agentCodename || "sophie_csm";
            const color = AGENT_COLORS[agent] || "slate";
            const bubbleClass = AGENT_BUBBLE_CLASSES[color] || AGENT_BUBBLE_CLASSES.slate;

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-2"
              >
                <span className="text-lg mt-1 shrink-0">{AGENT_AVATARS[agent]}</span>
                <div className={`max-w-[80%] border rounded-2xl rounded-bl-md px-4 py-2.5 ${bubbleClass}`}>
                  <p className="text-[10px] font-medium text-muted-foreground mb-1">
                    {AGENT_ROLES[agent]}
                  </p>
                  <p className="text-sm text-foreground leading-relaxed">{msg.content}</p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {sendMessage.isPending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-muted-foreground"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            <span className="text-xs">Thinking…</span>
          </motion.div>
        )}
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="border-t bg-card p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedAgent
              ? `Ask ${AGENT_ROLES[selectedAgent]}…`
              : "Ask your team anything…"
            }
            rows={1}
            autoCapitalize="sentences"
            aria-label="Message your agent team"
            className="flex-1 resize-none rounded-xl border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[40px] max-h-[120px]"
          />
          <Button
            type="submit"
            size="icon"
            className="shrink-0 rounded-xl h-10 w-10"
            disabled={!input.trim() || sendMessage.isPending}
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
