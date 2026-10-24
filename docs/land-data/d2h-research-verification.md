# D2h — verify-and-decide on the data-sourcing research

_Lane D2h, Package D2, 2026-10-24. Repo base `8d949e85`. Docs only — this file changes no code, cost table, credit weight or registry entry._

## What this is, and what it is not

The package asked for a spot-check of the load-bearing evidence in the ChatGPT research behind D1/D2, without redoing the literature search. **The research itself was not available.** The chat link returns 403 from this container, and the content is not in the repo (`grep -ri chatgpt docs/` finds only next-moves and unrelated audit personas). So this report cannot say whether *the research* was right.

What it does instead is check the **external claims the code and docs already depend on**. These are the claims the research was meant to underpin. For each one it records where the repo relies on it, what could be read from here, and a verdict.

### What could and could not be reached (tried 2026-10-24, EDT)

| Channel | Result |
|---|---|
| `WebFetch` (regrid.com/api, law.cornell.edu) | Failed: `getaddrinfo ENOTFOUND` on both. I stopped trying after that. |
| `curl` through the agent proxy | `raw.githubusercontent.com`, `registry.npmjs.org` and `pypi.org` → 200. `regrid.com`, `law.cornell.edu`, `uscode.house.gov`, `govinfo.gov`, `ftc.gov`, `epa.gov`, `nconemap.gov`, `comptroller.tn.gov` → proxy `CONNECT` 403 / unreachable. |
| `WebSearch` | Works, but it returns a **model-written summary of search snippets**. It does not return the page. |

### Verdict vocabulary (strict)

- **Confirmed**: I read the primary source in this session, and the quote is copied byte-for-byte from the fetched file.
- **Search-corroborated**: a WebSearch summary agrees with the claim, but I never opened the primary page. **This is not confirmation.** Snippet fragments are labelled as the search tool's text, never as verbatim quotes from the source.
- **Contradicted / conflicting**: the best available evidence disagrees with the repo.
- **Not verifiable here**: there is no reachable source and no useful search signal.
- **Repo-recorded**: an earlier session wrote down a verbatim quote with a read date. I did **not** re-read it. It is listed so the reader knows that evidence exists, but I am not vouching for it.

---

## 1. Claim register

### A. Vendor pricing

| # | Claim | Repo reliance | Source actually read | Verdict |
|---|---|---|---|---|
| A1 | Regrid API price floor: **10¢/record Standard, 15¢/record Premium**, billed per record **returned** (a call that returns nothing is unbilled). | `server/services/providers/regrid-provider.ts:24-33` (`REGRID_CENTS_PER_RECORD`). The comment itself says it was "Not re-read live from this container". `shared/billing/credit-weights.ts:47-49, 75-85`. The founder re-base of 2026-10-23 (`b576d53f`, next-moves D1a) put `parcel_lookup_paid` at 10 and `owner_lookup`/`valuation_lookup` at 15. | None. regrid.com is unreachable. WebSearch, 2026-10-24: its summary says a **January 2023** Regrid price-change notice (`regrid.com/blog/2023-parcel-data-price-change`) lists "$0.10 per record for the Standard Schema, $0.15 for Premium Schema". The same summary says Regrid docs track billing "by how many Parcel Records are returned in a response", and that self-serve "starts with 2,000 parcel records per month plus additional per record pricing" (`support.regrid.com/reference/plan-options`). All of that is search-tool text. I opened no page. | **Search-corroborated, not confirmed.** The figures match. But the only dated source is from **2023**, and the summary itself warns it does not show whether they still apply. There is also a modelling gap: self-serve is a *subscription with included records plus overage*, not a pure per-record price. So "cost per lookup" depends on the plan AcreOS actually holds. |
| A2 | ATTOM costs 5–20¢ per lookup. | `server/services/providers/attom-provider.ts:4`; `credit-weights.ts:49, 83` (`comps_lookup: 20` is justified by "ATTOM comps up to 20¢"). | Not searched or read. | **Not verifiable here.** There is no source citation anywhere in the repo. |
| A3 | BatchData costs 3–15¢ per lookup. | `server/services/providers/batchdata-provider.ts:5`. | Not read. | **Not verifiable here.** No source citation. |

