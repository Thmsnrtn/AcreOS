# First-party parcel ingest (the Regrid exit ramp): Step 0 verdicts and the WI pilot, 2026-11-03

Package: `claude-package-first-party-ingest-2026-11` (Muse, COO; dispatched by the founder 2026-11-03).
Branch: `claude/first-party-ingest-wave-a`, off main `f7f2e3f` (#452 merged).
Scope as dispatched: Wave A permitted states only, WI pilot first. AR is excluded. The #452 lookup gate is untouched. No registry flip.

Every line below says how it was established: **run** (executed here, output in this folder), **read** (code on main at `f7f2e3f`), or **unverified** (could not be checked from this session, with the reason).

## Blockers this session could not get past

1. **No staging access.** This session has no Fly credentials. Fly's API answers, but there is no token. Because of that, nothing was read from the staging app: not its secrets (names only), not its database, not its bucket. GitHub Actions paths are refused by this session's proxy, so a workflow could not be used as a stand-in either. Step 0 items 9 and 10 are **unverified**, and none of the §9 staging-proof legs ran. The spec orders the proof post-merge in any case: deploy, then reconcile, then the legs.
2. **The design-authority documents are not in the repository.** `files/data-sourcing-intelligence-*.md`, `hidden_files/claude-package-d1/d2-*.md`, `hidden_files/lookup-gate-*.md` and `files/dossier-program-2026-11/*` (INDEX.md and the W3 packs) are not anywhere in `Thmsnrtn/AcreOS`. This build relied on the package spec, the code on main, and the publishers' live terms. It did not use the packs. Wherever the spec quotes a pack, the quote was re-read at the publisher where possible (WI, CT, DE). The determinations are still DRAFT pending attorney review.

## Step 0 — inventory (spec §2)

| # | Item | Verdict |
|---|---|---|
| 1 | Per-state ETL template | **Read: landed.** `statewideCadastral.ts` (D2a) streams page → normalize → external sort → GeoParquet + PMTiles. It refuses on drift, an unbounded run, a missing county field, or no object id. It has a TX refusal and a 400 MB RSS ceiling. Each state's build is registered as an ETL handler (`etlHandlers.ts`, `STATEWIDE_BUILD_STATES` = FL NC WI AR MT). The jobs are seeded **inactive** (migrations 0287/0288). FL's is `dryRun:true`; the WI job `wi_statewide_cadastral_v1` exists and is inactive. Whether any of them ever ran on staging is **unverified** (no staging DB read). The TN pipeline's code exists (`tnComptrollerCounty.ts`); "code present ≠ pipeline proven" stands. |
| 2 | Statewide seeds + registry | **Read.** Nine seeds (FL MT NC WA NJ AR NY WI MD). On main, every dossier was `unresolvedDossier(...)`, so every policy block was restrictive, and `LOOKUP_CLEARANCE` had all nine gated. **Contradiction with spec §6.1:** the spec names NY as an "unresolved **unseeded**" example, but NY is seeded. The tests use NY as seeded-unresolved and OH/MA/CT/DE as unseeded. |
| 3 | Bulk paths | **Read.** `statewideCadastral.ts` → bucket artifacts only (no DB rows); its only surfaces are artifacts, receipts and the D2b release. `countyPipeline.ts` is a different thing: the on-demand per-county owned-parcel pipeline. It writes `parcel_snapshots` rows with source `owned_pipeline`, behind its own `data-licenses` gate. It reads statewide rows only for TN (`STATEWIDE_COUNTY_FIELD = { TN }`). Its rows are served by `ownedParcelAtPoint()` (the TN coordinate path, the TN path in `county-gis-provider.ts`, `landlockedCheck.ts`) and by the Map-door owned-parcel routes. Neither file had run against a live statewide source as far as the repo records. The WI dry runs below are the first. |
| 4 | Canonical schema | **Read: partial.** The bulk record carries per-group provenance (`source`, `asOf`, `confidence` as **high/medium/low**, `confidenceBasis`, `decayClass`), from D1 A1. There is **no numeric 0–1 confidence and no tier floor**. v2 §1.2's numeric form and the serving-time floor label have not landed. APID + lineage exist (D2c: `parcel_apids`, `parcel_apn_windows`, `parcel_lineage_events`, `apidStore.ts`, `releaseLineage.ts`). |
| 5 | Releases (D2b) | **Read: landed.** Content-addressed releases (`dataset_releases`, release id = sha256 of the canonical manifest), an append-only pointer with promote and rollback (`dataset_release_pointer`), a release diff, and assembly from ingested builds. The assembly job is seeded inactive (0290). |
| 6 | Purpose ledger (D2e) | **Read: landed, three surfaces:** `skip_trace_call`, `skip_trace_result_read`, `owner_contact_lookup`. **Parcel point lookup is not a ledgered surface.** Per spec §5, WI owner fields therefore may not serve through the lookup until it is. Geometry and attributes are unaffected. |
| 7 | Poller + cadence | **Read: code landed** (`statewideLayerPoller.ts`: count-only plus layer JSON; the run observations are the append-only snapshot series). The job is seeded **inactive** in 0287. The D2 record says it has been "ACTIVE since 2026-10-24" on staging; that is **unverified** (no staging DB). |
| 8 | Honesty contract | **Read: present and enforced** in `buildOutcome()`: "ingested" only with a bucket-confirmed receipt for every artifact's exact bytes. `uploadFileAndConfirm` HEADs and checks the byte count. `corporaStatus` accepts receipts only. |
| 9 | Bucket | **Unverified** (no staging access). The repo holds no evidence that the bucket is live: no `docs/evidence` record and no workflow references `OPEN_DATA_BUCKET_*`. `open-data-program.md` records every corpus as `not_provisioned` until the founder sets the keys. Neither conflicting record (COO amendment "acreos LIVE" vs "never provisioned") can be confirmed from here. **Per the dispatch, the build is dry-run only.** The bucket probe (names-only env read, PUT + HEAD + DELETE on a scratch key) is item 1 on the founder list. |
| 10 | Staging tables / baseline | **Unverified** (no staging DB). On main, the statewide build writes no DB rows, so no first-party WI rows can exist from it. The release tables could hold rows only if an assembly had run with receipts. |
| 11 | Publisher totals | **Run, live, 2026-11-03.** **WI:** 3,574,646 (layer count). The schema documentation says "totaling 3.57 million parcels". 73 `CONAME` groups sum exactly to the layer count; one group is `MENOMONIE` with **1** row, a misspelled county value (WI has 72 counties). This is the first categorized delta for a statewide reconciliation. **MA:** the old feature service URL now returns 400. The new MassGIS service (`Massachusetts_Property_Tax_Parcels`, item `73d4c766…`) counts 2,559,749 features. The mass.gov page states **no statewide parcel total**, so there is nothing to reconcile against: reported as such. **CT:** item `82a733423a244c43a9d4bf552954cea9` still reads `licenseInfo` "CC0", but it now serves **1,320,686** features, all `Parcel_Collection_Year` = 2026. The pack says 1,282,833 and the 2025 collection. **This contradicts the pack** (see below). **DE:** live fields are `PIN, ACRES, COUNTY, UPDATED` (geometry-only, matching the pack); 454,608 features. No FirstMap-stated total was located. |

### Contradictions — legs stopped, others continued

- **CT (A3): stopped.** The pack's re-verification premise is "each annual vintage is a *new item*". The *same* item id now carries the 2026 collection (1,320,686 rows vs the pack's 1,282,833 for 2025). The licence still reads CC0. Re-verification is a dossier act, not a build act: the CT pack needs updating before CT ingest is built.
- **MA (A2): not started; one live fact changed.** The pack's service URL is dead (400). MassGIS moved the layer on 2026-04-02 ("NEW REST URL as of 4/2/2026"). The policy-page quotes in the pack were not re-read in this session, and there is no publisher statewide total.
- **DE (A4): not started.** It matches the pack (geometry-only). It is next after WI, with no blocker found.
- **Serving hookup (spec §4.3 / §6.7): stopped. It needs a founder decision.** On main, the cleared `county_gis` leg *live-fetches* the state service, and no store exists from which a cleared statewide leg could answer from ingested data:
  - statewide builds write only bucket artifacts;
  - the one first-party point store (`parcel_snapshots` / `owned_pipeline`) is served **ungated** by `ownedParcelAtPoint()` (`landlockedCheck`, the TN paths) and by the Map-door routes, so loading WI rows there would serve WI with its lookup entry still gated;
  - a dedicated serving table is +1 on the founder-held `table-count` ratchet (748, "strict", each bump founder-approved).

  Both routes need the founder's call. This PR therefore does **not** touch `parcel.ts`. A flip today would still mean a live fetch, exactly as #452 left it.

