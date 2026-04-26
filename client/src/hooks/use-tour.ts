/**
 * Guided tour state hook.
 *
 * Replaces the prototype's `window.GuidedTour` and `window.__acrLaunchTour()`
 * globals (HANDOFF.md §4 + §7). Per founder decisions, tour state must be
 * server-backed via `user.tourState: { stepsSeen: string[], dismissed: boolean }`
 * so it survives device switches.
 *
 * Until the server endpoint and route lands (planned for Phase 2 Shell when
 * the tour overlay component is built), this hook reads/writes
 * `acreos-tour-state` in localStorage as a placeholder. The public API will
 * not change when the storage swaps to the server — consumers only see the
 * hook surface, never the persistence implementation.
 *
 * Tour steps (canonical, from acreos/guided-tour.jsx TOUR_STEPS):
 *   home, inbox, pipeline, parcels, pax, palette, wrap
 */
import { useCallback, useEffect, useState } from "react";

export const TOUR_STEP_IDS = [
  "home",
  "inbox",
  "pipeline",
  "parcels",
  "pax",
  "palette",
  "wrap",
] as const;

export type TourStepId = (typeof TOUR_STEP_IDS)[number];

interface TourState {
  stepsSeen: TourStepId[];
  dismissed: boolean;
  active: boolean;
  currentStep: TourStepId | null;
}

const STORAGE_KEY = "acreos-tour-state";

const DEFAULT_STATE: TourState = {
  stepsSeen: [],
  dismissed: false,
  active: false,
  currentStep: null,
};

function loadPersisted(): TourState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<TourState>;
    return {
      stepsSeen: Array.isArray(parsed.stepsSeen)
        ? (parsed.stepsSeen.filter((s): s is TourStepId =>
            (TOUR_STEP_IDS as readonly string[]).includes(s)
          ) as TourStepId[])
        : [],
      dismissed: parsed.dismissed === true,
      // active and currentStep do not survive reloads — tour resumes only by
      // explicit user action, never automatically on page open
      active: false,
      currentStep: null,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function persist(state: TourState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        stepsSeen: state.stepsSeen,
        dismissed: state.dismissed,
      })
    );
  } catch {
    // ignore storage failure
  }
}

export function useTour() {
  const [state, setState] = useState<TourState>(() => loadPersisted());

  useEffect(() => {
    persist(state);
  }, [state]);

  const start = useCallback(() => {
    setState((s) => ({
      ...s,
      active: true,
      currentStep: TOUR_STEP_IDS[0],
      dismissed: false,
    }));
  }, []);

  const restart = useCallback(() => {
    setState({
      stepsSeen: [],
      dismissed: false,
      active: true,
      currentStep: TOUR_STEP_IDS[0],
    });
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => ({
      ...s,
      active: false,
      currentStep: null,
      dismissed: true,
    }));
  }, []);

  const goTo = useCallback((step: TourStepId) => {
    setState((s) => ({
      ...s,
      active: true,
      currentStep: step,
      stepsSeen: s.stepsSeen.includes(step) ? s.stepsSeen : [...s.stepsSeen, step],
    }));
  }, []);

  const next = useCallback(() => {
    setState((s) => {
      if (!s.currentStep) return s;
      const idx = TOUR_STEP_IDS.indexOf(s.currentStep);
      const nextIdx = idx + 1;
      const seen = s.stepsSeen.includes(s.currentStep)
        ? s.stepsSeen
        : [...s.stepsSeen, s.currentStep];
      if (nextIdx >= TOUR_STEP_IDS.length) {
        return { ...s, active: false, currentStep: null, stepsSeen: seen };
      }
      return { ...s, currentStep: TOUR_STEP_IDS[nextIdx], stepsSeen: seen };
    });
  }, []);

  const prev = useCallback(() => {
    setState((s) => {
      if (!s.currentStep) return s;
      const idx = TOUR_STEP_IDS.indexOf(s.currentStep);
      if (idx <= 0) return s;
      return { ...s, currentStep: TOUR_STEP_IDS[idx - 1] };
    });
  }, []);

  return {
    ...state,
    stepIds: TOUR_STEP_IDS,
    start,
    restart,
    dismiss,
    goTo,
    next,
    prev,
  };
}
