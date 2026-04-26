/**
 * Semantic toast helpers.
 *
 * Replaces the prototype's `window.toast({ label, kind })` and `window.ToastHost`
 * globals (HANDOFF.md §4). Wraps the existing shadcn-Radix toast already mounted
 * by `<Toaster />` in the app shell — does NOT introduce a second toast system.
 *
 * The mega prompt's reference to `sonner` is superseded by the production stack
 * already using radix-ui/react-toast via the `useToast` hook. These helpers give
 * porters from the prototype a `toast.success("...")` / `toast.error("...")`
 * surface that lands in the existing Toaster.
 */
import { toast as baseToast } from "@/hooks/use-toast";

interface ToastOptions {
  description?: string;
  duration?: number;
}

export const toast = {
  success: (label: string, opts?: ToastOptions) =>
    baseToast({
      title: label,
      description: opts?.description,
      duration: opts?.duration,
      variant: "success",
    }),

  warning: (label: string, opts?: ToastOptions) =>
    baseToast({
      title: label,
      description: opts?.description,
      duration: opts?.duration,
      variant: "warning",
    }),

  error: (label: string, opts?: ToastOptions) =>
    baseToast({
      title: label,
      description: opts?.description,
      duration: opts?.duration,
      variant: "destructive",
    }),

  info: (label: string, opts?: ToastOptions) =>
    baseToast({
      title: label,
      description: opts?.description,
      duration: opts?.duration,
    }),

  message: (label: string, opts?: ToastOptions) =>
    baseToast({
      title: label,
      description: opts?.description,
      duration: opts?.duration,
    }),
};

export { useToast } from "@/hooks/use-toast";