## What this PR builds (WI pilot, within verified scope)

- **Licensing-as-code at ingest (§3.1).** `ingestAdmission()` / `statewideIngestAdmission()`: a source is admitted only when its effective dossier finds internal use allowed. `buildCounty()` consults it **before any request**, judging admission and the upload gate at one instant. A refused source is never read, not even into a local dry run, which ends D1's "dry-run an unresolved source" behaviour. The refusal is `IngestRefusedError` and names the state and the unresolved class. The ETL job records it in the failed run's observation (`statewide_ingest_refused`, `fetches: 0`). A population test pins `buildCounty` as the only production caller of the paging loop, with admission decided before the stream starts.
- **Re-verification radar (§3.6), tighten-on-date only.** `reverifyBy` on the dossier. `effectiveDossier()` reverts every finding to unresolved on and after the date, and the registry applies it on every read, so policy and admission tighten automatically; the recorded findings are kept. An allowed internal finding with **no** `reverifyBy` is not admitted. **Not wired:** `reverifyTriggers` (WI: the V13 release, a terms change) is recorded as data, but nothing reads it yet, and nothing queues re-verification before the date. A V13 release or a licence change before 2027-06-30 would not tighten WI. Wiring the poller's change detection to the triggers is the next radar step.
- **`can_mail` decoupled from internal use (§5).** It needs an explicit mail finding; there is none for any source, so it is false everywhere.
- **WI dossier resolved** from the publisher's own words, re-read live 2026-11-03: "The data is in the public domain." "There are no use restrictions." (V12 schema documentation), corroborated by the item licence "This data free for public consumption as of: 06/30/2026". Attribution is not required ("There are no requirements for citing…"). `reverifyBy` 2027-06-30 (V13). **WI's `LOOKUP_CLEARANCE` entry is unchanged: gated. `CLEARED_FOR_LOOKUP` is still `[]`.**
- **WI published suppression (§1 A1, §5).** Registry data: `OWNERNME1/2 = "NOT AVAILABLE"`. Ingest stores the literal as published and flags the ownership provenance `suppressedUpstream: true`. Normalization has a single input (the published feature), so no backfill path exists.
- **WI owner names in artifacts: a named gap, held by a population pin, not by a serving rule.** WI display is allowed, so WI build artifacts carry real owner names (Kenosha: 68,499 rows, 64,144 of them "NOT AVAILABLE"). That is internal use, in a private bucket. Spec §5 forbids *serving* WI owner fields until the purpose ledger covers the surface. Nothing serves release artifacts today. The production readers of build/release parquet are pinned to lineage (ids + geometry) and assembly (re-pack into the bucket), so the first serving reader fails a test and must bring its ledger surface. Release **promotion** has no ledger check of its own; that is for the founder to decide alongside the serving-store decision. Also note: WI's job (0288) has no `dryRun` flag, so activating it once a bucket exists would upload owner-bearing artifacts. That is consistent with the dossier, and it is stated here so the activation is a deliberate act.
- **Count reconciliation (§6.4, §9.2).** `reconcileCountyBuild()`: rows in = stored + rejected-with-reason = the publisher's figure (read before the fetch). With no publisher figure the result is `no_publisher_figure`, never a match.
- **`scripts/land-data/statewide-dry-run.ts`.** One county, live layer, no bucket, no DB. It checks admission, reads the publisher count, builds, reconciles, re-counts, then reads the parquet back for the suppression evidence.