### B. Statewide parcel layers: terms, redistribution, cadence

Every statewide dossier in `server/services/openData/statewideSourceRegistry.ts` (`:46-48, :64-74`) is already `unresolvedDossier(…, NOT_READ, …)`, and its policy is the restrictive default. **The code already assumes nothing about these terms.** The checks below matter for *un-blocking* work, not for un-shipping it.

| # | Claim | Repo reliance | Evidence this session | Verdict |
|---|---|---|---|---|
| B1 | **TN**: the TNMap "Property Boundaries Public Use" service bars commercial use, so the statewide shortcut is closed. | `server/services/landData/tnParcelSources.ts:5-12`; `docs/company/founder-decisions-2026-10-11.md:11-20`; `statewideParcelEndpoints.ts` (TN row removed); `blockedOutboundSources.ts`. | Repo-recorded quote, read 2026-10-10: "This service is not intended for commercial use. For commercial purposes, we recommend that you download the data at the Tennessee Comptroller of the Treasury's webpage." I did not re-read it (host unreachable). | **Repo-recorded; not re-verified.** The direction is conservative: if the quote were wrong, AcreOS would only be refusing a source it could have used. **No risk.** |
| B2 | **TN** Comptroller per-county download: "can be used in a commercial application", form-gated, no automated downloads, **updated weekly**. | `tnParcelSources.ts:14-20, 27-36` (`mayStore: true`); `docs/company/open-data-w2-tennessee.md:12`. | WebSearch, 2026-10-24. Its summary attributes this to the Comptroller parcel-data page: "The data will be updated once a month around the first business day of the month." It did **not** find the "commercial application" sentence. | **Conflicting on cadence; commercial-use permission search-unverified.** `mayStore: true` rests only on the repo-recorded quote. "Weekly" vs "once a month" is a direct conflict. |
| B3 | **FL** DOR statewide cadastral: annual cadence, **published each August**; terms at `floridarevenue.com/.../Cofficial_GIS.aspx`. | `statewideSourceRegistry.ts:50-51` (`publishedMonth: 8`, source "D1 data-sourcing package", not the state); `statewideParcelEndpoints.ts:98-100`; `open-data-program.md:103-104` (10.8M parcels). | WebSearch, 2026-10-24. Its summary gives two months: DOR "collects parcel-level GIS files each April" from the 67 appraisers, and an FDACS-hosted service description says the data are "provided by each county property appraiser every July". It found **no redistribution statement**. It did mention a Chapter 119 confidential-record redaction duty on counties, with a notify-DOR instruction. | **Cadence conflicting** (April / July / August all appear). **Terms not verifiable here.** The Ch. 119 confidential-record point is not modelled anywhere I found in the repo. |
| B4 | **NC** OneMap statewide parcels: free statewide program. | `statewideParcelEndpoints.ts:136-157`; `open-data-program.md:103-111`; seeded inactive job (0288). | WebSearch, 2026-10-24. Its summary cites the NC OneMap disclaimer ("free to use by…", truncated). It also cites **N.C.G.S. 132-10**, which lets a county or city require that a copy of a GIS database "will not be resold or otherwise used for trade or commercial purposes". It notes the statewide layer keeps county source geometry "as published by individual county data producers", and that a 2022 GICC review of the disclaimer covered resale and commercial use. All of this is search-tool text; I opened no page. | **Not verifiable here, with a specific risk.** County-level resale conditions under G.S. 132-10 could follow the data into the aggregate. Bulk storage or redistribution is exactly the use most likely to be affected. |
| B5 | **MT** Cadastral (MSDI): **monthly** cadence. | `statewideSourceRegistry.ts:52`; `statewideParcelEndpoints.ts:109-129`. | WebSearch, 2026-10-24. It found monthly language only for a *related* layer, plus a State Library "counties updated this month" map. It says it found "no stated update schedule for the statewide parcel layer itself". No license or use-constraint text, only a not-a-survey disclaimer. Five counties (Ravalli, Silver Bow, Missoula, Flathead, Yellowstone) maintain their own data. | **Partially / search-only.** Monthly is plausible, not established. Terms not found. |
| B6 | **AR** CAMP parcel polygons: **semi-annual** cadence, ~74/75 counties. | `statewideSourceRegistry.ts:53`; `statewideParcelEndpoints.ts:209-235`. | WebSearch, 2026-10-24. Its summary quotes the AGIO metadata page (`gis.arkansas.gov/metadata/HTML/asdi.planning_cadastre.PARCEL_POLYGON_CAMP_export.html`): "Published updates may be made throughout the year, but scheduled updates occur semi-annually." It also mentions 73→74-county update notices. Use terms are an "as is" disclaimer plus Ark. Code 15-21-504 (not a legal boundary). It found no formal licence. | **Search-corroborated** on cadence and county count. **Terms not verifiable here.** No affirmative licence was found, only disclaimers. |
| B7 | **WI** statewide parcels: item licence says "This data free for public consumption as of: 06/30/2026". | `statewideParcelEndpoints.ts:283-310` (licence reviewed 2026-07-28). | Not re-read. Not searched. | **Repo-recorded; not re-verified.** Note that "free for public consumption" does not say whether commercial bulk redistribution is allowed. |
| B8 | **MD** iMAP: "The Data can be freely distributed as long as the metadata entry is not modified or deleted". | `statewideParcelEndpoints.ts:312-340`. | Not re-read. | **Repo-recorded; not re-verified.** This is the strongest affirmative grant among the states. |
| B9 | **NY / WA / NJ**: statewide programs, licence "reviewed". | `statewideParcelEndpoints.ts:159-208, 236-280`; RCW owner-name restriction for WA at `statewideSourceRegistry.ts:56-62`. | Not read. | **Not verifiable here.** The WA RCW section is still uncited, as the registry itself already says. |
| B10 | **IN, OH**: no verified statewide row, so the build refuses. | `server/services/landData/statewideCadastral.ts:10, :80`; next-moves D2a. | WebSearch, 2026-10-24. **IN**: the summary says IndianaMap parcel records are listed with "Public" rights, and a 2015 announcement promised REST services and free download (`gisdata.in.gov/.../Parcels_Boundaries_of_Indiana_2013`). **OH**: the OGRIP statewide layer has a **blank licence field** and rights "Public". No licence statement was found. | **Consistent with the repo's refusal.** Neither state has an affirmative licence in evidence. |
| B11 | **TX**: no verified beachhead counties; refuses. | `statewideCadastral.ts:10`; next-moves "TX". | WebSearch, 2026-10-24. Its summary says TxGIO StratMap Land Parcels has licence field "None", and quotes the FAQ purpose as "acquire statewide land parcel data in one location at no cost". It adds a not-survey-grade disclaimer and an "attempt to refresh annually from each appraisal district". It lists access as "TxGIO, Various Counties, **Various Vendors**". | **Consistent with refusal.** "No cost" is not a licence, and "Various Vendors" signals third-party content that may carry its own terms. |
| B12 | KS licence unclear, so excluded. | `statewideParcelEndpoints.ts:25-26`; `open-data-program.md:49-50`. | Not checked. | **Not verifiable here.** Conservative direction, so no risk. |

