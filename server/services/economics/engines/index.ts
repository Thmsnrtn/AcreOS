/**
 * The full scenario engine registry.
 *
 * `shared/economics/scenario.ts` exports `CORE_ENGINES` — the engines that live
 * in shared/ and can run on either side. This composes them with the
 * SERVER-SIDE engines, which exist for a reason worth stating: the note payoff
 * engine implements statute-adjacent arithmetic (`server/services/
 * notePaymentMath.ts`, registered in shared/governance/statuteRegister.ts) and
 * `scripts/check-boundaries.mjs` rule S1 forbids shared/ importing server/.
 *
 * Rather than relocate regulated money code to satisfy a module boundary, the
 * registry is composed here and passed IN to `computeScenario`. The closure
 * guarantee survives — an engine outside the set it is handed is refused — and
 * there is still no path from a scenario computation to a model.
 *
 * WHY THIS MATTERS ARCHITECTURALLY (BI191): "Every core primitive must pass
 * contrasting Strategy Pack fixtures. A land-only implementation that happens
 * to expose generic labels does not satisfy the architecture." A registry with
 * one land engine is a land-shaped abstraction pretending to be general. The
 * note engine is structurally different — date-driven day-count accrual rather
 * than a cash-flow series — so it is a real test of the contract rather than a
 * second instance of the same shape.
 */

import { CORE_ENGINES, type EngineSpec } from "@shared/economics/scenario";
import { notePayoffEngine } from "./notePayoff";
import { flipMaoEngine } from "./flipMao";
import { rentalReturnsEngine } from "./rentalReturns";

export const ALL_ENGINES: readonly EngineSpec[] = [
  ...CORE_ENGINES,
  notePayoffEngine,
  flipMaoEngine,
  rentalReturnsEngine,
];
