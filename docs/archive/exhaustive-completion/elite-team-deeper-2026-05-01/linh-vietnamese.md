# Linh Nguyen — AcreOS Vietnamese-American Audit

**Role:** Land Investor, Houston TX. 38, second-generation Vietnamese-American. Mother (Bà Nguyễn, 67) co-invests — speaks Vietnamese only, reads at a 6th-grade level in Vietnamese, signs everything I put in front of her. Buyer pool is the Houston Bellaire / Hong Kong City IV / Bellaire-Beechnut Vietnamese community — ~all-cash, ~all-Vietnamese, transactions move on Zalo and over phở at Mai's. ~$1.4M deployed across rural East Texas (Liberty, Polk, San Jacinto counties) + four Brazoria infill lots.
**Wave:** 3 of 87-persona AcreOS audit, Vietnamese-language / intergenerational / Zalo-channel lens.
**Date:** 2026-05-01.
**Surfaces reviewed:** `client/src/lib/format.ts`, `server/services/communications.ts`, `server/services/smsService.ts`, `server/services/tcpaCompliance.ts`, `server/services/stateDocumentConfig.ts` (TX block, lines 360–380), `server/services/closingChecklistGenerator.ts`, `shared/schema.ts` (leads, organizations, communications), `client/src/components/onboarding/OnboardingWizard.tsx`. Full-tree grep for `i18n|locale|vietnamese|vi-VN|zalo|spanish|translate|preferredLanguage` — only one i18n-adjacent comment, in `client/src/lib/format.ts:4` ("Centralizes rules so a change (e.g. adding i18n) happens"). That comment is the entire i18n strategy. Heng's foreign-buyer audit (`heng-foreign-buyer.md`) flagged the same root cause from a different angle; I want to flag it from inside the US.

Em xin nói thẳng (let me speak plainly): AcreOS assumes everyone reads English at a contract-grade level, owns one phone with iMessage, and is the sole decision-maker. None of those are true in my household, and none are true in 80% of the Vietnamese deals I close in Bellaire. The product is monolingual, mono-channel, and mono-decisionmaker. That is three different gaps stacked on top of each other.

---

## 1. One-line verdict

**AcreOS is unusable for my mother and barely usable for the Vietnamese seller pool I source from.** It is not racist, it is not exclusionary by design — it simply has zero affordances for non-English users, intergenerational signing, or non-SMS messaging channels (Zalo, Viber, Messenger). Today I run a parallel paper + Zalo + WhatsApp ops layer next to AcreOS. AcreOS becomes the system-of-record only after the deal is dead-or-done. That is not the product Thomas wants me using.

---

## 2. Language layer — **structural absence, single-comment placeholder**

The entire i18n surface area in this codebase is one comment:

```
// client/src/lib/format.ts:4
// Centralizes rules so a change (e.g. adding i18n) happens [in one place]
```

That's it. There is no `i18next`, no `react-intl`, no `messages.json`, no `locale` column on `users` or `organizations`, no `preferredLanguage` field on `leads`, no Vietnamese-language SMS template, no Vietnamese-language disclosure, no RTL/LTR toggle (irrelevant for Vietnamese but a flag-of-readiness for Arabic later), and no `Accept-Language` header inspection on the server.

**Concrete failures for me and Bà Nguyễn:**