### C. FCRA permissible purposes

| # | Claim | Repo reliance | Evidence this session | Verdict |
|---|---|---|---|---|
| C1 | Skip-trace may proceed on one of `collection`, `legitimate_business_need`, `written_consent`, `account_review`, and that list is "FCRA §1681b(a)(3)". | `server/services/fcraAttestation.ts:33-58` (enum and `SKIP_TRACE_PURPOSES`), `:84-87` (the error text cites §1681b(a)(3)). The D2e purpose ledger (next-moves D2e) records these codes on every person-adjacent lookup. | Statute pages unreachable. WebSearch, 2026-10-24: the search tool returned what it presents as the text of §1681b(a)(3)(F): "otherwise has a legitimate business need for the information— (i) in connection with a business transaction that is initiated by the consumer; or (ii) to review an account to determine whether the consumer continues to meet the terms of the account." This is search-tool text; the LII and govinfo pages were not opened. Its summary also reports an FTC staff letter reading (F) narrowly (the *consumer* must initiate). | **Partially / not confirmed.** Two problems, both from the statute's structure and both needing a human with the text in hand. (1) **Citation error.** Consent of the consumer is §1681b(a)**(2)** ("in accordance with the written instructions of the consumer"), not (a)(3). The error text at `fcraAttestation.ts:86` misattributes it. (2) **Semantic fit.** For land acquisition outreach, the landowner did not initiate any transaction. If the snippet's (F)(i) text is accurate, `legitimate_business_need` does not cover cold acquisition skip-trace. The enum lets an operator pick it with a ≥10-character justification (`:90-94`). Whether a skip-trace vendor's output is a "consumer report" at all is a separate legal question, and this report does not answer it. |

