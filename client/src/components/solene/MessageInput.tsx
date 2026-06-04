/**
 * MessageInput — multi-line auto-growing input + send + tier hint.
 *
 * Keyboard contract (iOS-Claude parity):
 *   - Enter         → newline
 *   - Cmd/Ctrl+Enter → send
 *   - Escape        → clear current draft (when not streaming)
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Send, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ContentBlock } from "@shared/schema/solene-conversations";
import type { ChatTier } from "@shared/schema/solene-chat-config";

const TIER_OPTIONS: { value: "auto" | ChatTier; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "strategic", label: "Strategic" },
  { value: "conversational", label: "Conversational" },
  { value: "fast", label: "Fast" },
  { value: "code", label: "Code" },
];

interface MessageInputProps {
  onSend: (content: ContentBlock[], tierHint?: ChatTier) => Promise<void>;
  onAbort?: () => void;
  disabled?: boolean;
  streaming?: boolean;
  placeholder?: string;
}

export function MessageInput({
  onSend,
  onAbort,
  disabled,
  streaming,
  placeholder,
}: MessageInputProps) {
  const [draft, setDraft] = useState("");
  const [tier, setTier] = useState<"auto" | ChatTier>("auto");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 280);
    el.style.height = `${next}px`;
  }, [draft]);

  const submit = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || disabled) return;
    const content: ContentBlock[] = [{ type: "text", text: trimmed }];
    const hint = tier === "auto" ? undefined : tier;
    setDraft("");
    await onSend(content, hint);
  }, [draft, disabled, tier, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void submit();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (!streaming) setDraft("");
      }
    },
    [submit, streaming],
  );

  // Focus on mount.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div
      className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 p-3 md:p-4"
      data-testid="solene-message-input"
    >
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "Message Solene…"}
            aria-label="Message Solene"
            disabled={disabled}
            rows={1}
            className={cn(
              "min-h-[44px] resize-none flex-1",
              "bg-background border-input",
            )}
          />
          {streaming && onAbort ? (
            <Button
              type="button"
              onClick={onAbort}
              variant="outline"
              size="icon"
              aria-label="Stop generating"
              className="min-h-[44px] min-w-[44px] shrink-0"
              data-testid="button-stop-stream"
            >
              <StopCircle className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={disabled || draft.trim().length === 0}
              size="icon"
              aria-label="Send message"
              className="min-h-[44px] min-w-[44px] shrink-0"
              data-testid="button-send-message"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <label htmlFor="tier-select" className="sr-only">
              Routing tier hint
            </label>
            <Select
              value={tier}
              onValueChange={(v) => setTier(v as "auto" | ChatTier)}
              disabled={disabled}
            >
              <SelectTrigger
                id="tier-select"
                className="h-7 w-[140px] text-xs"
                aria-label="Routing tier hint"
                data-testid="select-tier-hint"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span aria-hidden="true" className="hidden md:inline">
            Cmd+Enter to send
          </span>
        </div>
      </div>
    </div>
  );
}
