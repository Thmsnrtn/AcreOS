/**
 * Which language Pax answers in (W5b). Pax answers the USER — the customer at
 * the keyboard — so this reads the user's own setting and the user's own
 * message, never anything about a landowner (whose outreach language has its
 * own rule: shared/outreach/outreachLanguage.ts).
 *
 *   setting "es" → Spanish;  setting "en" → English;
 *   setting unset ("auto") → the language the user wrote this message in.
 *
 * Detection is deliberately conservative: Spanish only when the message
 * carries Spanish-only marks (¿ ¡ ñ, accented function words) or several common
 * Spanish function words, so an English message mentioning "Rio Grande" or
 * "San Antonio" stays English. Pure; browser-safe.
 */

export type PaxReplyLanguage = "en" | "es";

// Unicode-aware edges: JS `\b` is ASCII-only and never sees an edge after "qué".
const SPANISH_MARKS = /[¿¡ñÑ]|(?<!\p{L})(?:qué|cómo|cuál|cuánto|cuántos|dónde|está|están|también|después|más|aquí|sí|información|propiedad(?:es)?)(?!\p{L})/iu;
const SPANISH_WORDS = [
  "el", "la", "los", "las", "de", "del", "que", "y", "en", "un", "una", "por", "para", "con", "es", "mi", "mis", "como",
  "quiero", "necesito", "puedo", "puedes", "terreno", "terrenos", "dueño", "dueños", "oferta", "ayuda", "hola", "gracias",
  "cuando", "porque", "pero", "este", "esta", "tengo", "hacer", "vender", "comprar",
];
const ENGLISH_WORDS = ["the", "and", "is", "are", "to", "of", "my", "i", "what", "how", "can", "you", "for", "with", "this", "that", "do"];

function looksSpanish(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return false;
  const words = t.split(/[^a-záéíóúüñ]+/).filter(Boolean);
  const es = words.filter((w) => SPANISH_WORDS.includes(w)).length;
  const en = words.filter((w) => ENGLISH_WORDS.includes(w)).length;
  if (SPANISH_MARKS.test(t) && es >= en) return true;
  return es >= 3 && es > en * 2;
}

export function paxReplyLanguage(setting: string | null | undefined, message: string): PaxReplyLanguage {
  if (setting === "es") return "es";
  if (setting === "en") return "en";
  return looksSpanish(message) ? "es" : "en";
}

/** The system-prompt block. Empty for English (the default prompt is English). */
export function paxLanguageDirective(lang: PaxReplyLanguage): string {
  if (lang !== "es") return "";
  return (
    "\n\n=== REPLY LANGUAGE ===\n" +
    "Answer in Spanish (español), in clear, neutral Latin-American Spanish. Keep AcreOS product names, button labels and " +
    "figures exactly as they appear. Legal documents, disclosures and contract text stay in English: if you summarise or " +
    "translate one, say it is a courtesy translation and that the English version controls. Draft owner-facing outreach in " +
    "Spanish only when the customer asks for it or the owner asked for Spanish — never because of an owner's name or location.\n" +
    "=== END REPLY LANGUAGE ==="
  );
}
