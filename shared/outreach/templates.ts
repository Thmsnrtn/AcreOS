/**
 * Stock outreach templates — the ONE registry, in every language AcreOS ships.
 *
 * Two families, both offered to customers as starting copy:
 *   CAMPAIGN_TEMPLATES     — the campaign composer's picker (direct mail, email,
 *                            SMS), `{{token}}` placeholders.
 *   DIRECT_MAIL_TEMPLATES  — GET /api/direct-mail/templates (the mail-campaign
 *                            journey), `{token}` placeholders.
 *
 * Every template exists in English and Spanish with the same id, and BOTH go
 * through the same ethical-outreach check (shared/regulatory/ethicalOutreach.ts)
 * — tests/unit/outreachTemplatesBilingual.test.ts enumerates this registry
 * through `allOutreachTemplates()` and asserts, per id, that the Spanish copy
 * draws exactly the findings the English copy draws, and that nothing refuses.
 *
 * TRANSLATION NOTE. These are marketing letters, not legal instruments. Where a
 * Spanish template refers to a legal document (a purchase agreement), it says
 * the document is in English and the English version controls; AcreOS never
 * machine-translates a legal disclosure without that note.
 *
 * The language a template is offered in is chosen by the CUSTOMER (campaign
 * language) — see shared/outreach/outreachLanguage.ts. Pure; browser-safe.
 */
import type { OutreachLanguage } from "./outreachLanguage";

export type CampaignChannel = "direct_mail" | "email" | "sms";

export interface CampaignTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  content: string;
}

/** Shown under any Spanish copy that refers to an English legal document. */
const ENGLISH_CONTROLS_NOTE_ES =
  "Traducción de cortesía. Cualquier contrato o documento legal se entrega en inglés, y la versión en inglés es la que rige.";

const EN: Record<CampaignChannel, CampaignTemplate[]> = {
  direct_mail: [
    {
      id: "dm_neutral",
      name: "Neutral Offer",
      description: "Professional inquiry without stating a specific price",
      subject: "Interested in Your Property",
      content: `Dear {{firstName}} {{lastName}},

My name is [Your Name] and I am a land investor interested in purchasing property in {{county}} County, {{state}}.

I recently came across your parcel (APN: {{apn}}) and wanted to reach out to see if you might be interested in selling.

I purchase land for cash and can close quickly with no fees or commissions on your end. If you're open to discussing a sale, please give me a call or text at [Your Phone] or email me at [Your Email].

I look forward to hearing from you.

Best regards,
[Your Name]
[Your Company]`,
    },
    {
      id: "dm_blind",
      name: "Blind Offer",
      description: "Specific cash offer without revealing how you found them",
      subject: "Cash Offer for Your {{county}} County Land",
      content: `Dear {{firstName}} {{lastName}},

I am writing to make you a cash offer of \${{offerAmount}} for your property located in {{county}} County, {{state}} (APN: {{apn}}).

This is a no-obligation offer. If you accept:
- I pay all closing costs
- No realtor commissions
- Close in as little as 14 days
- Payment by cashier's check or wire transfer

If you're interested, simply sign the enclosed Purchase Agreement and return it in the prepaid envelope provided.

Questions? Call me directly at [Your Phone].

Sincerely,
[Your Name]
[Your Company]`,
    },
    {
      id: "dm_followup",
      name: "Follow-Up Mailer",
      description: "Second touch for non-responders",
      // Was "Second Notice: Offer for Your Land" — the ethical-outreach check
      // refuses "second notice" (an offer letter is not a notice), so the
      // stock subject could never have been sent. Fixed at the occurrence.
      subject: "Following Up: My Offer for Your Land",
      content: `Dear {{firstName}} {{lastName}},

I recently sent you a letter expressing my interest in purchasing your property in {{county}} County, {{state}}.

I wanted to follow up in case my first letter didn't reach you or got lost in the mail. My offer still stands, and I remain very interested in your parcel.

If you've been thinking about selling, I'd love to chat. Even if you're not ready to sell right now, feel free to reach out - I'm always happy to answer questions.

Call or text: [Your Phone]
Email: [Your Email]

Best regards,
[Your Name]`,
    },
  ],
  email: [
    {
      id: "email_neutral",
      name: "Neutral Inquiry",
      description: "Professional email inquiry about selling",
      subject: "Quick Question About Your {{county}} County Property",
      content: `Hi {{firstName}},

I came across your property in {{county}} County and wanted to reach out to see if you might be interested in selling.

I'm a land investor and I purchase properties for cash with quick, hassle-free closings.

Would you be open to a brief conversation? I'd be happy to answer any questions you might have.

Best,
[Your Name]
[Your Phone]`,
    },
    {
      id: "email_blind",
      name: "Blind Offer Email",
      description: "Direct cash offer via email",
      subject: "Cash Offer: ${{offerAmount}} for Your Land",
      content: `Hi {{firstName}},

I'd like to make you a cash offer of \${{offerAmount}} for your property in {{county}} County, {{state}}.

Here's what I offer:
- All cash, no financing contingencies
- I cover closing costs
- Close in 2-3 weeks
- No realtor fees

If this interests you, just reply to this email or call me at [Your Phone].

No pressure either way - just let me know!

[Your Name]
[Your Company]`,
    },
    {
      id: "email_nurture",
      name: "Nurture Sequence",
      description: "Relationship-building email for warm leads",
      subject: "Checking In - {{county}} County Property",
      content: `Hi {{firstName}},

I wanted to check in and see how things are going. I know selling land is a big decision, and I'm here whenever you're ready to talk.

In the meantime, if you have any questions about the process, property values in your area, or anything else - feel free to reach out. I'm happy to help with no obligation.

Have a great week!

[Your Name]
[Your Phone]`,
    },
  ],
  sms: [
    {
      id: "sms_neutral",
      name: "Neutral Text",
      description: "Simple inquiry text message",
      subject: "",
      content: `Hi {{firstName}}, this is [Your Name]. I'm interested in buying land in {{county}} County and came across your property. Would you consider selling? No pressure - just reply YES if you'd like to chat.`,
    },
    {
      id: "sms_blind",
      name: "Blind Offer Text",
      description: "Direct offer via text",
      subject: "",
      content: `Hi {{firstName}}, I'd like to offer \${{offerAmount}} cash for your {{county}} County property. I pay all closing costs & can close in 2 weeks. Interested? Reply YES or call [Your Phone].`,
    },
    {
      id: "sms_followup",
      name: "Follow-Up Text",
      description: "Quick follow-up for non-responders",
      subject: "",
      content: `Hi {{firstName}}, just following up on my offer for your {{county}} County land. Still interested in selling? Let me know - [Your Name]`,
    },
  ],
};

