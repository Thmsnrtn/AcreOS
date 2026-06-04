/**
 * ToolUseBlock — renders an assistant tool_use call (name + collapsible
 * JSON input), styled like the iOS Claude app's tool invocation card.
 */
import React, { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentBlock } from "@shared/schema/solene-conversations";

type ToolUseBlockType = Extract<ContentBlock, { type: "tool_use" }>;

interface ToolUseBlockProps {
  block: ToolUseBlockType;
  pending?: boolean;
}

export function ToolUseBlock({ block, pending }: ToolUseBlockProps) {
  const [open, setOpen] = useState(false);
  const inputJson = (() => {
    try {
      return JSON.stringify(block.input, null, 2);
    } catch {
      return "[unserializable input]";
    }
  })();

  return (
    <div
      className="mt-2 rounded-md border border-border bg-muted/30"
      data-testid="tool-use-block"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <Wrench className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden="true" />
        <code className="font-mono text-foreground truncate">{block.name}</code>
        {pending ? (
          <span className="ml-auto text-[10px] text-muted-foreground">
            running…
          </span>
        ) : null}
      </button>
      <div
        className={cn(
          "px-3 pb-3 border-t border-border/40",
          open ? "block" : "hidden",
        )}
      >
        <pre className="text-xs overflow-x-auto font-mono text-muted-foreground mt-2">
          <code>{inputJson}</code>
        </pre>
      </div>
    </div>
  );
}
