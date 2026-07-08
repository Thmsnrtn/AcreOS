/**
 * MessageList — vertical scroll container that auto-scrolls to the bottom on
 * new content.
 *
 * Behavioral subtlety: we only auto-scroll when the user was already
 * "near the bottom" — otherwise we let them keep their reading position
 * intact while a long answer streams in. (iOS Claude does the same.)
 *
 * F3b (experience-legibility receipts): instead of rendering every row as a
 * bubble, messages are segmented via buildRenderItems — tool activity
 * collapses behind a "Show the work (N steps)" disclosure, tool-output
 * carrier rows never render as bubbles, and successful artifact-creating
 * calls surface as receipt chips under the reply.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import { ShowTheWork } from "./ShowTheWork";
import { ReceiptChips } from "./ReceiptChips";
import { buildRenderItems } from "./chatWork";
import { EmptyState } from "@/components/empty-state";
import { Sparkles } from "lucide-react";
import type { UiMessage } from "@/hooks/useSoleneChat";

interface MessageListProps {
  messages: UiMessage[];
  loading?: boolean;
}

const STICK_THRESHOLD_PX = 120;

export function MessageList({ messages, loading }: MessageListProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const wasNearBottomRef = useRef(true);
  const items = useMemo(() => buildRenderItems(messages), [messages]);
  const anyStreaming = messages.some((m) => m.isStreaming);

  // Track distance to bottom before each render so we can decide whether
  // to auto-scroll after the new content paints.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const distance =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
    wasNearBottomRef.current = distance < STICK_THRESHOLD_PX;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  if (!loading && messages.length === 0) {
    return (
      <div
        ref={ref}
        className="flex-1 overflow-y-auto flex items-center justify-center p-4"
      >
        <EmptyState
          icon={Sparkles}
          headline="Start a conversation"
          subtitle="Ask Solene about the company, dispatches, capital, or anything else on your mind."
          cta={{ label: "", _noOp: true }}
        />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="flex-1 overflow-y-auto py-4 space-y-3"
      role="log"
      aria-live="polite"
      aria-label="Conversation messages"
      data-testid="message-list"
    >
      {items.map((item, i) =>
        item.kind === "message" ? (
          <MessageBubble
            key={`${item.message.id}-${i}`}
            message={item.message}
            hideToolBlocks
          />
        ) : item.kind === "work" ? (
          <ShowTheWork
            key={`work-${i}`}
            steps={item.steps}
            streaming={anyStreaming && i === items.length - 1}
          />
        ) : (
          <ReceiptChips key={`receipts-${i}`} receipts={item.receipts} />
        ),
      )}
    </div>
  );
}
