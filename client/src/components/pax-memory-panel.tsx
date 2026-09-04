// PaxMemoryPanel — view and manage what Pax remembers about your org
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainCircuit, X, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { relative } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiMemory {
  id: number;
  memoryType: string;
  content: string;
  key?: string | null;
  importance: number | null;
  createdAt: string;
}

interface MemoryResponse {
  memories: AiMemory[];
}

export interface PaxMemoryPanelProps {
  /** Primary open-state prop (spec). Also accepts legacy `open` alias. */
  isOpen?: boolean;
  /** Legacy alias — accepted for backward compatibility with pax-copilot-rail */
  open?: boolean;
  onClose: () => void;
  orgId?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Canonical grouping: normalize memoryType to display group
const GROUP_META: Record<string, { label: string; badgeClass: string }> = {
  preference: {
    label: "Preferences",
    badgeClass: "bg-acr-accent/10 text-acr-accent border-acr-accent/20",
  },
  preferences: {
    label: "Preferences",
    badgeClass: "bg-acr-accent/10 text-acr-accent border-acr-accent/20",
  },
  fact: {
    label: "Facts",
    badgeClass: "bg-acr-brand/10 text-acr-brand border-acr-brand/20",
  },
  facts: {
    label: "Facts",
    badgeClass: "bg-acr-brand/10 text-acr-brand border-acr-brand/20",
  },
  insight: {
    label: "What Pax noticed",
    badgeClass: "bg-acr-pos/10 text-acr-pos border-acr-pos/20",
  },
  insights: {
    label: "What Pax noticed",
    badgeClass: "bg-acr-pos/10 text-acr-pos border-acr-pos/20",
  },
  procedure: {
    label: "Procedures",
    badgeClass: "bg-acr-warn/10 text-acr-warn border-acr-warn/20",
  },
  procedures: {
    label: "Procedures",
    badgeClass: "bg-acr-warn/10 text-acr-warn border-acr-warn/20",
  },
  decision: {
    label: "Decisions",
    badgeClass: "bg-acr-warn/10 text-acr-warn border-acr-warn/20",
  },
  contact: {
    label: "Contacts",
    badgeClass: "bg-acr-brand/10 text-acr-brand border-acr-brand/20",
  },
  correction: {
    label: "Corrections",
    badgeClass: "bg-acr-neg/10 text-acr-neg border-acr-neg/20",
  },
  reinforcement: {
    label: "Positive",
    badgeClass: "bg-acr-pos/10 text-acr-pos border-acr-pos/20",
  },
};

const GROUP_ORDER = [
  "preference",
  "preferences",
  "fact",
  "facts",
  "insight",
  "insights",
  "procedure",
  "procedures",
  "decision",
  "contact",
  "correction",
  "reinforcement",
];

function getGroupMeta(type: string): { label: string; badgeClass: string } {
  return (
    GROUP_META[type.toLowerCase()] ?? {
      label: type.charAt(0).toUpperCase() + type.slice(1),
      badgeClass: "bg-muted text-muted-foreground border-border",
    }
  );
}

// ─── MemoryCard ───────────────────────────────────────────────────────────────

function MemoryCard({
  memory,
  onDelete,
  isDeleting,
}: {
  memory: AiMemory;
  onDelete: (id: number) => void;
  isDeleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const TRUNCATE_LENGTH = 100;
  const isTruncatable = memory.content.length > TRUNCATE_LENGTH;
  const displayContent =
    isTruncatable && !expanded
      ? memory.content.slice(0, TRUNCATE_LENGTH) + "…"
      : memory.content;

  const meta = getGroupMeta(memory.memoryType);

  return (
    <div className="flex items-start gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 group hover:bg-muted/20 transition-colors">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className={cn("text-micro px-1.5 py-0", meta.badgeClass)}>
            {meta.label}
          </Badge>
          {memory.key && (
            <span className="text-micro font-mono text-muted-foreground truncate max-w-[140px]">
              {memory.key}
            </span>
          )}
        </div>
        <p className="text-xs text-foreground leading-snug">{displayContent}</p>
        {isTruncatable && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-0.5 text-micro text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" /> Show more
              </>
            )}
          </button>
        )}
        <p className="text-micro text-muted-foreground/60">
          {relative(memory.createdAt)}
        </p>
      </div>
      <button aria-label="Delete this memory"
        onClick={() => onDelete(memory.id)}
        disabled={isDeleting}
        className="text-muted-foreground/30 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 mt-0.5 flex-shrink-0 disabled:opacity-30"
        title="Delete memory"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── PaxMemoryPanel ───────────────────────────────────────────────────────────

export function PaxMemoryPanel({ isOpen, open, onClose, orgId }: PaxMemoryPanelProps) {
  // Support both `isOpen` (spec) and `open` (legacy alias used by pax-copilot-rail)
  const panelOpen = isOpen ?? open ?? false;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<MemoryResponse>({
    queryKey: ["/api/ai/memory"],
    enabled: panelOpen,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ai/memory/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ai/memory"] });
    },
  });

  const memories = data?.memories ?? [];

  // Group memories by memoryType
  const groups: Record<string, AiMemory[]> = {};
  for (const m of memories) {
    const t = m.memoryType ?? "fact";
    if (!groups[t]) groups[t] = [];
    groups[t].push(m);
  }

  // Sort groups by canonical order, then alphabetical for unknown types
  const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
    const ai = GROUP_ORDER.indexOf(a.toLowerCase());
    const bi = GROUP_ORDER.indexOf(b.toLowerCase());
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  // Deduplicate adjacent groups that map to same display label
  const seenLabels = new Set<string>();
  const dedupedGroups: Array<{ key: string; items: AiMemory[] }> = [];
  for (const key of sortedGroupKeys) {
    const label = getGroupMeta(key).label;
    if (!seenLabels.has(label)) {
      seenLabels.add(label);
      // Merge items with same label
      const allItemsForLabel = sortedGroupKeys
        .filter((k) => getGroupMeta(k).label === label)
        .flatMap((k) => groups[k] ?? []);
      dedupedGroups.push({ key, items: allItemsForLabel });
    }
  }

  if (!panelOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-floating flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-sm bg-background border-l border-border shadow-xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-acr-brand" />
              <h2 className="text-sm font-semibold text-foreground">Pax Memory</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              What I remember about your organization
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 -mt-0.5 -mr-1 text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Close memory panel"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : memories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <BrainCircuit className="w-10 h-10 text-muted-foreground/25" />
              <p className="text-sm text-muted-foreground leading-relaxed max-w-[260px]">
                No memories stored yet. Pax will learn your preferences as you work together.
              </p>
            </div>
          ) : (
            dedupedGroups.map(({ key, items }) => {
              const meta = getGroupMeta(key);
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn("text-micro px-1.5 py-0", meta.badgeClass)}
                    >
                      {meta.label}
                    </Badge>
                    <span className="text-micro text-muted-foreground">
                      {items.length}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {items.map((m) => (
                      <MemoryCard
                        key={m.id}
                        memory={m}
                        onDelete={(id) => deleteMutation.mutate(id)}
                        isDeleting={deleteMutation.isPending}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {memories.length > 0 && (
          <div className="flex-shrink-0 px-4 py-2 border-t border-border">
            <p className="text-micro text-muted-foreground/60">
              {memories.length} entr{memories.length === 1 ? "y" : "ies"} ·
              Pax learns from your feedback and conversations
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
