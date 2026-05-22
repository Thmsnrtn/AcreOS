/**
 * MessageBubble — single user or assistant message.
 *
 * - User: right-aligned, brand-soft background, slight tail on bottom-right.
 * - Assistant: left-aligned, plain background, with artifacts stacked
 *   below any plain text. Tool calls render as a compact list above
 *   the artifacts so Tom can see what Atlas just touched.
 *
 * Apple-grade: REVEAL_FROM_BELOW entrance, ambient ThinkingDots on
 * running tool calls (no spinner), 16pt bubble corners with one tail.
 */
import { motion } from "framer-motion";
import { Check, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactRenderer } from "@/components/founder-chat/ArtifactRenderer";
import { TextArtifact } from "@/components/founder-chat/artifacts/text";
import { ThinkingDots } from "@/components/founder-chat/ThinkingDots";
import { REVEAL_FROM_BELOW } from "@/lib/motion";
import type { ChatMessage } from "@shared/founder-chat/artifacts";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={REVEAL_FROM_BELOW.initial}
      animate={REVEAL_FROM_BELOW.animate}
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
      data-testid={`message-${message.role}-${message.id}`}
    >
      <div
        className={cn(
          "max-w-[90%] sm:max-w-[80%] md:max-w-[75%] space-y-2",
          isUser && "items-end",
        )}
      >
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tool calls">
            {message.toolCalls.map((call, idx) => (
              <li
                key={idx}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono tabular-nums",
                  call.status === "running" && "bg-muted/60 text-muted-foreground",
                  call.status === "complete" && "bg-acr-pos-soft text-acr-pos",
                  call.status === "failed" && "bg-acr-neg-soft text-acr-neg",
                )}
              >
                {call.status === "running" && <ThinkingDots size="sm" />}
                {call.status === "complete" && (
                  <Check className="w-2.5 h-2.5" aria-hidden="true" strokeWidth={2} />
                )}
                {call.status === "failed" && (
                  <XCircle className="w-2.5 h-2.5" aria-hidden="true" strokeWidth={2} />
                )}
                {call.name}
              </li>
            ))}
          </ul>
        )}

        {message.text && (
          <div
            className={cn(
              "px-4 py-2.5 text-sm leading-relaxed",
              isUser
                ? "bg-acr-brand-soft text-foreground rounded-2xl rounded-br-md"
                : "bg-muted/40 text-foreground rounded-2xl rounded-bl-md",
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.text}</p>
            ) : (
              <TextArtifact markdown={message.text} />
            )}
          </div>
        )}

        {message.artifacts && message.artifacts.length > 0 && (
          <div className="space-y-2">
            {message.artifacts.map((art, idx) => (
              <ArtifactRenderer key={idx} artifact={art} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default MessageBubble;