### D. Federal / environmental data licensing

| # | Claim | Repo reliance | Evidence this session | Verdict |
|---|---|---|---|---|
| D1 | EPA FRS / ECHO / UST Finder are `public-domain-usgov` and **redistributable** (17 U.S.C. §105). | `server/services/providers/data-licenses.ts:9, 130-156`; `open-data-program.md:39-41`. | WebSearch, 2026-10-24. Data.gov FRS entries in its summary say "No license information was provided" plus the standard U.S. Government Work note. It also reports that **some FRS sub-datasets** (ER_SIC, ER_CONTACTS) are flagged internal-use / intranet-only, and one FRS entry's licence field says the data "should not be distributed". EPA's own `edg.epa.gov/EPA_Data_License.html` was not returned or read. | **Partially.** §105 public domain plausibly covers the public FRS/ECHO subsets AcreOS queries. But the blanket "redistributable: yes" for "EPA FRS" is broader than the evidence: EPA's FRS family is not uniform. |
| D2 | FRED/ALFRED series are BLS public domain, but FRED's terms require citation and forbid scraping. | `data-licenses.ts:339-356`. | Not read. | **Not verifiable here.** The repo already records the condition. |
| D3 | HUD USPS vacancy is restricted to gov/non-profit sublicensees, so it is not usable. | `open-data-program.md:62`. | Not read. Side note: the Regrid search summary says Regrid's **Premium schema includes "USPS vacancy indicators"**. | **Not verifiable here.** If AcreOS stores or re-serves Regrid Premium vacancy fields, check the redistribution terms of that field under Regrid's licence. |

### E. Format facts (PMTiles, GeoParquet)

