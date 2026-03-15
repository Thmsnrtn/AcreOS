import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaxThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export function PaxThinkingBlock({ content, isStreaming }: PaxThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const preview = content.split("\n")[0]?.slice(0, 80) ?? "";

  return (
    <div className="border-l-2 border-primary/20 pl-2.5 mb-1 rounded-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left group"
      >
        <Brain
          className={cn(
            "w-3 h-3 flex-shrink-0",
            isStreaming ? "text-primary animate-pulse" : "text-muted-foreground/60"
          )}
        />
        <span className="text-[10px] text-muted-foreground/70 italic font-medium">
          {isStreaming ? "Pax is reasoning…" : "How Pax reasoned"}
        </span>
        {!isStreaming && (
          expanded
            ? <ChevronDown className="w-3 h-3 text-muted-foreground/40 ml-auto" />
            : <ChevronRight className="w-3 h-3 text-muted-foreground/40 ml-auto" />
        )}
      </button>

      {!expanded && !isStreaming && preview && (
        <p className="text-[10px] text-muted-foreground/50 italic truncate mt-0.5">
          {preview}…
        </p>
      )}

      {(expanded || isStreaming) && content && (
        <pre className="text-[10px] text-muted-foreground/60 italic font-mono whitespace-pre-wrap mt-1 leading-relaxed">
          {content}
          {isStreaming && (
            <span className="inline-block w-0.5 h-3 bg-primary/50 ml-0.5 animate-pulse align-text-bottom" />
          )}
        </pre>
      )}
    </div>
  );
}
