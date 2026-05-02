# Camille Leblanc — AcreOS French-Canadian / Cross-Border Audit

**Persona:** Camille Leblanc, 51, Montréal (Outremont). Quebec-resident Land Investor working US deals — primary buy boxes in upstate NY (Adirondacks, Saint Lawrence, Franklin), VT (Orleans, Essex), ME (Aroostook, Piscataquis). 14 deals/year, ~$1.6M USD GMV, holds long via seller-financed notes denominated in USD but settled into RBC USD account. Native French; bilingual but distinguishes legal registers — *contrat de vente* is not a "purchase agreement," *acte notarié* is not a "deed," and *hypothèque* is not a "mortgage" in the civil-law sense.
**Wave:** 3 of 87-persona AcreOS audit, French-Canadian / cross-border lens.
**Date:** 2026-05-01.
**Surfaces reviewed:** `client/src/lib/format.ts`, `client/src/components/document-generator.tsx`, `client/src/components/mail-settings-content.tsx`, `client/src/components/onboarding/OnboardingWizard.tsx`, `server/services/stateDocumentConfig.ts`, `server/services/closingChecklistGenerator.ts`, `server/services/closingCostEstimator.ts`, `server/services/eSigningService.ts`, `server/services/documents.ts`, `shared/schema.ts` (`organizations`, `users`, `leads`, `properties`, `payments`, `notes`). Full-tree greps for `i18n|locale|fr-CA|fr_CA|francais|français|Quebec|québec|CAD|GST|HST|QST|civil law|notaire|hypothèque|treaty|NR4|T1135|FX|exchange.rate`.

J'arrive à AcreOS par un collègue de Plattsburgh. Il m'a dit "*ça marche en anglais, mais ça marche*." Il avait à moitié raison. AcreOS marche pour un *Land Investor* américain monoglotte. Pour moi, il marche **avec un astérisque sur chaque écran** — et l'astérisque, personne d'autre que moi ne le voit.

Je ne demande pas à AcreOS d'être un produit canadien. Je demande à AcreOS d'**arrêter d'assumer que je suis américaine**. Ce sont deux ambitions très différentes. La deuxième se règle en deux sprints.

---

## 1. Verdict en une ligne

**AcreOS aujourd'hui suppose que chaque utilisateur est anglophone, résident américain, contribuable IRS, payant en USD, achetant sous *common law*, et signant en anglais.** Pour un Land Investor canadien achetant aux États-Unis, AcreOS est *utilisable* (le pipeline, le scoring, le skip trace fonctionnent), mais **toute surface en aval de la décision d'achat — closing, fiscalité, notes seller-financed, reporting — est silencieusement fausse pour moi**. Pas hostile : ignorante. La distinction compte parce qu'elle décrit le coût de réparation : ~3 sprints, pas une réécriture.

---

## 2. Pas d'i18n — pas même la fondation

Cherché : `i18next`, `react-intl`, `lingui`, `formatjs`, `messages.fr`, `locale`, `lang`. Trouvé :