## Live evidence (run from this session against the live WI layer, 2026-11-03 ET)

| County | Publisher count (before) | Fetched | Stored | Rejected | Re-count after | Status | "NOT AVAILABLE" stored / flagged | Parquet sha256 (16) | Peak RSS |
|---|---|---|---|---|---|---|---|---|---|
| PEPIN | 9,693 | 9,693 | 9,693 | 0 | 9,693 | reconciled | 1 / 1 | `fd86e2ea67af94eb` | 287 MB |
| KENOSHA | 68,499 | 68,499 | 68,499 | 0 | 68,499 | reconciled | 64,144 / 64,144 | `1960908c54b47a31` | **442 MB** |

- The publisher calls Kenosha's redaction "complete". The measured figure is 64,144 of 68,499; the remaining 4,355 carry owner values and were not investigated here. Kenosha's 64,144 equals the live count of `CONAME='KENOSHA' AND OWNERNME1='NOT AVAILABLE'` measured independently before the build: the redaction survived intact.
- Outcome in both runs: `dry_run_only`, because "object storage not configured". No receipt was written, so nothing is called "ingested".
- **Kenosha's peak RSS (442 MB) exceeded the documented 400 MB ceiling** (`overCeiling: true`). This was measured in a `tsx` dev process, which carries the esbuild/tsx overhead the production worker does not. The 512 MB acceptance cap held. Large WI counties (Milwaukee, Dane) must be measured on the worker before WI is scheduled. This is recorded, not waved through.
- Live refusals (`refusal-*.json`): FL, AR and NY are refused as UNRESOLVED and OH as unseeded. The script exits before any request. The zero-fetch property itself is proven by the unit suite's recording fetch layer, not by the script.

