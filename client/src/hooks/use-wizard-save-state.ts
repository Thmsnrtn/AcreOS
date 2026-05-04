import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorageState } from "./use-local-storage-state";

/**
 * Persistent multi-step wizard state — Yelena §1.
 *
 * Saves the wizard's `step` and `data` payload to localStorage on every change,
 * so a user who closes the tab, reloads, or loses connection can resume from
 * where they left off without re-entering anything.
 *
 * Use for: onboarding wizard, campaign creation, offer wizard, founder setup,
 * any flow with ≥3 steps that takes ≥2 minutes.
 *
 *   const wizard = useWizardSaveState("onboarding-v2", {
 *     step: 0,
 *     data: { businessName: "", state: "" },
 *   });
 *   wizard.setStep(2);
 *   wizard.setData({ ...wizard.data, businessName: "..." });
 *   wizard.clear(); // call on completion
 *
 * Each save also stores `updatedAt` so a "Resume where you left off?" prompt
 * can show timestamps (e.g. "Saved 2 hours ago").
 */
export interface WizardState<T> {
  step: number;
  data: T;
  updatedAt: number;
}

export interface WizardSaveStateApi<T> {
  step: number;
  data: T;
  updatedAt: number;
  setStep: (step: number) => void;
  setData: (next: T | ((prev: T) => T)) => void;
  /** Bulk-update both at once (e.g. transition step + persist field). */
  patch: (next: Partial<{ step: number; data: T | ((prev: T) => T) }>) => void;
  /** Wipe persisted state (call on wizard completion or explicit user reset). */
  clear: () => void;
  /** True if a saved state was hydrated from localStorage on mount. */
  hasResumable: boolean;
}

export function useWizardSaveState<T>(
  /** Unique key per wizard, e.g. "onboarding-v2" or `campaign-create:${userId}`. */
  key: string,
  initial: { step: number; data: T },
): WizardSaveStateApi<T> {
  const lsKey = `acreos:wizard:${key}`;

  const [state, setState] = useLocalStorageState<WizardState<T>>(lsKey, {
    step: initial.step,
    data: initial.data,
    updatedAt: Date.now(),
  });

  // Did we hydrate from a previous session?
  const hydrationRef = useRef<boolean | null>(null);
  const [hasResumable] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const raw = window.localStorage.getItem(lsKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as WizardState<T>;
      return parsed.step > 0 || JSON.stringify(parsed.data) !== JSON.stringify(initial.data);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    hydrationRef.current = hasResumable;
  }, [hasResumable]);

  const setStep = useCallback(
    (step: number) => {
      setState((prev) => ({ ...prev, step, updatedAt: Date.now() }));
    },
    [setState],
  );

  const setData = useCallback(
    (next: T | ((prev: T) => T)) => {
      setState((prev) => ({
        ...prev,
        data: typeof next === "function" ? (next as (p: T) => T)(prev.data) : next,
        updatedAt: Date.now(),
      }));
    },
    [setState],
  );

  const patch = useCallback(
    (next: Partial<{ step: number; data: T | ((prev: T) => T) }>) => {
      setState((prev) => ({
        ...prev,
        step: next.step ?? prev.step,
        data:
          next.data === undefined
            ? prev.data
            : typeof next.data === "function"
              ? (next.data as (p: T) => T)(prev.data)
              : (next.data as T),
        updatedAt: Date.now(),
      }));
    },
    [setState],
  );

  const clear = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(lsKey);
      } catch {
        // ignore
      }
    }
    setState({ step: initial.step, data: initial.data, updatedAt: Date.now() });
  }, [lsKey, setState, initial.step, initial.data]);

  return {
    step: state.step,
    data: state.data,
    updatedAt: state.updatedAt,
    setStep,
    setData,
    patch,
    clear,
    hasResumable,
  };
}