1. **Zéro dépendance i18n** dans `package.json`. Aucune. `client/src/lib/format.ts` est explicite à ce sujet : le commentaire d'en-tête dit *"Centralizes rules so a change (e.g. adding i18n) happens once"* — bonne intention, mais le fichier hardcode `"en-US"` dans **chaque appel `Intl.NumberFormat`** (`format.ts:16, 59, 80, 134, 146`).
2. **Aucun champ `language` ou `locale`** sur `users` ou `organizations` dans `shared/schema.ts`. Il y a `country` (default `"US"`, `schema.ts:5232`) mais c'est l'adresse de l'organisation, pas la préférence linguistique de l'utilisateur.
3. **Toutes les chaînes UI sont hardcodées en anglais.** Pas de fichier de catalogue. Pas de `t()`. Pas de `<FormattedMessage>`. Les emails transactionnels (Mailgun templates dans `server/services/email/`) sont en anglais uniquement.
4. **Pax (la voix client de l'IA) parle uniquement anglais** — `server/routes-pax.ts` system prompts ne mentionnent jamais la langue de l'utilisateur. Si je tape une question en français à Pax, il répondra en anglais avec le ton "professional warm" peu importe.

**Ce que ça veut dire concrètement.** Quand je présente AcreOS à un *acheteur* québécois pour un closing bilingue (la moitié de mes acheteurs revendeurs sont québécois), je ne peux pas leur servir un *résumé du contrat* dans leur langue depuis l'application. Je dois copier-coller dans DeepL et corriger à la main. Pour un produit qui se vante de *native e-sign* (memoire utilisateur), c'est une faille de production.

**Plancher minimal viable :**
- `users.preferredLocale: 'en-US' | 'en-CA' | 'fr-CA' | 'es-MX'` (commencer petit, mais le slot existe).
- `format.ts` accepte un argument `locale` (default `en-US`), tous les `Intl.NumberFormat` lisent depuis `useLocale()`.
- Catalogue de chaînes pour les 6 surfaces customer-visible : onboarding, lead detail, offer wizard, closing checklist, signature flow, email templates. Pas besoin de traduire les surfaces founder (Sophie/Forge/Atlas) — je suis user, pas founder.
- Pax accepte `respond_in_locale` dans le prompt système, branché sur la préférence utilisateur.

Coût estimé : 2 semaines pour le slot + format.ts + onboarding + closing flow. Le reste peut suivre.

---

## 3. Devise — USD hardcodé partout, et c'est un problème *pour moi qui transige en USD*

Subtilité importante : **mes transactions sont en USD** (j'achète des terres américaines). Je n'ai pas besoin que AcreOS *convertisse* en CAD. J'ai besoin que AcreOS **sache que je vais convertir, et m'aide**.

Trouvé dans `client/src/lib/format.ts`:
```ts
// L. 16-20
new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",   // hardcoded
  maximumFractionDigits: 0,
}).format(abs);
```

Quatre fonctions (`dollars`, `dollarsCompact`, `usd`, `count`) ont toutes `"en-US"` + `"USD"` codées en dur. Et il y a **trois implémentations parallèles de `formatCurrency`** dans `freedom-progress-card.tsx`, `ai-offer-generator.tsx`, `team-dashboard-content.tsx`, `research-summary-panel.tsx`, `cohort-retention-dashboard.tsx`, `attribution-analytics.tsx` — chacune réinvente la roue, **toutes hardcodent USD**. C'est un futur drift désastreux quand on ajoutera CAD/MXN.

**Ce dont j'ai besoin que les Américains n'imaginent pas :**

1. **Affichage dual-currency optionnel** sur les surfaces de portefeuille. Quand je regarde mon `freedom-progress-card`, je veux voir mon revenu passif mensuel en USD **et** une estimation CAD à côté (avec date du taux et source). Pas un toggle global — un secondary display contextual.
2. **Taux FX historique sur les transactions**. Quand je marque un closing à $42,000 USD le 14 mars 2026, le système devrait capturer le taux Banque du Canada de ce jour (1 USD = 1.3782 CAD selon Banque du Canada noon rate, qui est l'autorité ARC). Aucune table `fx_rates`, aucune colonne `recordedFxRate` sur `payments` ou `deals`. Quand je ferai ma déclaration T1 en avril 2027, je devrai reconstituer les taux à la main. **C'est une heure par closing × 14 closings = 14 heures de travail évitable par année.**
3. **Conversion des notes seller-financed**. Mes notes sont en USD mais ARC veut le revenu d'intérêt en CAD au taux moyen de l'année OU au taux du jour de chaque paiement. AcreOS calcule les amortization schedules (`server/services/notes/`) en USD only. Aucun export "CAD-equivalent" pour ARC reporting.

**Plancher minimal viable :**
- `payments.fxRateUsdCad: numeric(10,6)` + `payments.fxRateSource: text` + `payments.recordedAt: timestamptz`. Backfill via Banque du Canada API (gratuit, public).
- `format.ts` factorise sur `currency` argument; reduce les 6 implémentations parallèles à un seul appel.
- `organizations.reportingCurrency: 'USD' | 'CAD' | 'MXN' | 'EUR'` — affecte uniquement les surfaces summary, pas le storage.

---

## 4. Common law vs Quebec civil law — confusion sémantique fondamentale

Voici où AcreOS me trahit le plus. Je n'achète **pas** au Québec — j'achète à NY/VT/ME, donc *common law US s'applique*. Mais quand je présente un deal à un acheteur québécois (mon exit principal), je dois **traduire les concepts**, pas juste les mots. Ce ne sont pas des synonymes :

| Common law (US, en anglais) | Civil law (Québec, en français) | Différence sémantique |
|---|---|---|
| Deed | Acte notarié / acte de vente | Acte notarié *crée* la propriété; deed *transfère* le titre. Pas équivalents. |
| Warranty deed | Acte de vente avec garantie légale | Garantie légale est *automatique* en droit civil; renoncer requiert clause expresse. |
| Mortgage | Hypothèque immobilière | L'hypothèque est un *droit réel accessoire*, pas un transfert conditionnel de titre. |
| Title insurance | (n'existe pas en droit civil) | Au Québec, le *notaire* engage sa responsabilité professionnelle; pas d'assurance titre. |
| Easement | Servitude | Servitude exige acte notarié au Québec; easement peut être prescriptif aux US. |
| Quit-claim deed | (pas d'équivalent direct) | Acte de transfert sans garantie; civil law préfère acte de cession avec garanties limitées. |
| Promissory note | Reconnaissance de dette / billet | Civil law: pas d'instrument séparé; intégré au contrat de prêt. |
| Escrow | Compte en fidéicommis (notaire) | Notaire détient les fonds — pas un agent escrow tiers. |

`server/services/stateDocumentConfig.ts` encode la mécanique *correctement* pour les 50 états, mais les **étiquettes UI** (`document-generator.tsx:77 "Warranty deed"`, `:78 "Generate a warranty deed"`, `template-editor.tsx:37 "warranty_deed"`) sont des *termes de droit*, pas des *labels d'interface*. Si AcreOS un jour montre ces écrans à un Québécois en français, traduire littéralement *Warranty deed → Acte de garantie* serait **un faux ami juridique**. Le bon terme dépend de l'usage : pour décrire un document US à un lecteur québécois, c'est *« warranty deed (équivalent fonctionnel d'un acte de vente avec garantie légale en droit civil) »*.

**Ce que ça implique :** quand AcreOS internationalisera un jour, la couche fr-CA n'est **pas** une simple traduction de strings. C'est un *legal glossary mapping*. Le `template-editor.tsx` doit pouvoir produire un *bilingual cover sheet* expliquant à mon acheteur québécois que ce qu'il signe en anglais est **équivalent fonctionnel** mais non identique à un acte civiliste.

**Action immédiate (sans i18n) :** ajouter un champ optionnel `templateNotes_fr_CA` sur `documents` qui me laisse joindre une note explicative au PDF généré. Dix lignes de schema, valeur immédiate pour mes 6 acheteurs québécois actifs.

---

## 5. Fiscalité transfrontalière — absence structurelle du traité Canada-USA

Référence : Convention fiscale Canada-États-Unis (1980, protocoles 1983/1984/1995/1997/2007). Les implications pour moi :

1. **Article XIII (gains en capital) :** un résident canadien qui vend un immeuble aux États-Unis est imposable aux États-Unis sur le gain. Le Canada accorde un crédit d'impôt étranger (FTC) via T2209 jusqu'à concurrence de l'impôt fédéral canadien sur ce même revenu. Sans tracking de la *base d'imposition US* (cost basis + dépréciation MACRS si commercial), je ne peux pas remplir T2209 correctement.
2. **FIRPTA — déjà couvert dans Heng (foreign-buyer)** mais pour moi côté **vendeur** : quand je revends une parcelle US, mon *acheteur* US doit retenir 15% du prix brut. Avec un W-8BEN + Form 8288-B, je peux réduire la retenue à l'impôt anticipé. AcreOS n'a aucune surface 8288-B, comme noté dans heng-foreign-buyer.md §2.
3. **NR4 — slip canadien pour paiements à non-résidents.** Inverse : si jamais je vendais à un *autre* non-résident depuis ma structure canadienne, je devrais émettre un NR4. Pas pertinent pour mes deals actuels mais expose le pattern : AcreOS ne sait pas qu'il existe des *slips fiscaux non-IRS*.
4. **T1135 — Foreign Income Verification Statement (Canada).** Tout résident canadien dont les biens étrangers spécifiés excèdent 100k CAD au coût doit produire T1135 annuellement. Mes 14 parcelles US dépassent ce seuil de loin. AcreOS calcule `costBasis` en USD; pour T1135 je dois convertir en CAD au taux moyen annuel ou au taux du jour d'acquisition. **Aucun export T1135-ready.**
5. **GST/HST/QST sur honoraires de services US.** Quand je facture des services de *conseil en acquisition* depuis ma corp québécoise à un client américain, je collecte 0% (zéro-cotation) — mais je dois *déclarer le revenu* dans ma TPS/TVQ. Hors scope direct AcreOS, mais si AcreOS vise un jour un module *agency revenue tracking*, c'est un trou.

**Ce que je veux d'AcreOS, classé par effort :**

- **Trivial (1 sprint) :** capturer `acquisitionFxRate` et `dispositionFxRate` sur `deals`. Calculer un `cadEquivalent_costBasis` et `cadEquivalent_proceeds` en lecture. Exporter un CSV "T1135-ready" avec colonnes : description, country code, max cost during year (CAD), cost at year-end (CAD), income generated (CAD), gain/loss on disposition (CAD).
- **Modéré (2 sprints) :** branche le `closingChecklistGenerator.ts` sur `seller.taxResidency === 'foreign_person'` ET `seller.country === 'CA'` → injecter un item *"FIRPTA 15% retention OR Form 8288-B reduced-withholding application"* avec lien vers les instructions IRS, ET suggérer le formulaire Canadien équivalent (Notice of Disposition / T2062 si vendeur canadien revend US).
- **Long (1 trimestre) :** un module `cross-border-tax` qui croise IRS forms et ARC slips, avec rappels d'échéance (15 avril IRS, 30 avril ARC, 15 juin pour expats). Probablement hors scope de la promesse "Land Investor OS" mais ça serait l'unique différenciateur.

---

## 6. Banking et wires transfrontaliers

Mes paiements entrent et sortent par **wire international** (RBC USD account, ABA via correspondent BMO Harris). AcreOS sait gérer une `payments.wireConfirmation` (`schema.ts` recherche : `wireConfirmation` apparaît mais aucune logique IBAN/SWIFT/BIC).

- Pas de champ `swiftCode` / `bicCode` sur les wire instructions générées par `document-generator.tsx`. Mes acheteurs reçoivent des instructions ABA-only et doivent me revenir pour le SWIFT — *deux fois par mois en moyenne*.
- Pas de `intermediaryBank` field. Les wires Canada → US passent par une banque correspondante; sans ça, le wire échoue ou est retourné avec frais.
- Pas de validation *country-specific* sur le `mailing address` de l'organisation. `mail-settings-content.tsx:85` accepte un select `country` mais le default est `"US"` et aucune logique downstream ne s'adapte.

**Plancher :** ajouter `wire_instructions` table avec `aba`, `swift`, `bic`, `iban`, `intermediaryBank`, `intermediarySwift`, `currency`. Ajouter un *country-aware* address validator (postal code regex par pays — H3T 1J7 ≠ 90210 ≠ M5V).

---

## 7. Signature et closings bilingues

`server/services/eSigningService.ts` gère la signature électronique native (memoire utilisateur : *AcreOS ships its own signing stack; don't propose DocuSign*). Cherché `lang|locale|french|fr_CA` dans ce service : **zéro résultat**.

Implications :
1. Le *consent banner* de signature électronique (UETA / E-SIGN Act 2000) est en anglais. Pour un signataire québécois, la *Loi concernant le cadre juridique des technologies de l'information* (LCCJTI, RLRQ c. C-1.1) exige un consentement compréhensible — un anglophone québécois donnera consentement valide, mais un francophone non-bilingue, **non**. Risque d'invalidité de signature pour 30% de mes acheteurs.
2. Le `signing-token` email (`signingTokens.ts`) est en anglais. Mon acheteur québécois reçoit un email *"Your signature is requested"* dans sa boîte; certains clients âgés le marquent comme spam parce que l'expéditeur "ne parle pas leur langue." J'ai perdu un closing là-dessus en septembre 2025.
3. Le PDF audit trail (timestamp, IP, user agent) est en anglais. Si je dois produire ce trail dans une procédure québécoise, je dois faire traduire — frais de notaire/traducteur agréé ~400$ CAD par dossier.

**Plancher :** template `consent-banner` accepte une variante `fr-CA` (juridiquement validée — pas DeepL); email `signing-token` honore `recipient.preferredLocale`; audit trail PDF a un *bilingual header* (en + fr) sans toucher au contenu.

---

## 8. Onboarding — premier point de friction

`client/src/components/onboarding/OnboardingWizard.tsx` (canonique, per memoire utilisateur). Cherché `country` ou `locale` ou `province` dans le wizard : aucun champ.

- Le wizard demande `businessType` (land_flipper, note_investor, etc.) mais ne demande **jamais** où je *réside* ni où je *transige*. Il assume implicitement résidence US.
- `preferredStates` est un select de 50 états US. Je transige en NY/VT/ME — OK. Mais si je voulais *aussi* tracker mes deals canadiens (j'en ai 2 en Estrie), aucun mécanisme.
- Le `taxClassification` (sole prop, LLC, S-corp, etc.) est une enum US-only. Pas de *société par actions* (SPA québécoise), pas de *société en nom collectif* (SENC). Si j'opère via ma SPA (typique chez nous), je dois mentir et dire "LLC" — l'output downstream sera faux.

**Plancher :** ajouter un `residencyCountry` step ('US' | 'CA' | 'MX' | 'other') tôt dans le wizard. Si non-US, branche conditionnelle qui (a) flag l'org `crossBorder: true`, (b) capture la province pour CA / état pour MX, (c) ajuste le `taxClassification` enum, (d) demande la devise de reporting préférée.

---

## 9. Synthèse — ce qui est réparable cette semaine vs ce trimestre

**Cette semaine (low-hanging) :**
- `format.ts` accepte un `locale` argument (default `en-US`), supprime les 6 implémentations parallèles de `formatCurrency`. Une PR.
- `users.preferredLocale` column + un toggle Settings minimal. Une PR.
- `payments.fxRateUsdCad` capture automatique via Banque du Canada API au moment du payment record. Une PR.

**Ce sprint :**
- T1135-ready CSV export pour utilisateurs `crossBorder: true`.
- Champ `residencyCountry` dans onboarding + branche conditionnelle.
- Wire instructions complètes (SWIFT/BIC/intermediary).

**Ce trimestre (si AcreOS prend le marché canadien au sérieux) :**
- Catalogue fr-CA pour 6 surfaces customer-visible (pas founder).
- FIRPTA / 8288-B pre-fill workflow (chevauche avec heng-foreign-buyer §2).
- Bilingual signing consent + email templates.
- Civil-law glossary mapping pour acheteurs québécois sur templates downloads.

**Hors scope explicite (je ne le demande pas) :**
- Module GST/HST/QST collection (je n'utilise pas AcreOS comme système de facturation client).
- Traduction des surfaces founder (Sophie/Forge/Atlas) — je suis customer, pas founder.
- Support de transactions au Québec sous droit civil — j'achète US, pas QC.

---

## 10. Ce qui marche bien pour moi aujourd'hui

Pour être juste : le *pipeline* (lead scoring, skip trace, parcel research, comps) est **agnostique de ma nationalité**. Le `legal-intelligence-card.tsx` me sert correctement les risques de partition / adverse possession qui s'appliquent à mes parcelles US. Le `closingChecklistGenerator` produit des checklists par état qui sont mécaniquement correctes — c'est seulement quand on touche à *qui* signe et *quelle devise* que ça casse. Pax m'aide en anglais sans broncher (je suis bilingue, donc OK). C'est un produit que j'utilise et que je continuerai d'utiliser.

Mais : *un produit que j'utilise avec des notes Post-it sur trois écrans n'est pas un produit qui m'a comprise.* AcreOS m'a comme cliente par défaut — pas par conception. Le différentiel se mesure en heures de mon temps qui partent dans Excel chaque mois.

— Camille
