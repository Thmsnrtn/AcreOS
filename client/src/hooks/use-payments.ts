import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
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
    staleTime: STALE_TIMES.short,
    gcTime: CACHE_TIMES.medium,
  });
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertPayment) => {
      // Money path — Idempotency-Key opt-in so a network-layer retry
      // (TanStack default is no-retry, but Safari can retry transparently
      // on cellular timeouts) does not double-record a payment ledger
      // entry. See queryClient.ts → ApiRequestOptions.
      const res = await apiRequest("POST", "/api/payments", data, { idempotent: true });
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/payments', variables.noteId] });
      queryClient.invalidateQueries({ queryKey: ['/api/notes'] });
    },
  });
}
