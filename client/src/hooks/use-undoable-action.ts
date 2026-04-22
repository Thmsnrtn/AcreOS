import { useCallback, useRef } from "react";
import React from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

interface UndoableOpts {
  /** How long the undo window stays open (ms). Defaults to 5000. */
  undoMs?: number;
  /** Toast title. Defaults to "Action scheduled". */
  title?: string;
  /** Toast description. */
  description?: string;
  /** Text on the undo button. Defaults to "Undo". */
  undoLabel?: string;
  /** Destructive-variant toast (red outline). Default true. */
  destructive?: boolean;
}

/**
 * Undoable destructive actions.
 *
 * Pattern: call `schedule(commitFn)` instead of firing the destructive
 * mutation immediately. Shows a toast with an Undo button for N ms; if
 * the user clicks Undo the commit never runs. If they don't, it runs
 * when the window closes.
 *
 *   const { schedule } = useUndoableAction();
 *   schedule({
 *     title: "Archived 3 leads",
 *     commit: () => archiveLeads(ids),
 *   });
 *
 * Prefer this over bare confirm() dialogs for reversible destructive
 * actions — it's faster for the common case and safer for the rare
 * mistake. Keep ConfirmDialog for truly irreversible actions (delete
 * org, cancel subscription, etc.).
 */
export function useUndoableAction(defaultOpts: UndoableOpts = {}) {
  const { toast } = useToast();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(
    (args: UndoableOpts & { commit: () => void | Promise<void> }) => {
      const undoMs = args.undoMs ?? defaultOpts.undoMs ?? 5000;
      const title = args.title ?? defaultOpts.title ?? "Action scheduled";
      const undoLabel = args.undoLabel ?? defaultOpts.undoLabel ?? "Undo";
      const destructive =
        args.destructive ?? defaultOpts.destructive ?? true;

      let cancelled = false;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (!cancelled) {
          void args.commit();
        }
      }, undoMs);

      toast({
        title,
        description: args.description ?? defaultOpts.description,
        variant: destructive ? "destructive" : undefined,
        duration: undoMs,
        action: React.createElement(
          ToastAction as any,
          {
            altText: undoLabel,
            onClick: () => {
              cancelled = true;
              if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
              }
            },
          },
          undoLabel,
        ) as any,
      });
    },
    [toast, defaultOpts],
  );

  return { schedule };
}
