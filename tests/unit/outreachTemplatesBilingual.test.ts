/**
 * Bilingual outreach (W5b): Spanish copy gets the SAME ethical-outreach check
 * as English copy, and the stock templates the product offers — in both
 * languages — are the population that check reads.
 *
 *   1. Rule parity: every English example the original suite refuses or warns
 *      on has a Spanish translation that draws the same finding; honest
 *      Spanish copy draws none.
 *   2. Population: allOutreachTemplates() enumerates every stock template in
 *      every language (vacuity floor per language); nothing refuses, and per
 *      template id the Spanish copy draws exactly the English copy's rule set.
 *   3. Adoption: the campaign composer and GET /api/direct-mail/templates
 *      serve THIS registry — no inline template copy is left on either.
 *   4. Legal text: Spanish copy that refers to a legal document carries the
 *      "English controls" note, and so does the Spanish offer letter.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { checkOutreachTemplate, refusesSend } from "../../shared/regulatory/ethicalOutreach";
import {
  CAMPAIGN_TEMPLATES,
  DIRECT_MAIL_TEMPLATES,
  allOutreachTemplates,
} from "../../shared/outreach/templates";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const rules = (text: string, probate = false) =>
  checkOutreachTemplate({ text, audience: { probate } })
    .map((f) => `${f.rule}:${f.severity}`)
    .sort();

describe("1 · the Spanish rules mirror the English ones", () => {
  it.each([
    ["FINAL NOTICE regarding your parcel", "AVISO FINAL sobre su terreno"],
    ["Notice of tax deed sale — respond now", "Aviso de venta por impuestos: responda ahora"],
    ["Your account is past due", "Su cuenta tiene un pago vencido"],
    ["County Treasurer's Office notice for owners", "Oficina del Tesorero del condado: aviso para propietarios"],
    ["We guarantee the best price in the county", "Le garantizamos el mejor precio del condado"],
    ["As we discussed, here is my offer", "Como lo hablamos, aquí está mi oferta"],
    ["This offer expires in 48 hours", "Esta oferta vence en 48 horas"],
    ["Last chance to sell before prices drop", "Última oportunidad para vender antes de que bajen los precios"],
    ["Act now — call me", "Actúe ya: llámeme"],
  ])("deceptive, refused in both: %s / %s", (en, es) => {
    expect(refusesSend(checkOutreachTemplate({ text: en }))).toBe(true);
    const f = checkOutreachTemplate({ text: es });
    expect(f.some((x) => x.rule === "deceptive" && x.severity === "refuse"), es).toBe(true);
  });

  it("an offer with no basis is a warning in Spanish too", () => {
    expect(rules("Le pago $8,500 en efectivo por su terreno.")).toEqual(["offer_basis:warn"]);
    expect(rules("Con base en ventas recientes de terrenos similares, le ofrezco $8,500 en efectivo.")).toEqual([]);
  });

  it("probate care: urgency and a missing pointer to the executor/attorney are warned in Spanish", () => {
    expect(rules("Lamentamos su pérdida. Venda rápidamente el terreno heredado y evite los costos de la sucesión.").filter((r) => r.startsWith("probate"))).toHaveLength(2);
    expect(rules("Lamentamos su pérdida. Si la sucesión considera vender, hable primero con el albacea o su abogado: no hay prisa.")).toEqual([]);
  });

  it("honest Spanish copy draws nothing — the words that look alike are not findings", () => {
    expect(rules("Hola, compro terrenos en el condado de Hidalgo. Con base en ventas recientes, puedo ofrecer $12,000 en efectivo. Si no está a la venta, no hay problema.")).toEqual([]);
    // "tan solo 14 días" (a closing speed) is not "only N days left".
    expect(rules("Cierre en tan solo 14 días, sin comisiones.")).toEqual([]);
    // "debe" ("you must") is not "you owe".
    expect(rules("Usted debe hablar con su abogado antes de decidir.")).toEqual([]);
  });

  it("both languages run on every text: Spanish deception inside an 'English' letter is still refused", () => {
    expect(refusesSend(checkOutreachTemplate({ text: "Dear owner, please read: AVISO OFICIAL de su condado." }))).toBe(true);
  });
});

describe("2 · the stock templates, in every language, are the checked population", () => {
  const all = allOutreachTemplates();

  it("vacuity floor: both languages present, same ids, every family", () => {
    const en = all.filter((t) => t.language === "en");
    const es = all.filter((t) => t.language === "es");
    expect(en.length).toBeGreaterThanOrEqual(12);
    expect(es.length).toBe(en.length);
    expect(new Set(es.map((t) => `${t.family}/${t.id}`))).toEqual(new Set(en.map((t) => `${t.family}/${t.id}`)));
    expect(new Set(all.map((t) => t.family))).toEqual(new Set(["campaign", "direct_mail"]));
    // The enumerator reads every list in the registry.
    const registryCount =
      Object.values(CAMPAIGN_TEMPLATES).flatMap((byChannel) => Object.values(byChannel).flat()).length +
      Object.values(DIRECT_MAIL_TEMPLATES).flat().length;
    expect(all.length).toBe(registryCount);
  });

  it("no stock template, in any language, is refused", () => {
    for (const t of all) expect(refusesSend(checkOutreachTemplate({ text: t.text })), `${t.language} ${t.family}/${t.id}`).toBe(false);
  });

  it("per id, the Spanish copy draws exactly the English copy's findings (also as probate audience)", () => {
    const byId = new Map<string, Record<string, string>>();
    for (const t of all) {
      const k = `${t.family}/${t.channel}/${t.id}`;
      byId.set(k, { ...(byId.get(k) ?? {}), [t.language]: t.text });
    }
    for (const [k, v] of byId) {
      expect(rules(v.es), k).toEqual(rules(v.en));
      expect(rules(v.es, true), `${k} (probate audience)`).toEqual(rules(v.en, true));
    }
  });
});

describe("3 · the product serves this registry", () => {
  it("the campaign composer picks from campaignTemplatesFor and types no template copy of its own", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "client/src/components/campaigns-content.tsx"), "utf8"));
    expect(src).toMatch(/campaignTemplatesFor\(campaignLanguage, campaignType\)/);
    // Template bodies were multi-line template literals; a placeholder hint is not one.
    expect(src).not.toMatch(/content:\s*`/);
    expect(src).not.toMatch(/const campaignTemplates\s*=/);
  });
  it("GET /api/direct-mail/templates serves DIRECT_MAIL_TEMPLATES by the customer's chosen language", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-micro-features.ts"), "utf8"));
    expect(src).toMatch(/DIRECT_MAIL_TEMPLATES\[language\]/);
    expect(src).not.toMatch(/body:\s*"Hi \{owner_name\}/);
  });
});

describe("4 · legal text is never translated without 'English controls'", () => {
  it("Spanish copy that mentions a contract carries the note", () => {
    for (const t of allOutreachTemplates().filter((x) => x.language === "es")) {
      if (/contrato|acuerdo de compra|documento legal/i.test(t.text)) expect(t.text, t.id).toMatch(/la versión en inglés es la que rige/);
    }
  });
  it("the Spanish offer letter keeps the binding notice in English and says English controls", async () => {
    const { OFFER_LETTER_STRINGS } = await import("../../server/services/offerLetterPdf");
    expect(Object.keys(OFFER_LETTER_STRINGS.es).sort()).toEqual(Object.keys(OFFER_LETTER_STRINGS.en).sort());
    expect(OFFER_LETTER_STRINGS.es.notBinding("x")).toContain(OFFER_LETTER_STRINGS.en.notBinding("x").split(" Generated")[0]);
    expect(OFFER_LETTER_STRINGS.es.translationNote).toMatch(/English version .* controls/);
    // The letter body itself passes the Spanish ethical check.
    const body = [OFFER_LETTER_STRINGS.es.opening("Acme"), OFFER_LETTER_STRINGS.es.expires("1 de enero de 2027")].join("\n");
    expect(refusesSend(checkOutreachTemplate({ text: body }))).toBe(false);
  });
});
