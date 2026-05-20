/**
 * Voice pool — the generic ElevenLabs voices the engine rotates through.
 *
 * Decision (2026-05-20): no founder voice clone. The engine uses a curated
 * pool of ElevenLabs preset voices so ads feel professionally produced
 * without sounding identifiably AI-generated.
 *
 * Selection strategy: per script, the generator picks a voice from the pool
 * weighted by `archetypePreference` if set; otherwise round-robin by least-
 * recently-used. The chosen voice's vibe is fed into the script-generation
 * system prompt so the script style matches the narrator (a sharp, deadpan
 * voice deserves clipped sentences; a warmer narrator deserves longer beats).
 *
 * Voice IDs below are ElevenLabs public preset voice IDs — stable, no
 * cloning needed, work immediately once ELEVENLABS_API_KEY is set.
 *
 * To extend the pool: add an entry here, redeploy. The brand profile
 * seeder picks up changes on next boot.
 */

export interface VoicePoolEntry {
  voiceId: string;
  name: string;
  gender: "male" | "female" | "neutral";
  vibe: string;             // single-line descriptor the script generator reads
  bestForArchetypes: string[]; // archetype slugs this voice fits best
  stability: number;
  similarityBoost: number;
}

/**
 * AcreOS default voice pool. Curated mix of male/female + casual/authoritative
 * so the ad library has tonal variety without sounding inconsistent.
 *
 * These are stable ElevenLabs preset IDs (public defaults). Some plans gate
 * the v3 voice library; if a voiceId fails at runtime, fall through to the
 * next entry in selectVoiceForScript().
 */
export const ACREOS_VOICE_POOL: VoicePoolEntry[] = [
  {
    voiceId: "pNInz6obpgDQGcFmaJgB", // Adam
    name: "Adam",
    gender: "male",
    vibe: "deep, authoritative, measured — works for serious mechanics-first scripts and stat-driven hooks",
    bestForArchetypes: [
      "specific_number_proof",
      "stat_then_demo",
      "audit_log_proof",
      "anti_guru_pattern_break",
    ],
    stability: 0.55,
    similarityBoost: 0.75,
  },
  {
    voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel
    name: "Rachel",
    gender: "female",
    vibe: "warm, conversational, intelligent — works for problem-specific hooks and the operator-day montage",
    bestForArchetypes: [
      "problem_specific",
      "operator_day_montage",
      "before_after_window",
    ],
    stability: 0.5,
    similarityBoost: 0.75,
  },
  {
    voiceId: "TxGEqnHWrfWFTfGW9XjX", // Josh
    name: "Josh",
    gender: "male",
    vibe: "professional, crisp, no-nonsense — works for objection-handle scripts and contrarian questions",
    bestForArchetypes: [
      "objection_handle",
      "contrarian_question",
      "comparison_implicit",
    ],
    stability: 0.6,
    similarityBoost: 0.7,
  },
  {
    voiceId: "EXAVITQu4vr4xnSDxMaL", // Bella
    name: "Bella",
    gender: "female",
    vibe: "soft, thoughtful, observant — works for demonstration-first scripts that let the product do the talking",
    bestForArchetypes: [
      "demonstration_first",
    ],
    stability: 0.5,
    similarityBoost: 0.78,
  },
  {
    voiceId: "yoZ06aMxZJJ28mfd3POQ", // Sam
    name: "Sam",
    gender: "male",
    vibe: "casual, slightly raspy, peer-not-expert — works when the script needs to sound like another operator, not a host",
    bestForArchetypes: [
      "anti_guru_pattern_break",
      "operator_day_montage",
      "problem_specific",
    ],
    stability: 0.45,
    similarityBoost: 0.7,
  },
];

/**
 * Pick a voice for a given script. Strategy:
 *  1. If the archetype has a strong preference, pick the best-match voice
 *     not used in the last `recentlyUsedVoiceIds` set (avoid repetition)
 *  2. Otherwise, round-robin least-recently-used
 *  3. If everything's been used recently, return the first preference anyway
 */
export function selectVoiceForScript(
  pool: VoicePoolEntry[],
  hookArchetype: string,
  recentlyUsedVoiceIds: string[],
): VoicePoolEntry {
  if (pool.length === 0) {
    throw new Error("[cmo:voice] voice pool is empty — brand profile must have at least one voice configured");
  }

  const recentlyUsedSet = new Set(recentlyUsedVoiceIds);
  const preferredMatches = pool.filter((v) => v.bestForArchetypes.includes(hookArchetype));
  const candidatePool = preferredMatches.length > 0 ? preferredMatches : pool;

  const freshCandidates = candidatePool.filter((v) => !recentlyUsedSet.has(v.voiceId));
  if (freshCandidates.length > 0) {
    // Randomize within the fresh set so identical archetypes don't all map
    // to the same voice forever.
    return freshCandidates[Math.floor(Math.random() * freshCandidates.length)];
  }

  // Everything used recently — fall back to a random pick from the preferred
  // (or whole) pool. Repetition is unavoidable when generating many scripts
  // in a short window.
  return candidatePool[Math.floor(Math.random() * candidatePool.length)];
}