const ES: Record<CampaignChannel, CampaignTemplate[]> = {
  direct_mail: [
    {
      id: "dm_neutral",
      name: "Consulta neutral",
      description: "Consulta profesional sin indicar un precio",
      subject: "Interés en su propiedad",
      content: `Estimado(a) {{firstName}} {{lastName}}:

Mi nombre es [Su nombre] y soy inversionista en terrenos. Me interesa comprar propiedades en el condado de {{county}}, {{state}}.

Hace poco vi su terreno (APN: {{apn}}) y quería preguntarle si estaría interesado(a) en venderlo.

Compro terrenos en efectivo y puedo cerrar con rapidez, sin comisiones ni cargos para usted. Si está abierto(a) a conversar sobre una venta, llámeme o envíeme un mensaje de texto al [Su teléfono], o escríbame a [Su correo electrónico].

Quedo atento(a) a su respuesta.

Atentamente,
[Su nombre]
[Su empresa]`,
    },
    {
      id: "dm_blind",
      name: "Oferta directa",
      description: "Oferta en efectivo con un monto específico",
      subject: "Oferta en efectivo por su terreno en el condado de {{county}}",
      content: `Estimado(a) {{firstName}} {{lastName}}:

Le escribo para hacerle una oferta en efectivo de \${{offerAmount}} por su propiedad ubicada en el condado de {{county}}, {{state}} (APN: {{apn}}).

Esta oferta no le obliga a nada. Si la acepta:
- Yo pago todos los costos de cierre
- Sin comisiones de agentes inmobiliarios
- Cierre en tan solo 14 días
- Pago con cheque de caja o transferencia bancaria

Si le interesa, firme el Contrato de Compra adjunto y devuélvalo en el sobre con franqueo pagado.

¿Preguntas? Llámeme directamente al [Su teléfono].

Atentamente,
[Su nombre]
[Su empresa]

${ENGLISH_CONTROLS_NOTE_ES}`,
    },
    {
      id: "dm_followup",
      name: "Carta de seguimiento",
      description: "Segundo contacto para quienes no respondieron",
      subject: "Seguimiento: mi oferta por su terreno",
      content: `Estimado(a) {{firstName}} {{lastName}}:

Hace poco le envié una carta para expresarle mi interés en comprar su propiedad en el condado de {{county}}, {{state}}.

Le escribo de nuevo por si mi primera carta no le llegó o se perdió en el correo. Mi oferta sigue en pie y sigo muy interesado(a) en su terreno.

Si ha estado pensando en vender, me encantaría conversar. Aunque no esté listo(a) para vender ahora, con gusto respondo sus preguntas.

Llamadas o mensajes de texto: [Su teléfono]
Correo electrónico: [Su correo electrónico]

Saludos cordiales,
[Su nombre]`,
    },
  ],
  email: [
    {
      id: "email_neutral",
      name: "Consulta neutral",
      description: "Correo profesional para preguntar si desea vender",
      subject: "Una pregunta sobre su propiedad en el condado de {{county}}",
      content: `Hola, {{firstName}}:

Vi su propiedad en el condado de {{county}} y quería preguntarle si estaría interesado(a) en venderla.

Soy inversionista en terrenos y compro propiedades en efectivo, con cierres rápidos y sin complicaciones.

¿Le gustaría conversar brevemente? Con gusto respondo cualquier pregunta que tenga.

Saludos,
[Su nombre]
[Su teléfono]`,
    },
    {
      id: "email_blind",
      name: "Oferta directa por correo",
      description: "Oferta en efectivo por correo electrónico",
      subject: "Oferta en efectivo: ${{offerAmount}} por su terreno",
      content: `Hola, {{firstName}}:

Me gustaría hacerle una oferta en efectivo de \${{offerAmount}} por su propiedad en el condado de {{county}}, {{state}}.

Esto es lo que le ofrezco:
- Todo en efectivo, sin condiciones de financiamiento
- Yo cubro los costos de cierre
- Cierre en 2 a 3 semanas
- Sin comisiones de agentes inmobiliarios

Si le interesa, responda a este correo o llámeme al [Su teléfono].

Sin ninguna presión; solo avíseme.

[Su nombre]
[Su empresa]`,
    },
    {
      id: "email_nurture",
      name: "Seguimiento cordial",
      description: "Correo para mantener la relación con contactos interesados",
      subject: "Saludos - propiedad en el condado de {{county}}",
      content: `Hola, {{firstName}}:

Quería saludarle y saber cómo está. Sé que vender un terreno es una decisión importante, y aquí estoy cuando quiera conversar.

Mientras tanto, si tiene preguntas sobre el proceso, los valores de las propiedades en su zona o cualquier otra cosa, escríbame. Con gusto le ayudo, sin ningún compromiso.

¡Que tenga una excelente semana!

[Su nombre]
[Su teléfono]`,
    },
  ],
  sms: [
    {
      id: "sms_neutral",
      name: "Texto neutral",
      description: "Mensaje de texto sencillo",
      subject: "",
      content: `Hola, {{firstName}}, soy [Su nombre]. Me interesa comprar terrenos en el condado de {{county}} y vi su propiedad. ¿Consideraría venderla? Sin presión: responda SÍ si quiere conversar.`,
    },
    {
      id: "sms_blind",
      name: "Oferta directa por texto",
      description: "Oferta directa por mensaje de texto",
      subject: "",
      content: `Hola, {{firstName}}, me gustaría ofrecerle \${{offerAmount}} en efectivo por su propiedad en el condado de {{county}}. Pago todos los costos de cierre y puedo cerrar en 2 semanas. ¿Le interesa? Responda SÍ o llame al [Su teléfono].`,
    },
    {
      id: "sms_followup",
      name: "Texto de seguimiento",
      description: "Seguimiento breve para quienes no respondieron",
      subject: "",
      content: `Hola, {{firstName}}, le escribo para dar seguimiento a mi oferta por su terreno en el condado de {{county}}. ¿Sigue interesado(a) en vender? Avíseme - [Su nombre]`,
    },
  ],
};

