import { useRef } from "react";
import { generateIdempotencyKey } from "@/lib/queryClient";

/**
 * One Idempotency-Key per money operation the operator is recording
 * (quality directive 2026-09-29, audit of 0e54c75).
 *
 * `apiRequest(…, { idempotent: true })` mints a new key on every call, so a
 * user who saw a timeout and clicked again sent a NEW key and the server
 * recorded the payment twice. This holds the key across retries of the SAME
 * payment, and issues a fresh one when the payment itself changes (an edited
 * amount is a different operation, not a retry) or after it was recorded.
 */
export function useOperationKey() {
  const current = useRef<{ key: string; body: string } | null>(null);
  return {
    /** The key for this exact request body — the same one on a retry. */
    keyFor(body: unknown): string {
      const b = JSON.stringify(body);
      if (!current.current || current.current.body !== b) {
        current.current = { key: generateIdempotencyKey(), body: b };
      }
      return current.current.key;
    },
    /** The operation was recorded: the next one gets a new key. */
    settle(): void {
      current.current = null;
    },
  };
}
