/**
 * The outreach preview's own words, in the language of the copy being
 * previewed (W5b). The customer picks the copy's language; the preview chrome
 * follows it so a Spanish letter is reviewed in a Spanish frame.
 *
 * LEGAL TEXT IS NEVER MACHINE-TRANSLATED WITHOUT A NOTE: anything here that
 * touches a legal document carries `englishControls`, and the Spanish string
 * says the English version is the one that governs.
 */
import type { OutreachLanguage } from "@shared/outreach/outreachLanguage";

export interface OutreachPreviewStrings {
  previewAll: string;
  pieces: (n: string) => string;
  showing: (from: number, to: number, total: string) => string;
  empty: string;
  stale: string;
  previous: string;
  next: string;
  close: string;
  ownerAskedFor: (language: string) => string;
  englishControls: string;
}

export const OUTREACH_PREVIEW_STRINGS: Readonly<Record<OutreachLanguage, OutreachPreviewStrings>> = {
  en: {
    previewAll: "Preview all",
    pieces: (n) => `${n} pieces — recipient + rendered copy.`,
    showing: (from, to, total) => `Showing ${from}–${to} of ${total}`,
    empty: "No leads match this audience.",
    stale: "The recipients changed since the quote on screen — the quote will refresh before anything is sent.",
    previous: "Previous",
    next: "Next",
    close: "Close",
    ownerAskedFor: (language) => `Owner asked for ${language}`,
    englishControls: "Translation — English controls.",
  },
  es: {
    previewAll: "Vista previa de todo",
    pieces: (n) => `${n} piezas — destinatario y texto final.`,
    showing: (from, to, total) => `Mostrando ${from}–${to} de ${total}`,
    empty: "Ningún contacto coincide con este público.",
    stale: "Los destinatarios cambiaron desde la cotización en pantalla; la cotización se actualizará antes de enviar nada.",
    previous: "Anterior",
    next: "Siguiente",
    close: "Cerrar",
    ownerAskedFor: (language) => `El propietario pidió: ${language}`,
    englishControls:
      "Traducción de cortesía — la versión en inglés de cualquier documento legal es la que rige.",
  },
};