## Tests

`tests/unit/firstPartyIngestAdmission.test.ts`, 34 tests:
- refusal with a recorded empty request list for FL, NY, AR, NC, MT, WA, NJ and MD;
- the unseeded refusal (OH, MA, CT, DE);
- forbidden-internal;
- the WI dossier pins and WI still gated for lookup;
- `can_mail`;
- the radar (lapse, the day before, the re-verification fixture, an unparseable date);
- suppression through the parquet;
- reconciliation, including a live-shaped fixture build;
- the ETL handler's refusal (FL, AR, NC, MT: named observation, zero `fetchGeo` calls);
- the population pins (paging-loop callers; parquet readers);
- no `reverifyBy` → not admitted;
- internal admitted with display unresolved → owner names withheld.

Mutants, each run against the new suite (all red):

| Mutant | Failed |
|---|---|
| M1 admission check removed | 9 |
| M2 `can_mail = internal` | 2 |
| M3 radar disabled | 2 |
| M4 "NOT AVAILABLE" nulled at normalize | 2 |
| M5 publisher figure ignored | 1 |
| M6 one fetch before admission | 9 |
| M7 ETL handler's refusal record removed | 4 |
| M8 a dossier with no `reverifyBy` admitted | 1 |

Existing tests were rewritten to the new truth, not deleted:
- `statewideCadastral.test.ts`: the mechanics tests run through an admitted test entry, and "every wave-1 state is dry-run only" became "every wave-1 state but WI…";
- `statewideLayerPoller.test.ts` A2: WI excluded and pinned in the new suite;
- the memory-gate scripts build the admitted WI spec at a pinned instant. Their rows now carry owner names (WI display is allowed; NC's were withheld), so their figures are not directly comparable with the D2-era NC measurements.

## Atlas row (Amendment 2 §2.6) — what can honestly be stated today

| Measure | Value | Basis |
|---|---|---|
| States serving first-party data (staging) | **0** | No serving store (above); no bucket confirmed; WI gated for lookup |
| States admitted to ingest | **1** (WI) | Registry, this PR |
| WI counties built and reconciled (dry run, live layer) | **2 of 72** (Pepin, Kenosha) — 78,192 of 3,574,646 parcels (2.2%) | Table above |
| Fall-through rate change on staging | **not measured** | No staging access; no first-party leg serves, so the expected change is 0 |
| Cost per warehouse-served lookup vs v2 §2.10 target | **not measurable** | Nothing is warehouse-served; v2 §2.10 is not in the repo to cite |

No product copy may claim first-party coverage on the strength of this row.