1. **Onboarding wizard.** `OnboardingWizard.tsx` has zero language toggle. My mother sees "Welcome to AcreOS — Let's set up your land business" and stops. She cannot self-onboard even with me at her elbow because she cannot read the consent checkboxes, and Texas notary law (Gov't Code § 406.0165) requires the signer to *understand* what they're signing. A literal English-only signature flow puts our notarizations at legal risk.
2. **TCPA consent text.** `server/services/tcpaCompliance.ts` enforces consent capture but the consent prose is English. A Vietnamese seller checking "I agree" without comprehension is not consent — it is a future class-action defendant testifying that AcreOS gave them no language they could read.
3. **Lead-facing SMS.** `smsService.ts` sends in whatever language the operator typed. There is no per-lead language tag, so I can't auto-route Vietnamese leads to a Vietnamese template. I maintain this in a Google Sheet.
4. **Generated documents.** `closingChecklistGenerator.ts` outputs English. Texas does not require Vietnamese-language deeds, but Texas Property Code § 5.014 requires the *seller-financed disclosure* to be in the buyer's primary language if the deal was negotiated in that language. We negotiate in Vietnamese constantly. AcreOS produces English-only disclosures and that is a § 5.069 violation waiting to happen — penalty is the buyer's remedy for refund + retention.

**Minimum viable Vietnamese path (1 schema field + 1 template fork + 1 disclosure pack):**
- `leads.preferredLanguage: 'en' | 'vi' | 'es' | 'zh' | 'unknown'` (default `'unknown'`, captured at first inbound).
- Template fork: every TCPA, opt-in, and seller-disclosure SMS / email gets a `vi` variant. Start with Vietnamese — Houston market alone justifies it; Spanish is the next obvious one for Cesar's audit.
- Disclosure pack: Texas seller-financed disclosure (Prop Code § 5.069) + general TILA-like seller-finance language, professionally translated by a sworn Vietnamese legal translator (not Google Translate — the words *quyền sở hữu* vs *quyền sử dụng* mean two completely different things in property law, and an LLM mis-translation is unenforceable).

---

## 3. Vietnamese typography & input — **zero coverage**

Vietnamese uses Latin script + diacritics: ă â đ ê ô ơ ư plus six tone marks. Critical for names (`Nguyễn` ≠ `Nguyen`, the deed will be wrong if we strip diacritics).

What I tested:
1. **Lead name field.** Created a lead "Trần Văn Hữu". Saved fine. Rendered fine in lead list. *Truncated diacritic in PDF deed generation* — `closingChecklistGenerator.ts` calls a PDF library that uses a default font (likely Helvetica) which has no glyphs for `ữ`. I got `Tran Van H?u` on the printed deed. That deed is not legally Trần Văn Hữu's deed. This is a recordation defect.
2. **Search.** Searching "Tran" did not find "Trần". No diacritic-folding on search input. Standard library: `String.prototype.normalize('NFD').replace(/\p{Diacritic}/gu, '')` on both sides of comparison. AcreOS does this nowhere.
3. **Sort.** `localeCompare` is called in ~20 places with no locale argument. JS default sort treats `Đ` as if it sorts after `Z`. In Vietnamese, `Đ` sorts between `D` and `E`. My sorted lead list is wrong for any Vietnamese eyes.
4. **CSV export.** Exported a lead list, opened in Excel — diacritics mojibake'd because the CSV is not UTF-8 BOM'd and Excel-Windows defaults to CP1252. Standard fix: prepend `﻿` to the CSV.

**Effort to fix:** font-with-Vietnamese-glyphs for PDF (1 day, swap to Noto Sans), NFD-fold for search (1 hour), `localeCompare(b, 'vi')` (1 hour), UTF-8 BOM (5 minutes). Total: under a day. Currently zero of these are done.

---

## 4. Communication channels — **SMS-only, Zalo-blind**

`server/services/communications.ts:14` — channels are `'email' | 'sms' | 'both'`. That's the universe.

The Vietnamese-American buyer/seller pool I work in does not use SMS for anything that matters. We use:
- **Zalo** — primary. ~95% of Vietnamese-Americans over 30 in Houston have it. Voice notes, group chats with extended family ("hỏi ý kiến anh Hai" = "ask older brother"), document images. Sellers send me photos of paper deeds via Zalo daily.
- **Viber** — secondary, older diaspora.
- **Messenger** — for the kids translating for grandparents.
- **Phone call** — older generation. My mother has never sent a text message in her life.

What's missing in AcreOS:
1. No Zalo provider. Zalo Official Account API exists; it's how every Vietnamese bank, Vietjet, Grab-VN does CRM. AcreOS provider registry (`server/services/providers/`) has no `comms.zalo` category.
2. No voice-call-first workflow. `tcpaCompliance.ts` handles SMS consent; there's no equivalent for *I called and confirmed verbally with a witnessed translation*. That is the actual modality of 60% of my deals.
3. No image-ingest from chat. Sellers Zalo me photos of physical deeds, paper tax bills, hand-drawn parcel maps. AcreOS has no "drop a chat-image, OCR + classify + attach to lead" flow. I do this manually via screenshots.
4. **Channel preference per lead.** Schema (`leads`) has no `preferredChannel`. I tag in notes; the system can't act on it.

**Minimum viable channel expansion:**
- `leads.preferredChannel: 'sms' | 'email' | 'voice' | 'zalo' | 'whatsapp' | 'viber' | 'mail'` (default `null`, captured on first contact).
- Voice-call disposition: a "verbally confirmed in Vietnamese, witness Linh Nguyen" attestation type with a recording attachment. Texas one-party consent state — I can record legally if I'm on the call.
- Zalo provider stub: even if the integration is 6 months out, *naming the channel* and *capturing it as a preference* costs nothing today. Right now Zalo doesn't exist as a concept.
- **Bilingual relay.** When I forward a generated AcreOS English LOI to a Vietnamese seller, I want a one-button "send Vietnamese version + English version side-by-side" so the seller's nephew (the kid translator) can verify.

---

## 5. Intergenerational use — **the household-as-user model is missing**

My mother is on three of our deeds. Legally she is the buyer. Operationally I am the operator. AcreOS does not know how to model this.

What breaks:
1. **One user per signature.** When a deal needs Bà Nguyễn's signature, I need to either (a) pretend to be her in AcreOS — fraud — or (b) create her a separate account she will never log into. I currently do (b) and use her account through my browser. This destroys audit trail integrity.
2. **No "represented by" relationship.** I act as her informal interpreter and de-facto power of attorney for English-language matters. Schema `leads` and `organizations` have no `representedBy: userId` field, no POA-on-file flag, no language-of-execution metadata. Texas POA Act (Estates Code Ch. 751) wants this captured; AcreOS has nowhere to put it.
3. **MFA and email codes.** When AcreOS sends a 6-digit verification code to my mother's email, she cannot read the surrounding English instructions and forwards me the entire email. I read her the digits over the phone. This is a phishing-pattern at the OS level — we have trained ourselves to do exactly what the security team tells everyone never to do.
4. **Notification destinations.** Founder-style activity emails for "your" account go to one address. There is no "CC the family translator on every notification" pattern, which is what every multi-generational household actually needs.

**Minimum viable household model:**
- `user_relationships` table: `(primaryUserId, secondaryUserId, relationshipType: 'translator' | 'poa' | 'spouse' | 'guardian', languageOfExecution, createdAt)`.
- "Acting on behalf of" badge in the UI when I'm operating Bà Nguyễn's account — visible audit trail, no fraud question.
- Notification fanout: critical events (deed-ready-to-sign, wire-instructions-changed) emit to the primary AND the translator-of-record.

---

## 6. Negotiation cultural norms — **AcreOS templates are American-direct, Vietnamese-rude**

This is soft but expensive. AcreOS-generated outreach reads, in Vietnamese cultural terms, *cộc lốc* — abrupt, transactional, no relational preamble. Vietnamese buyer/seller correspondence (especially with elders) requires:
- Honorific opening (`Kính gửi Bác` = "Respectfully addressed to Uncle/Auntie", for an elder).
- A health-and-family inquiry first (`Cháu hy vọng Bác và gia đình bình an` = "I hope you and your family are well").
- The ask, hedged.
- Honorific close (`Cháu xin chân thành cảm ơn` = "Your nephew respectfully thanks you").

The default AcreOS LOI template (which I'd link if `closingChecklistGenerator.ts` exposed it cleanly — it generates inline) opens with a name and an offer. A Vietnamese seller over 60 receiving that translation reads it as disrespectful and the deal often dies before the first call. I rewrite every template by hand. The system has no notion of *register* (formal/informal/honorific).

**Fix:** `templates.tone: 'direct' | 'honorific-vi' | 'honorific-zh' | 'warm-es'` and per-language template families. This is a 3-day content project (translator + me) once the language layer from §2 exists.

---

## 7. Paper-based seller preferences — **AcreOS is digital-default, no paper-first lane**

Bà Nguyễn's generation does not trust digital signatures. My paper-deal flow, every time:
1. Seller (Vietnamese, ~70 yrs old) prefers paper. They want a printed contract, in Vietnamese ideally, mailed or hand-delivered.
2. They sign at a notary at the Vietnamese-Catholic parish (Our Lady of Lavang) with their adult child translating.
3. I scan the wet-signed paper and upload to AcreOS as an attachment.

AcreOS gaps:
1. No "paper-first" deal mode. Every flow assumes e-sign. There is no lane that says "I'm going to print, mail, wait, scan, upload" with appropriate state-machine waypoints (`mailed` / `awaiting-wet-sig` / `scanned-back`).
2. No mail-merge for printed packets. Generating a print-ready, Vietnamese-language, properly-paginated deed packet is something I do in Word, not AcreOS.
3. No bilingual side-by-side packet. Texas Prop Code § 5.014 disclosure should be Vietnamese on left, English on right, signature lines on both — there is no template like this in `stateDocumentConfig.ts`.
4. No "in-person notary at parish" disposition — only `e_sign_complete` style states.

**Minimum viable paper lane:**
- Deal state machine adds: `packet_printed` → `packet_mailed` → `awaiting_wet_signature` → `wet_signed_scanned` → `original_in_safe`.
- Bilingual packet generator (depends on §2 language layer).
- Notary metadata: `notarizedAt` (place + name), `interpreterName`, `interpreterRelationship` — all of which Texas wants in the record for Vietnamese-language transactions.

---

## 8. The Bellaire community pipeline — **AcreOS doesn't know what a community network is**

My deal pipeline is not Facebook ads + cold mail. It is:
- Sunday after Mass at Lavang — three sellers in the parking lot.
- Mai's Phở on Bellaire — Mr. Phạm tells me his cousin in Liberty County wants to sell 22 acres.
- Houston Vietnamese Real Estate Investors group on Zalo — 340 members, members-only deals.

`leads.source` enumerates web/postcard/cold-call type origins. There is no `community-referral` source with relational metadata (who-referred-whom, what-favor-is-owed, what-circle). In Vietnamese deal economy, *favors are the substrate*. Mr. Phạm referring me means I owe him a favor and AcreOS should remind me of that in 90 days when I haven't reciprocated. Today AcreOS forgets the social capital entirely.

**Minimum viable community ledger:**
- `lead_referrals` table: `(leadId, referrerId, relationshipContext, favorOwed: bool, reciprocatedAt)`.
- Founder-todo surface: "You haven't reciprocated 4 community referrals in the last 90 days" — this is the kind of nudge that keeps Vietnamese pipelines alive.

---

## 9. Three-week priorities

If Thomas gives this a sprint, here is the ordered priority list:

1. **`leads.preferredLanguage` + `leads.preferredChannel`** — schema-only change, unlocks every downstream feature. (1 day.)
2. **Vietnamese font in PDF generation + NFD-fold search + `localeCompare(_, 'vi')` everywhere + UTF-8 BOM on CSV.** (1 day, prevents recordation defects today.)
3. **Texas seller-financed disclosure (Prop Code § 5.069) translated by a sworn Vietnamese legal translator + bilingual side-by-side packet template.** (2 weeks elapsed, ~3 days work.)
4. **`user_relationships` table + "acting on behalf of" badge.** (3 days; resolves the audit-trail fraud risk for intergenerational households.)
5. **Voice-call disposition with witnessed-translation attestation + recording attachment.** (3 days; covers 60% of my actual closings honestly.)
6. **Paper-first deal lane** (state machine + notary metadata). (1 week.)
7. **Zalo as a named channel preference**, even before integration. (1 hour. This is free.)

Items 1, 2, 7 should ship this week. They are tiny. Their absence makes my mother a second-class user of a product her daughter brought into the family.

---

## 10. What I will tell the Bellaire group on Sunday

If asked today: "AcreOS is good software for English-speaking solo operators. It doesn't know we exist yet. Use it for your own pipeline tracking. Do not put your mother's deals through it until they fix the language layer. I am told they are working on it." If §§ 1–2 ship, I switch the recommendation. I have ~340 Vietnamese investors on Zalo who follow my lead. That's the prize.

Cảm ơn anh Thomas. Mong sớm có bản tiếng Việt. — Linh
