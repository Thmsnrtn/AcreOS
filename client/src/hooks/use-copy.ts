import { useCallback, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";

/**
 * Canonical clipboard hook. Wraps `navigator.clipboard.writeText` with:
 *   - a transient `copied` flag (useful for swapping icons Copy → Check)
 *   - a toast on success/failure so every call-site gets the same feedback
 *
 *   const { copy, copied } = useCopy();
 *   <Button onClick={() => copy(link, "Invite link copied")}>...
 */
export function useCopy(resetAfterMs = 1500) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string | null | undefined, successMessage = "Copied") => {
      if (!text) return false;
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast({ title: successMessage });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetAfterMs);
        return true;
      } catch {
        toast({
          title: "Couldn't copy",
          description: "Select the text manually.",
          variant: "destructive",
        });
        return false;
      }
    },
    [toast, resetAfterMs],
  );

  return { copy, copied };
}