export const CAMPAIGN_TEMPLATES: Readonly<Record<OutreachLanguage, Record<CampaignChannel, CampaignTemplate[]>>> = {
  en: EN,
  es: ES,
};

/** The composer's picker: templates for a channel in the campaign's language. */
export function campaignTemplatesFor(language: OutreachLanguage, channel: string): CampaignTemplate[] {
  const byChannel = CAMPAIGN_TEMPLATES[language] ?? CAMPAIGN_TEMPLATES.en;
  return (byChannel as Record<string, CampaignTemplate[]>)[channel] ?? [];
}

export interface DirectMailTemplate {
  id: string;
  name: string;
  type: "postcard" | "letter";
  description: string;
  body: string;
}

const DM_EN: DirectMailTemplate[] = [
  {
    id: "postcard_cash_offer",
    name: "Postcard — Cash Offer",
    type: "postcard",
    description: "Bright, direct, highest-response format for first-touch outreach.",
    body: "Hi {owner_name},\nWe're making cash offers on land in {county} county. If {apn} is something you'd consider parting with, reply with your number and we'll send a no-obligation offer within 48 hours.\n— {from_name}",
  },
  {
    id: "yellow_letter_personal",
    name: "Yellow Letter — Personal Handwritten",
    type: "letter",
    description: "Higher-converting but slower. Simulated handwriting, personal tone.",
    body: "Hi {owner_name},\nMy name is {from_name} and I buy land in {county} directly from owners. I'd love to make you an offer on {apn}. Call or text me anytime at {from_phone}. No pressure — just a conversation.",
  },
  {
    id: "blind_offer_letter",
    name: "Blind Offer — Printed Letter",
    type: "letter",
    description: "Dollar amount on the envelope. Lower response rate but pre-qualifies motivated sellers.",
    body: "Re: {apn} — {county}, {state}\n\nWe are prepared to purchase this parcel for {offer_amount} cash, closing within 21 days. This offer is valid for 30 days. Reply to accept or counter.\n\n— {from_name}, {from_company}",
  },
];

