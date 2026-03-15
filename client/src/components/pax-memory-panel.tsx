// PaxMemoryPanel — view and manage what Pax remembers about your org
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";

interface AiMemory {
  id: number;
  memoryType: string;
  content: string;
  importance: number | null;
  createdAt: string;
  expiresAt?: string | null;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  preference: { label: "Preference", color: "bg-blue-100 text-blue-700" },
  insight:    { label: "Insight",    color: "bg-green-100 text-green-700" },
  fact:       { label: "Fact",       color: "bg-purple-100 text-purple-700" },
  decision:   { label: "Decision",   color: "bg-orange-100 text-orange-700" },
  contact:    { label: "Contact",    color: "bg-pink-100 text-pink-700" },
  correction: { label: "Correction", color: "bg-red-100 text-red-700" },
  reinforcement: { label: "Positive", color: "bg-emerald-100 text-emerald-700" },
  procedure:  { label: "Procedure",  color: "bg-yellow-100 text-yellow-700" },
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PaxMemoryPanel({ open, onClose }: Props) {
  const qc = useQueryClient();

  const { data: memories = [], isLoading } = useQuery<AiMemory[]>({
    queryKey: ["/api/ai/memory"],
    enabled: open,
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/ai/memory/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/ai/memory"] }),
  });

  // Group by type
  const groups = memories.reduce<Record<string, AiMemory[]>>((acc, m) => {
    const t = m.memoryType ?? "fact";
    if (!acc[t]) acc[t] = [];
    acc[t].push(m);
    return acc;
  }, {});

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[400px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b flex-shrink-0">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <BrainCircuit className="w-4 h-4 text-primary" />
            Pax Memory
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            What Pax remembers about your organization. Delete entries to correct mistakes.
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : memories.length === 0 ? (
            <div className="text-center py-10">
              <BrainCircuit className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">
                Pax hasn't stored any memories yet. Ask Pax to remember facts or use the{" "}
                <code className="text-[10px] bg-muted px-1 rounded">/remember</code> pattern in chat.
              </p>
            </div>
          ) : (
            Object.entries(groups).map(([type, items]) => {
              const meta = TYPE_LABELS[type] ?? { label: type, color: "bg-gray-100 text-gray-700" };
              return (
                <div key={type}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", meta.color)}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{items.length}</span>
                  </div>
                  <div className="space-y-1">
                    {items.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-start gap-2 rounded-md border px-2.5 py-2 hover:bg-muted/30 group"
                      >
                        <p className="text-xs flex-1 leading-snug text-foreground">{m.content}</p>
                        <button
                          onClick={() => deleteMut.mutate(m.id)}
                          disabled={deleteMut.isPending}
                          className="text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 mt-0.5 flex-shrink-0"
                          title="Delete memory"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex-shrink-0 px-4 py-2 border-t">
          <p className="text-[10px] text-muted-foreground/60">
            {memories.length} entr{memories.length === 1 ? "y" : "ies"} · Pax learns from your feedback and conversations
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
