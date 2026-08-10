import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type InsertNote } from "@shared/routes";
import { invalidateRelated } from "@/lib/query-keys";

export function useNotes() {
  return useQuery({
    queryKey: [api.notes.list.path],
    queryFn: async () => {
      const res = await fetch(api.notes.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notes");
      return api.notes.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<InsertNote, 'organizationId'>) => {
      const res = await fetch(api.notes.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          startDate: new Date(data.startDate),
        }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create note");
      return api.notes.create.responses[201].parse(await res.json());
    },
    // Optimistic insert so the note appears instantly in any list view
    // (lead/property/deal note tabs). We tag the optimistic row with a
    // negative id so the real server id from the create response wins
    // on the subsequent invalidation.
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: [api.notes.list.path] });
      const previous = queryClient.getQueryData<any[]>([api.notes.list.path]);
      const optimistic = {
        ...data,
        id: -Date.now(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _optimistic: true,
      };
      if (Array.isArray(previous)) {
        queryClient.setQueryData([api.notes.list.path], [optimistic, ...previous]);
      } else {
        queryClient.setQueryData([api.notes.list.path], [optimistic]);
      }
      return { previous };
    },
    onError: (_err, _data, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData([api.notes.list.path], context.previous);
      }
    },
    onSettled: () => {
      // Registry fan-out (P1 §2.1): notes feed the Today door's cash strip
      // via the consolidated /api/today payload — RELATED["note"] in
      // lib/query-keys.ts owns the list (notes list, checklist, Today).
      invalidateRelated("note", queryClient);
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/notes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete note");
    },
    onSuccess: () => {
      // Registry fan-out (P1 §2.1) — see useCreateNote.
      invalidateRelated("note", queryClient);
    },
  });
}
