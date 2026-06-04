/**
 * ThinkingBlock — collapsible "Solene is thinking…" panel.
 *
 * Subtle visual treatment (italic, muted). Auto-expands during streaming
 * (autoOpen=true) and auto-collapses once streaming completes.
 */
import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  text: string;
  autoOpen?: boolean;
}

export function ThinkingBlock({ text, autoOpen }: ThinkingBlockProps) {
  const [open, setOpen] = useState(!!autoOpen);

  // Auto-collapse once streaming finishes (autoOpen flips to false).
  useEffect(() => {
    if (!autoOpen) setOpen(false);
    else setOpen(true);
  }, [autoOpen]);

  if (!text) return null;

  return (
    <div
      className="mb-2 rounded-md border border-border/60 bg-muted/30"
      data-testid="thinking-block"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        aria-expanded={open}
        aria-controls="thinking-block-content"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
        <Brain className="h-3 w-3" aria-hidden="true" />
        <span className="italic">
          {autoOpen ? "Thinking…" : "Thought process"}
        </span>
      </button>
      <div
        id="thinking-block-content"
        className={cn(
          "px-3 pb-2 text-xs italic text-muted-foreground whitespace-pre-wrap leading-relaxed",
          open ? "block" : "hidden",
        )}
      >
        {text}
      </div>
    </div>
  );
}
