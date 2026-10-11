/**
 * Pax answers in Spanish when the USER writes in Spanish or asks for it in
 * settings (W5b). It reads the user's own message and setting — never a
 * landowner's name or place.
 */
import { describe, expect, it } from "vitest";
import { paxLanguageDirective, paxReplyLanguage } from "../../shared/pax/replyLanguage";

const looksSpanish = (m: string) => paxReplyLanguage(null, m) === "es";

describe("Pax reply language", () => {
  it.each([
    "¿Cómo hago una oferta por este terreno?",
    "Quiero vender mis terrenos en el condado de Hidalgo, necesito ayuda con la oferta",
    "hola, qué sigue para mi primer trato?",
  ])("Spanish: %s", (m) => expect(looksSpanish(m)).toBe(true));

  it.each([
    "How do I make an offer on the Rio Grande parcel in San Antonio?",
    "Draft a letter to José Hernández about his lot",
    "What is my next step?",
    "",
  ])("not Spanish: %s", (m) => expect(looksSpanish(m)).toBe(false));

  it("the user's setting wins; auto follows the message", () => {
    expect(paxReplyLanguage("es", "What next?")).toBe("es");
    expect(paxReplyLanguage("en", "¿Qué sigue?")).toBe("en");
    expect(paxReplyLanguage(null, "¿Qué sigue para mí?")).toBe("es");
    expect(paxReplyLanguage(null, "What next?")).toBe("en");
  });

  it("the Spanish directive keeps legal text in English and forbids name-based outreach language", () => {
    const d = paxLanguageDirective("es");
    expect(d).toMatch(/Answer in Spanish/);
    expect(d).toMatch(/English version controls/);
    expect(d).toMatch(/never because of an owner's name or location/);
    expect(paxLanguageDirective("en")).toBe("");
  });
});
