/**
 * DomainPack — the typed kernel↔vertical seam (Foundry move #1).
 *
 * The governed-autonomy KERNEL (the gate stack, witnessed-send, the causal
 * world-model machinery, the trust ladder, the operator) is domain-agnostic by
 * construction. Everything a SPECIFIC vertical contributes — its causal theory
 * of its own business, which lever each move pulls, its regulatory profile —
 * arrives through this one interface. AcreOS's land vertical is the first
 * implementation (`./packs/land`); a second, deliberately-foreign pack must run
 * on the UNCHANGED kernel (the milestone that earns the right to platformize —
 * see docs/internal/roadmap/foundry-decision-2026-06-24.md).
 *
 * This file is KERNEL: it imports only kernel types and names the contract. The
 * boundary (kernel may not import any pack) is compiler/CI-enforced by
 * scripts/check-kernel-boundary.mjs — the same ratchet discipline as the
 * truth-immutable and four-door ratchets. Today there is exactly one pack and
 * one tenant; the SEAM is what's load-bearing, not the count.
 */

import type { CausalModel } from "./worldModel";
import type { RegulatoryProfile } from "./claimsEngine";

export interface DomainPack {
  /** Stable pack id, e.g. "land". Lowercase, kebab-case. */
  readonly id: string;
  /** Human-facing label, e.g. "Land acquisition". */
  readonly label: string;
  /**
   * The vertical's causal theory of its business — variables + causal edges the
   * kernel can simulate interventions on. Edge effects start as low-confidence
   * priors and sharpen from the org's witnessed-intervention history.
   */
  readonly causalModel: CausalModel;
  /**
   * Maps a decide.ts move-kind to the causal lever it pulls, so the brain can
   * query a move's PREDICTED downstream effect (the planning oracle). A move
   * with no entry has "no causal model yet" — honest absence, never a faked
   * estimate.
   */
  readonly moveToLever: Readonly<Record<string, string>>;
  /**
   * The vertical's content-regulatory rules — the prohibited-claim patterns +
   * required disclosures the kernel claims engine (`screenClaims`) screens
   * auto-published content against. Optional: a pack with no public-broadcast
   * surface needn't supply one.
   */
  readonly regulatoryProfile?: RegulatoryProfile;
}
