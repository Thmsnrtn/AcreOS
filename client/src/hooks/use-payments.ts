import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Payment, InsertPayment } from "@shared/schema";

export function usePayments(noteId?: number) {
  return useQuery<Payment[]>({
    queryKey: ['/api/payments', noteId],
    queryFn: async () => {
      const url = noteId ? `/api/payments?noteId=${noteId}` : '/api/payments';
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch payments");
      return res.json();
    },
    enabled: noteId !== undefined,
  });
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertPayment) => {
      const res = await apiRequest("POST", "/api/payments", data);
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/payments', variables.noteId] });
      queryClient.invalidateQueries({ queryKey: ['/api/notes'] });
    },
  });
}