const DM_ES: DirectMailTemplate[] = [
  {
    id: "postcard_cash_offer",
    name: "Postal — Oferta en efectivo",
    type: "postcard",
    description: "Formato directo y llamativo para el primer contacto.",
    body: "Hola, {owner_name}:\nHacemos ofertas en efectivo por terrenos en el condado de {county}. Si consideraría vender {apn}, respóndanos con su número y le enviaremos una oferta sin compromiso en un plazo de 48 horas.\n— {from_name}",
  },
  {
    id: "yellow_letter_personal",
    name: "Carta amarilla — Escrita a mano",
    type: "letter",
    description: "Más lenta, pero con mejor respuesta. Letra manuscrita simulada y tono personal.",
    body: "Hola, {owner_name}:\nMe llamo {from_name} y compro terrenos en {county} directamente a sus dueños. Me encantaría hacerle una oferta por {apn}. Llámeme o envíeme un mensaje de texto cuando quiera al {from_phone}. Sin presión, solo una conversación.",
  },
  {
    id: "blind_offer_letter",
    name: "Oferta directa — Carta impresa",
    type: "letter",
    description: "Monto en el sobre. Menos respuestas, pero de vendedores más motivados.",
    body: "Ref.: {apn} — {county}, {state}\n\nEstamos dispuestos a comprar este terreno por {offer_amount} en efectivo, con cierre en un plazo de 21 días. Esta oferta es válida por 30 días. Responda para aceptarla o hacer una contraoferta.\n\n— {from_name}, {from_company}",
  },
];

export const DIRECT_MAIL_TEMPLATES: Readonly<Record<OutreachLanguage, DirectMailTemplate[]>> = {
  en: DM_EN,
  es: DM_ES,
};

/**
 * Every stock template in every language — the population the ethical-outreach
 * test reads. A new family must be added HERE or it is outside the check.
 */
export function allOutreachTemplates(): Array<{
  family: "campaign" | "direct_mail";
  language: OutreachLanguage;
  channel: string;
  id: string;
  text: string;
}> {
  const out: Array<{ family: "campaign" | "direct_mail"; language: OutreachLanguage; channel: string; id: string; text: string }> = [];
  for (const language of Object.keys(CAMPAIGN_TEMPLATES) as OutreachLanguage[]) {
    for (const [channel, list] of Object.entries(CAMPAIGN_TEMPLATES[language])) {
      for (const t of list) out.push({ family: "campaign", language, channel, id: t.id, text: `${t.subject}\n${t.content}` });
    }
    for (const t of DIRECT_MAIL_TEMPLATES[language]) {
      out.push({ family: "direct_mail", language, channel: t.type, id: t.id, text: t.body });
    }
  }
  return out;
}
