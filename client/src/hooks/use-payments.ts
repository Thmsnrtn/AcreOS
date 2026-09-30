import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, STALE_TIMES, CACHE_TIMES } from "@/lib/queryClient";
import type { Payment } from "@shared/schema";
import { useOperationKey } from "./use-operation-key";

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
  // Money path. `{ idempotent: true }` minted a NEW key per call, so an
  // operator who saw a timeout and clicked again recorded the payment twice
  // (audit of 92bf405). The key is held across retries of the SAME payment —
  // keyed on what makes it the same payment (note, amount, method), not on
  // the body, whose paymentDate is a fresh timestamp on every click.
  const operationKey = useOperationKey();
  return useMutation({
    mutationFn: async (data: { noteId: number; amount: string; paymentMethod: string }) => {
      const idempotencyKey = operationKey.keyFor({
        noteId: data.noteId,
        amount: String(data.amount),
        paymentMethod: data.paymentMethod ?? null,
      });
      const res = await apiRequest("POST", "/api/payments", data, { idempotencyKey });
      return res.json();
    },
    onSuccess: (_, variables) => {
      operationKey.settle();
      queryClient.invalidateQueries({ queryKey: ['/api/payments', variables.noteId] });
      queryClient.invalidateQueries({ queryKey: ['/api/notes'] });
    },
  });
}