| # | Claim | Repo reliance | Source actually read (2026-10-24) | Verbatim quote | Verdict |
|---|---|---|---|---|---|
| E1 | PMTiles v3: 127-byte header; root directory within the first 16 KiB; magic `PMTiles`; version byte 3; clustered tile-id order. | `server/services/landData/pmtilesWriter.ts:2-9, 120, 140-141`. | `https://raw.githubusercontent.com/protomaps/PMTiles/main/spec/v3/spec.md` | "A fixed-size 127-byte header" (l.19). "the root directory MUST be contained in the first 16,384 bytes (16 KiB)" (l.26). "The magic number is a fixed 7-byte field whose value is always `PMTiles` in UTF-8 encoding" (l.72). "the size of the header plus the compressed size of the root directory MUST NOT exceed 16384 bytes" (l.264). | **Confirmed.** The writer's guard `HEADER + root.length > 16_384` (`:120`) matches l.264 exactly. |
| E2 | GeoParquet **1.1**: WKB geometry, a `geo` key-value metadata document naming the primary column, encoding and geometry types; CRS omitted means OGC:CRS84 (lon/lat WGS84). | `server/services/landData/geoParquet.ts:4-6, 124-131, 203`. | `https://raw.githubusercontent.com/opengeospatial/geoparquet/v1.1.0/format-specs/geoparquet.md` | "This is version 1.1.0 of the GeoParquet specification." (l.11). "A GeoParquet file MUST include a `geo` key in the Parquet metadata" (l.34). "If the field is not provided, the default CRS is [OGC:CRS84]…, which means the data in this column must be stored in longitude, latitude based on the WGS84 datum." (l.54). "WKB geometry columns MUST be stored using the `BYTE_ARRAY` parquet type." (l.98). | **Confirmed against v1.1.0.** |
| E2a | (Currency, not correctness.) GeoParquet `main` is now **2.0.0**. | — | `…/geoparquet/main/format-specs/geoparquet.md` | "This is version 2.0.0 of the GeoParquet specification." (l.11). "Geometry columns MUST be encoded as either [`GEOMETRY`] or [`GEOGRAPHY`] logical types in Parquet" (l.15). | **Note, not a defect.** Files labelled `version: "1.1.0"` stay valid 1.1 files. Moving to 2.0 needs native Parquet geo logical types, which `parquetjs-lite` 0.8.7 (`package.json`) is unlikely to write. That is unverified; I did not test it. |

---

## 2. Decisions (recommendations; nothing here is changed by this lane)

| Claim | Status | Recommendation | Why |
|---|---|---|---|
| **A1 Regrid floor** | Search-corroborated (2023 source) | **Proceed with a stated risk; a human re-verifies on the live pricing page and against AcreOS's actual Regrid plan/invoice.** Do not change cost tables or weights from this report (money-adjacent, founder-only). | The founder already priced weights at or above 10/15¢, which is the conservative side if prices have not risen. The risk is that prices *rose* since 2023, which would put weights below cost again. A real invoice settles it better than any page. |
| A2/A3 ATTOM, BatchData | Not verifiable | **Re-verify by a human** (contract or invoice). `comps_lookup: 20` cites ATTOM "up to 20¢" with no source. | A cost claim with no citation is backing a credit weight. |
| **B2 TN Comptroller** (`mayStore: true`; "weekly") | Commercial permission repo-recorded only; cadence conflicting | **Block TN bulk *upload/redistribution* until a human re-reads the page and pastes the quote with a date.** The local loader and dry runs may proceed. Correct "weekly" vs "monthly" from the page. | This is the one place where a repo-recorded quote alone turns a store **on**. Everything else defaults off. |
| B3 FL cadence | Conflicting | **Proceed (dry-run only, as today); re-verify the month.** Treat `publishedMonth: 8` as a D1-package assumption, not a state fact. A wrong month only shifts the poller's "overdue" report. Also add the Ch. 119 confidential-record point to the FL dossier question list. | FL is already dry-run-only behind the licence gate. The Ch. 119 notice is a real-world obligation the code may need to honour (suppressing records the state flags as confidential). |
| **B4 NC** | Not verifiable; G.S. 132-10 risk | **Block NC bulk storage/redistribution until a human resolves whether county-imposed 132-10 conditions travel with the NC OneMap aggregate.** The point lookup stays as is. | The seeded-inactive job (0288) is fine. Turning it on is not. |
| B5–B9 MT / AR / WI / MD / NY / WA / NJ | Search-only or repo-recorded | **No change.** Dossiers already default to restrictive. Resolve each from the terms' own words in a session that can reach the hosts (next-moves D1 move 1). | The registry already behaves correctly. |
| B10–B12 IN / OH / TX / KS | Consistent with refusal | **Keep refusing.** For TX, a dossier must also address "Various Vendors" content. | No affirmative licence is in evidence. |
| **C1 FCRA** | Partially; citation error and semantic-fit risk | **Re-verify by a human (counsel) before skip-trace volume grows.** (a) Fix the §1681b(a)(2) vs (a)(3) attribution in the error text. That is a code change for another lane, not this one. (b) Get a ruling on whether `legitimate_business_need` may be selected for landowner acquisition outreach at all. If not, remove it from `SKIP_TRACE_PURPOSES` for that use. | The D2e ledger now records these codes as the audit trail. A ledger of the wrong purpose code is evidence against AcreOS, not for it. |
| D1 EPA | Partially | **Proceed with a stated risk.** Narrow the register's "EPA FRS" entry to the specific public subsets queried, and read `EPA_Data_License.html` once reachable. | The public FRS/ECHO endpoints are federal works. The "redistributable" blanket is broader than the evidence. |
| D3 Regrid USPS-vacancy | Not verifiable | **Re-verify by a human** if any Regrid Premium vacancy field is stored or displayed. | Possible licence inheritance. |
| E1/E2 formats | Confirmed | **Proceed.** Optionally note GeoParquet 2.0 as a future migration. | — |

