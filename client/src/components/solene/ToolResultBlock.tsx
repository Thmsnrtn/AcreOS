/**
 * ToolResultBlock — collapsible content with first 200 chars preview.
 *
 * Error-tinted border when block.is_error is true.
 */
import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentBlock } from "@shared/schema/solene-conversations";

type ToolResultBlockType = Extract<ContentBlock, { type: "tool_result" }>;

interface ToolResultBlockProps {
  block: ToolResultBlockType;
}

const PREVIEW_CHARS = 200;

function contentToString(c: ToolResultBlockType["content"]): string {
  if (typeof c === "string") return c;
  return c
    .map((b) =>
      b.type === "text"
        ? b.text
        : b.type === "tool_use"
          ? `[tool_use:${b.name}]`
          : `[tool_result]`,
    )
    .join("\n");
}

export function ToolResultBlock({ block }: ToolResultBlockProps) {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => contentToString(block.content), [block.content]);
  const preview = text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) : text;
  const isLong = text.length > PREVIEW_CHARS;

  return (
    <div
      className={cn(
        "mt-2 rounded-md border bg-muted/30",
        block.is_error ? "border-destructive/60" : "border-border",
      )}
      data-testid="tool-result-block"
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
        <FileText
          className={cn(
            "h-3 w-3 shrink-0",
            block.is_error ? "text-destructive" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        <span className="font-mono text-foreground">
          {block.is_error ? "Tool error" : "Tool result"}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {text.length} chars
        </span>
      </button>
      <div className={cn("px-3 pb-3", open ? "block" : "hidden")}>
        <pre className="text-xs overflow-x-auto font-mono text-muted-foreground whitespace-pre-wrap mt-2">
          <code>{open ? text : preview}</code>
        </pre>
        {!open && isLong ? (
          <p className="text-[10px] text-muted-foreground mt-1">
            Showing first {PREVIEW_CHARS} chars · click to expand
          </p>
        ) : null}
      </div>
    </div>
  );
}
