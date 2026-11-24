/**
 * Acquired-note page: who services this note (the operator's declaration).
 * PATCH /api/notes/acquired/:id/servicing-arrangement. Not the ACQUISITIONS
 * pipeline (note-acquisition-detail) — that is a different table.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";
import { ServicingArrangementChoice } from "@/components/notes/ServicingArrangementChoice";
import { isServicingArrangement, servicingArrangementLabel, type ServicingArrangement } from "@shared/notes/servicingArrangement";

export function NoteServicingArrangementCard({ noteId, current }: { noteId: string; current: string }) {
  const { toast } = useToast();
  const recorded: ServicingArrangement | null = isServicingArrangement(current) ? current : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ServicingArrangement | null>(recorded);

  const save = useMutation({
    mutationFn: async (next: ServicingArrangement) => {
      const res = await apiRequest("PATCH", `/api/notes/acquired/${noteId}/servicing-arrangement`, { servicingArrangement: next });
      return res.json() as Promise<{ changed: boolean }>;
    },
    onSuccess: (r) => {
      toast({ title: r.changed ? "Saved" : "No change", description: r.changed ? "Who services this note is updated." : "That is already what is recorded." });
      void queryClient.invalidateQueries({ queryKey: ["/api/notes", noteId] });
      setEditing(false);
    },
    onError: (e: unknown) => {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    },
  });

  return (
    <Card className="p-4 space-y-3" data-testid="note-servicing-arrangement-card">
      {!editing ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Who services this note</h3>
            <p className="text-sm" data-testid="note-servicing-arrangement-current">{servicingArrangementLabel(current)}</p>
            {current === "passive_holder" && (
              <p className="text-xs text-muted-foreground">This is what AcreOS records until you say otherwise. AcreOS prepares periodic statements only for notes you mark as serviced by you.</p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => { setDraft(recorded); setEditing(true); }} data-testid="note-servicing-arrangement-edit">
            Change
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <ServicingArrangementChoice idPrefix="note-servicing" legend="Who services this note" value={draft} onChange={setDraft} disabled={save.isPending} />
          <div className="flex gap-2">
            <Button size="sm" disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft)} data-testid="note-servicing-arrangement-save">
              {Verbs.SAVE}
            </Button>
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => setEditing(false)}>
              {Verbs.CANCEL}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