---

## 3. What the COO must supply for the research proper

To verify *the research* rather than the repo's dependence on it:

1. **The full ChatGPT research transcript, pasted as text**, at:
   `docs/land-data/research/chatgpt-data-sourcing-research-2026-10.md`
   - Put a header with the conversation title, the date of the research, the export date, and the model if known.
   - Keep the **citations and URLs exactly as ChatGPT gave them**. The point is to check its sources, so a summary is useless.
   - Unedited. If anything is redacted, mark it `[REDACTED: reason]`.
2. **The design docs the D1/D2 packages cite but the repo lacks**: v1, v2 and Amendment 2 (`files/data-sourcing-intelligence-*.md`, per next-moves 2026-10-23), at:
   `docs/land-data/design/data-sourcing-intelligence-v1.md`, `…-v2.md`, `…-amendment-2.md`.
   - These hold §5 (cadences), §8 (the uncited RCW section) and §12 (use classes), which the code names as unverified assumptions.
3. **Optional but decisive for A1–A3:** a redacted current Regrid invoice or plan page, plus ATTOM/BatchData rate sheets, at `docs/land-data/research/vendor-rates-2026-10.md`. Remove account numbers; keep the per-record or per-call rates and the plan name.

What each would settle:

| Supplied item | Settles |
|---|---|
| ChatGPT research (1) | Which of A1, B2–B12, C1, D1, D3 the research made claims about, and with which source URLs. Those URLs become the re-verification checklist for a session that can reach the hosts. It also shows whether the D1 package's "10¢/15¢" came from a current page or from the 2023 notice. |
| Design docs (2) | The provenance of B3 (FL August), B5 (MT monthly) and B6 (AR semi-annual), which the registry attributes to "D1 package design §5". Also the WA RCW citation (B9) and the §12 use-class mapping behind every dossier. |
| Vendor rates (3) | A1, A2, A3 outright, and so whether the 2026-10-23 credit weights still sit at or above true cost. |

None of these can **confirm** a state's terms on their own. A state-terms claim is confirmed only by reading that state's page in a session that can reach it. The research narrows *where to look*; it is not the source.

---

## 4. Method notes

- Every repo reference was read at `8d949e85`. File:line references are to that tree.
- Confirmed quotes (E1, E2, E2a) were taken from files fetched with `curl` into the lane scratchpad and grepped with line numbers. They are copied, not retyped.
- WebSearch summaries are paraphrases by the search tool. Where the table puts such text in quotation marks, it is labelled as the search tool's text and is **not** a verified quote from the source.
- Not attempted: re-reading any state ArcGIS item page (proxy-denied), any statute page (proxy-denied), any vendor page (proxy-denied).
