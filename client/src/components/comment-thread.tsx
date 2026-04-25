import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MessageCircle, Send, Trash2, Loader2, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { fadeInUp } from "@/lib/animations";

interface Comment {
  id: number;
  userId: string;
  content: string;
  mentions: string[];
  createdAt: string;
}

interface CommentsPage {
  comments: Comment[];
  nextCursor: number | null;
  hasMore: boolean;
}

interface CommentThreadProps {
  entityType: "lead" | "deal" | "property" | "note";
  entityId: number;
  currentUserId?: string;
}

function CommentBubble({
  comment,
  isOwn,
  onDelete,
}: {
  comment: Comment;
  isOwn: boolean;
  onDelete?: () => void;
}) {
  const time = new Date(comment.createdAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Render @mentions as highlighted
  const renderContent = (content: string) => {
    return content.replace(/@([a-zA-Z0-9_-]+)/g, (match) => match);
  };

  return (
    <motion.div
      variants={fadeInUp}
      initial="hidden"
      animate="visible"
      className={`group flex items-start gap-2 ${isOwn ? "opacity-100" : ""}`}
    >
      {/* Avatar placeholder */}
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary shrink-0">
        {comment.userId.slice(0, 2).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{comment.userId}</span>
          <span className="text-[10px] text-muted-foreground">{time}</span>
          {isOwn && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm focus-visible:opacity-100"
              aria-label="Delete comment"
            >
              <Trash2 className="w-3 h-3 text-muted-foreground hover:text-red-500" aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="text-sm whitespace-pre-wrap break-words">
          {content(comment.content)}
        </p>
      </div>
    </motion.div>
  );
}

function content(text: string): React.ReactNode {
  // Highlight @mentions in the text
  const parts = text.split(/(@[a-zA-Z0-9_-]+)/g);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="text-primary font-medium">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function CommentThread({ entityType, entityId, currentUserId }: CommentThreadProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [showMentionSuggestions, setShowMentionSuggestions] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const queryKey = ["comments", entityType, entityId];

  // Count query (lightweight, for the badge)
  const { data: countData } = useQuery<{ comments: Comment[]; hasMore: boolean }>({
    queryKey: [...queryKey, "count"],
    queryFn: async () => {
      const res = await fetch(`/api/comments/${entityType}/${entityId}?limit=1`, { credentials: "include" });
      if (!res.ok) return { comments: [], hasMore: false };
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  // Full comments query (only when expanded)
  const {
    data: commentsData,
    fetchNextPage,
    hasNextPage,
    isLoading,
  } = useInfiniteQuery<CommentsPage>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const url = new URL(`/api/comments/${entityType}/${entityId}`, window.location.origin);
      if (pageParam) url.searchParams.set("cursor", String(pageParam));
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as number | undefined,
    enabled: isExpanded,
    staleTime: 15 * 1000,
  });

  const allComments = commentsData?.pages.flatMap((p) => p.comments).reverse() ?? [];

  const createMutation = useMutation({
    mutationFn: async (commentContent: string) => {
      const res = await apiRequest("POST", `/api/comments/${entityType}/${entityId}`, { content: commentContent });
      return res.json();
    },
    onSuccess: () => {
      setInput("");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: [...queryKey, "count"] });
    },
    onError: () => toast({ title: "Couldn't post comment", description: "Your draft is preserved. Try again or check the system status.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: number) => {
      await apiRequest("DELETE", `/api/comments/${commentId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: [...queryKey, "count"] });
    },
    onError: () => toast({ title: "Couldn't delete comment", description: "The comment is still on the thread. Try again.", variant: "destructive" }),
  });

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    createMutation.mutate(trimmed);
  }, [input, createMutation]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "@") {
        setShowMentionSuggestions(true);
      } else if (e.key === " " || e.key === "Escape") {
        setShowMentionSuggestions(false);
      }
    },
    [handleSubmit],
  );

  const commentCount = countData?.comments?.length ?? allComments.length;

  // Collapsed pill
  if (!isExpanded) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        aria-expanded={false}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-card hover:bg-accent transition-colors text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={commentCount === 1 ? "1 comment, open" : `${commentCount} comments, open`}
      >
        <MessageCircle className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="font-medium">{commentCount > 0 ? commentCount : ""}</span>
      </button>
    );
  }

  // Expanded thread
  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-semibold">Comments</span>
        <button type="button" onClick={() => setIsExpanded(false)} aria-label="Close comments" className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
          <X className="w-4 h-4 text-muted-foreground hover:text-foreground" aria-hidden="true" />
        </button>
      </div>

      {/* Scrollable comment list */}
      <div className="max-h-64 overflow-y-auto p-3 space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-2">
                <Skeleton className="w-7 h-7 rounded-full" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : allComments.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-2">No comments yet. Start the conversation.</p>
        ) : (
          <>
            {hasNextPage && (
              <button
                type="button"
                onClick={() => fetchNextPage()}
                className="text-xs text-primary hover:underline w-full text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                Load older comments
              </button>
            )}
            <AnimatePresence>
              {allComments.map((comment) => (
                <CommentBubble
                  key={comment.id}
                  comment={comment}
                  isOwn={comment.userId === currentUserId}
                  onDelete={
                    comment.userId === currentUserId
                      ? () => deleteMutation.mutate(comment.id)
                      : undefined
                  }
                />
              ))}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-2 flex gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment... Use @ to mention"
          className="flex-1 resize-none text-sm bg-transparent border-0 focus:outline-none focus:ring-0 min-h-[32px] max-h-[80px] p-1"
          rows={1}
        />
        <Button
          size="icon"
          variant="ghost"
          onClick={handleSubmit}
          disabled={!input.trim() || createMutation.isPending}
          aria-label="Send comment"
        >
          {createMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
