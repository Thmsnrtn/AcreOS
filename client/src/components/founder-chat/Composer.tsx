/**
 * Composer — the founder-chat input.
 *
 * - Auto-grow textarea (1-8 visible lines).
 * - Send button (right-aligned). Cmd/Ctrl+Enter to send on desktop.
 * - Voice button (disabled placeholder — Phase D wires it).
 * - Slash-command opener: typing "/" at the start of the input opens a
 *   popover with matching aliases from `slashTools`. Arrow keys to
 *   navigate, Enter to insert, Esc to dismiss.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Mic, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterSlashTools, type SlashTool } from "@/components/founder-chat/slash-tools";
import { REVEAL_FROM_BELOW, SPRING_INTERACTIVE, TAP_PRESS } from "@/lib/motion";
import { RADIUS_CARD, TOUCH_TARGET_PT } from "@/lib/spacing";

interface ComposerProps {
  onSubmit: (text: string) => void | Promise<void>;
  disabled?: boolean;
  /** Optional placeholder text. */
  placeholder?: string;
}

const MAX_ROWS = 8;
const MIN_ROWS = 1;

export function Composer({ onSubmit, disabled, placeholder }: ComposerProps) {
  const [text, setText] = useState("");
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Slash-command query (only when the input starts with "/").
  const slashQuery = useMemo(() => {
    if (!text.startsWith("/")) return null;
    const first = text.slice(1).split(/\s/)[0] ?? "";
    return first;
  }, [text]);

  const slashMatches: SlashTool[] = useMemo(() => {
    if (slashQuery === null) return [];
    return filterSlashTools(slashQuery, 8);
  }, [slashQuery]);

  useEffect(() => {
    setSlashOpen(slashQuery !== null && slashMatches.length > 0);
    setSlashIdx(0);
  }, [slashQuery, slashMatches.length]);

  // Auto-grow.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = 20; // matches text-sm leading-relaxed roughly
    const cap = MAX_ROWS * lineHeight + 16;
    ta.style.height = Math.min(ta.scrollHeight, cap) + "px";
  }, [text]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    void onSubmit(trimmed);
    setText("");
    setSlashOpen(false);
  };

  const insertSlash = (tool: SlashTool) => {
    setText(`/${tool.alias} `);
    setSlashOpen(false);
    taRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash navigation
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIdx((i) => Math.min(slashMatches.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const match = slashMatches[slashIdx];
        if (match) insertSlash(match);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && slashOpen) {
        // If the user is mid-slash and presses Enter, prefer inserting
        // the highlighted alias over sending.
        const match = slashMatches[slashIdx];
        if (match && text === `/${slashQuery}`) {
          e.preventDefault();
          insertSlash(match);
          return;
        }
      }
    }

    // Cmd/Ctrl+Enter on desktop sends.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
      return;
    }
  };

  const canSend = !disabled && text.trim().length > 0;

  return (
    <div
      className="relative border-t border-border bg-background sticky bottom-0"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <AnimatePresence>
        {slashOpen && (
          <motion.div
            key="slash-popover"
            initial={REVEAL_FROM_BELOW.initial}
            animate={REVEAL_FROM_BELOW.animate}
            exit={REVEAL_FROM_BELOW.exit}
            className="absolute bottom-full left-0 right-0 mb-1 mx-2 sm:mx-3 z-20"
            role="listbox"
            aria-label="Slash commands"
            data-testid="slash-popover"
          >
            <ul
              className="border border-border bg-popover shadow-lg overflow-hidden"
              style={{ borderRadius: RADIUS_CARD }}
            >
              {slashMatches.map((tool, i) => (
                <li key={tool.alias}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === slashIdx}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors duration-200",
                      i === slashIdx ? "bg-acr-brand-soft/40" : "hover:bg-muted/60",
                    )}
                    style={{ minHeight: TOUCH_TARGET_PT }}
                    onMouseEnter={() => setSlashIdx(i)}
                    onClick={() => insertSlash(tool)}
                    data-testid={`slash-option-${tool.alias}`}
                  >
                    <span className="font-mono text-xs text-acr-brand tabular-nums">
                      /{tool.alias}
                    </span>
                    {tool.argsHint && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {tool.argsHint}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-2 truncate">
                      {tool.description}
                    </span>
                    {tool.destructive && (
                      <Badge
                        variant="secondary"
                        className="ml-auto text-[10px] bg-acr-warn-soft text-acr-warn border-transparent"
                      >
                        destructive
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      <form
        className="flex items-end gap-2 px-2 sm:px-3 py-2 sm:py-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <Label htmlFor="atlas-composer" className="sr-only">
          Message Atlas
        </Label>
        <motion.button
          type="button"
          disabled
          title="Voice (coming in Phase D)"
          aria-label="Voice input (not yet available)"
          className={cn(
            "shrink-0 inline-flex items-center justify-center rounded-full text-muted-foreground",
            "disabled:opacity-50",
          )}
          style={{ width: TOUCH_TARGET_PT, height: TOUCH_TARGET_PT }}
          data-testid="composer-voice"
        >
          <Mic className="w-4 h-4" aria-hidden="true" strokeWidth={1.5} />
        </motion.button>
        <textarea
          id="atlas-composer"
          ref={taRef}
          rows={MIN_ROWS}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "Message Atlas… (type / for commands)"}
          disabled={disabled}
          className={cn(
            "flex-1 resize-none border border-border bg-background",
            "px-3 py-2 text-sm leading-relaxed",
            "focus:outline-none focus:ring-2 focus:ring-acr-brand/40",
            "transition-shadow duration-200",
            "disabled:opacity-60",
          )}
          style={{ borderRadius: RADIUS_CARD, minHeight: TOUCH_TARGET_PT }}
          data-testid="composer-textarea"
          aria-describedby="atlas-composer-hint"
        />
        <motion.button
          type="submit"
          disabled={!canSend}
          aria-label="Send message"
          whileTap={canSend ? TAP_PRESS : undefined}
          whileHover={canSend ? { scale: 1.02 } : undefined}
          transition={SPRING_INTERACTIVE}
          className={cn(
            "shrink-0 inline-flex items-center justify-center rounded-full",
            "text-primary-foreground",
            canSend ? "bg-acr-brand shadow-sm" : "bg-muted text-muted-foreground",
            "disabled:cursor-not-allowed",
          )}
          style={{ width: TOUCH_TARGET_PT, height: TOUCH_TARGET_PT }}
          data-testid="composer-send"
        >
          <Send className="w-4 h-4" aria-hidden="true" strokeWidth={1.75} />
        </motion.button>
      </form>
      <p
        id="atlas-composer-hint"
        className="hidden sm:block px-3 pb-2 text-[10px] text-muted-foreground"
      >
        Press <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">⌘</kbd>
        <kbd className="ml-0.5 px-1 py-0.5 rounded bg-muted font-mono text-[10px]">Enter</kbd> to send · type{" "}
        <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">/</kbd> for commands
      </p>
    </div>
  );
}

export default Composer;
