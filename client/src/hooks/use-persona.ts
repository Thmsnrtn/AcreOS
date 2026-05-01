import { useAuth } from "@/hooks/use-auth";
import { getTerm, type VocabularyKey } from "@/lib/personaVocabulary";
import type { Persona } from "@shared/models/auth";

/**
 * Resolve the active persona for the signed-in user. Defaults to
 * "land_investor" when unauthenticated or when the column is null on a
 * legacy row. Pages can branch on this value for persona-gated UI;
 * for copy substitution use `useTerm` instead.
 */
export function usePersona(): Persona {
  const { user } = useAuth();
  return (user?.persona as Persona | undefined) ?? "land_investor";
}

/**
 * Persona-aware copy lookup — JC#7 / VERTICAL-EXPANSION-PLAN.md primitive #2.
 * Pages migrate from hardcoded strings by importing this hook and replacing
 * the literal with `useTerm("entity.lead")` etc. Falls back to land_investor
 * for any key the active persona doesn't override.
 */
export function useTerm(key: VocabularyKey): string {
  const persona = usePersona();
  return getTerm(key, persona);
}
