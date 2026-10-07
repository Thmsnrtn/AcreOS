/**
 * The six questions the founder's Letter exists to answer — one per part of
 * the Letter's structured payload (server/services/autopilot/narrate.ts
 * FounderBrief). No document in the repo names "the six Letter questions", so
 * they are DEFINED here from the Letter's own fields, and every consumer (the
 * Solene eval bank, the UI walk's time-to-answer) reads this one list.
 */
export interface LetterQuestion {
  id: string;
  question: string;
  /** Which FounderBrief field answers it. */
  field: string;
  /** Words on the Letter page that show the answer is on screen. */
  onScreen: RegExp;
}

export const LETTER_QUESTIONS: LetterQuestion[] = [
  { id: "needed", question: "Do you need me today?", field: "neededLine", onScreen: /need(s)? you|your call|nothing needs you/i },
  { id: "overnight", question: "What happened overnight?", field: "theWord", onScreen: /overnight|kept watch|completed/i },
  { id: "money", question: "How is the money — revenue and spend?", field: "vitalSign.mrr", onScreen: /mrr|spend|budget|\$/i },
  { id: "focus", question: "What are you working on right now?", field: "focusLine", onScreen: /focused on|watching|working on/i },
  { id: "misses", question: "What went wrong that I should know about?", field: "misses", onScreen: /what went wrong|nothing went wrong/i },
  { id: "trust", question: "How much of this is proven — can I trust it?", field: "evidence.line", onScreen: /what's proven:|proven in simulation/i },
];
