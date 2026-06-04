/**
 * MessageBubble — single chat message renderer (iOS-Claude-app fidelity).
 *
 * Role styling:
 *   - user:      right-aligned, primary-tinted bubble
 *   - assistant: left-aligned, neutral surface, streaming cursor when active
 *   - tool:      collapsible code-block-style panel
 *   - system:    small italic muted line
 *
 * Markdown rendering uses Tailwind `prose` typography so we don't pull in
 * a markdown library — the conversation contents are mostly plain prose +
 * the occasional code fence, and `<pre><code>` blocks are styled separately.
 */
import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, ChevronRight } from "lucide-react";
import type { UiMessage } from "@/hooks/useSoleneChat";
import type { ContentBlock } from "@shared/schema/solene-conversations";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolUseBlock } from "./ToolUseBlock";
import { ToolResultBlock } from "./ToolResultBlock";

interface MessageBubbleProps {
  message: UiMessage;
}

function getTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
}

/**
 * Render text content with code-fence awareness. We split on triple-backtick
 * fences and wrap them in <pre><code> with prose styling; everything else
 * is paragraph text (one <p> per double-newline-separated chunk).
 */
function MarkdownText({ text }: { text: string }) {
  const segments = useMemo(() => {
    const parts: { kind: "text" | "code"; body: string; lang?: string }[] = [];
    const regex = /```(\w+)?\n?([\s\S]*?)```/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      if (m.index > lastIdx) {
        parts.push({ kind: "text", body: text.slice(lastIdx, m.index) });
      }
      parts.push({ kind: "code", body: m[2] ?? "", lang: m[1] });
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) {
      parts.push({ kind: "text", body: text.slice(lastIdx) });
    }
    return parts;
  }, [text]);

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      {segments.map((seg, i) =>
        seg.kind === "code" ? (
          <pre
            key={i}
            className="rounded-md bg-muted/60 border border-border p-3 overflow-x-auto text-xs"
          >
            <code className="font-mono">{seg.body}</code>
          </pre>
        ) : (
          seg.body.split(/\n{2,}/).map((para, j) => (
            <p key={`${i}-${j}`} className="whitespace-pre-wrap leading-relaxed">
              {para}
            </p>
          ))
        ),
      )}
    </div>
  );
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === "system") {
    const text = getTextFromBlocks(message.content);
    return (
      <div
        className="text-xs italic text-muted-foreground text-center py-2"
        data-testid="message-system"
      >
        {text}
      </div>
    );
  }

  if (message.role === "tool") {
    return (
      <div className="px-2 md:px-4" data-testid="message-tool">
        {message.content.map((block, i) =>
          block.type === "tool_result" ? (
            <ToolResultBlock key={i} block={block} />
          ) : null,
        )}
      </div>
    );
  }

  const isUser = message.role === "user";
  const text = getTextFromBlocks(message.content);
  const toolUseBlocks = message.content.filter(
    (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
  );

  return (
    <div
      className={cn(
        "flex w-full px-2 md:px-4",
        isUser ? "justify-end" : "justify-start",
      )}
      aria-busy={message.isStreaming ? true : undefined}
      data-testid={isUser ? "message-user" : "message-assistant"}
    >
      <div
        className={cn(
          "max-w-[88%] md:max-w-[78%] rounded-2xl px-4 py-3 shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted/40 text-foreground rounded-tl-sm border border-border/60",
        )}
      >
        {message.thinking ? (
          <ThinkingBlock
            text={message.thinking}
            autoOpen={!!message.isStreaming}
          />
        ) : null}

        {text ? <MarkdownText text={text} /> : null}

        {toolUseBlocks.map((block, i) => (
          <ToolUseBlock key={`${block.id}-${i}`} block={block} />
        ))}

        {message.isStreaming && !text && toolUseBlocks.length === 0 ? (
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            aria-label="Solene is responding"
          >
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            <span>Thinking…</span>
          </div>
        ) : null}

        {message.isStreaming && text ? (
          <span
            className="inline-block w-1.5 h-4 bg-foreground/60 align-middle ml-0.5 animate-pulse"
            aria-hidden="true"
          />
        ) : null}

        {message.errorMessage ? (
          <p
            className="mt-2 text-xs text-destructive flex items-center gap-1"
            role="alert"
          >
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
            {message.errorMessage}
          </p>
        ) : null}

        {!isUser && !message.isStreaming && message.modelUsed ? (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/70">
            <span>{message.modelUsed}</span>
            {message.estimatedCostUsd != null ? (
              <span aria-label="estimated cost">
                · ${message.estimatedCostUsd.toFixed(4)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
