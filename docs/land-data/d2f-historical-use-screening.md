# D2f — Historical-use screening

Status: model, aggregator and EPA adapters built (`server/services/screening/`);
not wired to any route or Pax tool. Wiring proposals: `INTEGRATION-D2f.md`.
Written 2026-10-24.

## 1. What it answers

For one parcel: *did a registry of environmental concern record anything at
or near this parcel, and if not, what exactly was checked?* It is a records
screen, not a Phase I ESA. It never says "clean". There are three possible
overall verdicts:

| Verdict | Meaning |
|---|---|
| `adverse_found` | One or more records with full provenance. All other per-source states are still listed. |
| `no_adverse_found_in_verified_sources` | Every queried source gave a verified absence. The verdict lists each source with its coverage and as-of date, plus every source and category that was **not** screened. |
| `inconclusive` | No adverse record was found, and at least one source could not answer in a way we can rely on, or no source could. The statement reads "this is not a finding of no adverse use". |

Precedence: adverse beats inconclusive, and inconclusive beats no-adverse. An
empty answer is never the same as "no adverse found".

## 2. The finding model (`historicalUse.ts`)

Each applicable source ends in exactly one of four states.

**Adverse finding** (`AdverseFinding`). Every field below is required, and the
engine rejects any finding that is missing one:
- `sourceId`, which must match the adapter that returned it;
- `recordId`: the source's own identifier, such as an FRS `REGISTRY_ID`;
- `relationship`: `on_parcel`, or `within_query_radius` with the radius and
  the distance computed from the record's own coordinates (`null` when the
  record has none, and never guessed);
- `asOf`: the as-of date of the data, which is the cache write time when the
  broker served it from cache. Optionally `recordDate`, a date the source
  attaches to the record itself;
- `sourceFields`: the source's own fields quoted verbatim, at least one
  non-blank, with no derived values;
- `category`: one of the ten screening categories.

A record that fails provenance is **not dropped**. It becomes an inconclusive
item ("a returned record could not be cited (…)"). Dropping it would push the
verdict toward "no adverse".

**Verified absence** (`VerifiedAbsence`). An empty answer counts as an absence
only when it has all four of these:
1. a query geometry (`point_radius` with a finite centre and a positive radius);
2. a coverage statement with non-blank `geographic`, `temporal` and `scope`,
   plus `limitations`;
3. a query receipt: the request, request and response times, `dataAsOf`, the
   SHA-256 of the canonical JSON of the payload we parsed, the upstream title
   and the broker's fallback notes;
4. **absence eligibility**: the adapter has a recorded *positive control*, a
   query where this same adapter returned a real match. Without one, an
   adapter that returns `[]` for every query (a wrong endpoint, a query shape
   the server ignores, an error body parsed as empty) would certify every
   parcel. This rule is the screen's version of the CLAUDE.md law that a gate
   must be falsified against the semantic defect.

If any of the four is missing, the empty answer becomes inconclusive with the
reason stated.

**Inconclusive** (`InconclusiveItem`) covers: unreachable (an HTTP error, a
timeout, a throw, or a broker `success:false`); not covering (the source says
it has no data for the area); an unitemized signal (the source reports N
records but gives no identifiers, which is what the broker's ECHO and UST
counts look like); a record that cannot be cited; and an empty answer that was
rejected as an absence.

**Not screened** (`NotScreenedEntry`) covers sources excluded because their
licence is unresolved in the data-licence register, and sources we know of
but have no adapter for. Both appear on every verdict.

`categoriesWithoutVerifiedAnswer` lists every category that no source answered,
either with an adverse finding or with a verified absence. It is mandatory
output, so a verdict can never imply coverage it does not have.

`synthetic` is set when any input (parcel, finding, or positive control) is
synthetic.

### Licence gate

The licence gate reads the canonical register. An adapter declares
`licenseSource`, which is a key into `DATA_LICENSE_REGISTER`
(`server/services/providers/data-licenses.ts`). The engine calls
`mayCacheAndRedistribute()`, and only "yes" or "attribution" pass. A name that
is not in the register falls back to "review-required" and is excluded: it is
never queried, and its records are never shown, even adverse ones. Because the
gate uses the register's own projection, adding a register entry is the only
way to admit a source, and that change has a single reviewer.

## 3. Sources wired today (wrapping `data-source-broker.ts`, unmodified)

| Adapter | Broker call | What we may claim | Absence-eligible? |
|---|---|---|---|
| `epa_frs` | `lookup("epa_frs")` → `queryEpaFrs` (5 mi, `p_act=Y`, first 20) | Citable records (REGISTRY_ID, programs, coordinates → distance). Category is derived from `INTEREST_TYPES` (CERCLA/NPL/SEMS → superfund; RCRA → rcra; …). | **No.** The broker turns a body with no `Results.FRSFacility` into `[]`, so an empty answer cannot be told apart from an error body. It is also **active facilities only**, so historical and inactive facilities are invisible to it. |
| `epa_echo_current_violations` | `lookup("environmental")` → ECHO `CVRows` (3 mi) | A count of facilities *currently* in violation. A count above 0 is an unitemized signal; a count of 0 is a narrow statement about current violations only. | No: no positive control has been recorded. |
| `epa_ust_finder` | `lookup("environmental")` → UST Finder `returnCountOnly` (1 mi) | A count only. | No: there is no positive control, and the build has not verified whether layer 0 holds facilities or releases. |

The two `environmental` adapters share one broker call per run (memoised), so
TRI, ECHO and UST are each fetched once.

**What this means in production today:** a screen can return `adverse_found`
(from FRS records) or `inconclusive`. It cannot yet return
`no_adverse_found_in_verified_sources`, because no broker-backed adapter has a
positive control. That outcome is deliberate. §6 lists the go-live steps that
unlock it.

### Defects found in the broker while reading it (not fixed here; proposals in INTEGRATION-D2f.md)

1. `queryEpaData` labels TRI rows as `superfundSites` and returns
   `nearestSiteDistance: radiusMiles`. The radius is reported as though it were
   a distance, which is a fabricated distance.
2. The TRI URL `efservice/tri_facility/latitude/{lat}/longitude/{lng}/radius/3/JSON`
   uses Envirofacts' column/value path syntax. The build did not verify that
   `radius` is a supported spatial operator. If it is not, the query matches
   on exact latitude and longitude and returns `[]` everywhere, which yields
   `riskLevel: "low"` everywhere. **Unverified; needs a networked check.**
3. `queryEpaFrs` sends `p_act=Y` (active only), which is wrong for
   *historical* use. It caps the list at 20 without reporting a total, and
   `distanceMiles` is always `undefined`.
4. `queryEpaFrs` treats a missing `Results.FRSFacility` as an empty list.

## 4. Candidate sources by category, with licence status

Method: WebFetch failed for every federal and state host from this container
(DNS `ENOTFOUND` for `www.epa.gov`, `pasteur.epa.gov`, `dnr.wisconsin.gov`
and the EPA snapshot host, 2026-10-24). WebSearch worked, but it returns a
model's summary of search results, not the page text. **Nothing below is a
verbatim quote of a page I read.** Where the status depends only on a search
summary, it is recorded as *unresolved* and the summary is labelled as such.
The data-licence register entries (reviewed by Beatrice and Iris in 2026) are
the only licence authority the code uses.

| Category | Source | Licence status | Basis |
|---|---|---|---|
| Facility registry | EPA FRS | **Resolved (register)**: `public-domain-usgov`, redistributable yes | Register entry "EPA FRS", reviewed 2026-06-06. |
| Enforcement | EPA ECHO | **Resolved (register)** | Register entry "EPA ECHO", reviewed 2026-06-06. |
| Tanks/releases (federal composite) | EPA UST Finder | **Resolved (register)** | Register entry "EPA UST Finder", reviewed 2026-07-28. A search summary (2026-10-24) said EPA describes the state data as "as of 2018-2019" and that states submit voluntarily. That is not verified from the page, so the adapter's coverage says the vintage is not returned by the query. |
| Toxics release | EPA TRI (Envirofacts) | **Unresolved in register**: there is no "EPA TRI" entry, so the source is excluded | EPA federal data is very likely public domain under 17 U.S.C. §105. A search summary (2026-10-24) described an EPA data-licensing page (`pasteur.epa.gov/license/sciencehub-license.html`) saying that EPA-produced data are public domain unless stated otherwise. That page was not read. Adding the register entry is the integrator's or COO's call (proposal P3), and the query-shape doubt in §3 item 2 still applies. |
| Superfund (incl. archived) | EPA SEMS | Unresolved (no register entry, no adapter) | Only reached indirectly through FRS program codes. `dueDiligenceEngine.checkSuperfund` queries FRS with `pgm_sys_acrnm=SEMS`. That is a separate implementation with no shared contract (see INTEGRATION P5). |
| Brownfields | EPA ACRES | Unresolved (no register entry, no adapter) | — |
| RCRA (incl. inactive handlers) | EPA RCRAInfo / Envirofacts `RCRA_FACILITIES` | Unresolved (no register entry) | `dueDiligenceEngine.ts` already queries Envirofacts `RCRA_FACILITIES` through a bbox. It is not in this screen and not in the register. |
| State UST/LUST, contaminated sites | **NC** DEQ Regional UST (RUST) incident database and RUST FeatureServer | **Unresolved** | Search summary (2026-10-24): an Access download plus an ArcGIS layer; a general NCDEQ GIS disclaimer exists ("available without charge … on the condition that users accept its Terms of Use", per the summary), but nothing specific to UST. Not read. |
| | **IN** IDEM "LUST Sites" layer (gisdata.in.gov, IDEM_Land_Sites) | **Unresolved** | Search summary (2026-10-24): updated monthly, MaxRecordCount 1000, copyright text credits IDEM OLQ. No licence statement was found for the layer; a sibling IndianaMap dataset lists rights as "Public". Not read. |
| | **OH** BUSTR | **Unresolved** | The search found no official BUSTR source (2026-10-24). |
| | **WI** DNR BRRTS on the Web, quarterly bulk download of all records | **Unresolved** | Search summary (2026-10-24): a bulk tab-delimited zip of the whole database, including closed sites, with a data-quality disclaimer and no licence or reuse terms found. Not read. |
| | **AR** DEQ leaking-tank records (through ArDOT GIS) | **Unresolved** | Search summary: includes resolved leaks; hosted on gis.ardot.gov. Not read. |
| | **MT** DEQ petroleum release layer (gis.mtdeq.us) | **Unresolved** | Search summary: a public map viewer; export ability unconfirmed. Not read. |
| Historical topo | USGS Historical Topographic Map Collection (topoView, 1884–2006) | Unresolved (no register entry; USGS hosts are blocked by the proxy) | A search summary says the USGS pages are labelled Public Domain, but no statement covering each scan was found. USGS works are generally §105. The register already has a generic "USGS" entry; whether the HTMC scans fall under it is for a human to confirm. |
| Historical aerials | USGS EarthExplorer aerial single frames / NAIP (2003+) | Unresolved for single frames; "USDA NAIP" is in the register | No adapter. NAIP begins in 2003, so it says little about *historical* use. Commercial aerial and Sanborn archives (EDR, NETR, etc.) are proprietary and are **not candidates**. |

ASTM E1527-21 standard search distances would be the natural radius policy.
The standard is copyrighted and was not read, so no distance in the code is
attributed to it. Today's radii are the broker's own (5, 3 and 1 mi).

## 5. Wave-1 state choice: Indiana

The end-to-end test uses **Indiana**. The reasons:
1. **Shape fit.** IDEM's LUST layer is (per the search summary) an ArcGIS
   FeatureServer with JSON/GeoJSON query, updated monthly. That is the same
   point-radius query shape the UST Finder adapter uses, so a state adapter is
   a configuration change, not a new parser.
2. **Licence is the closest to resolvable.** IndianaMap is the state's
   official GIS atlas, and a sibling IDEM dataset is catalogued with rights
   "Public". One human read of the item page could resolve it. NC's only lead
   is a general GIS disclaimer, and OH turned up no official source at all.
3. **Freshness.** The layer is reported as monthly, against WI's quarterly bulk
   files and UST Finder's roughly 2018–2019 state vintage.

The runner-up is **Wisconsin**. BRRTS is the richest *historical* record in the
wave (closed sites, full activity history, documents), but it is a bulk-file
ingest, not a point query, and its licence is silent.

Under the licence rule, the Indiana state adapter is **not built**. The
Indiana end-to-end therefore runs the federal adapters on an Indiana parcel
and reports the state registry as not screened ("licence unresolved for every
wave-1 state registry").

## 6. Go-live steps (each one unlocks the no-adverse verdict for one adapter)

1. With network access, record one positive control per adapter: a known
   location where the source returns a match. Commit the response (URL plus
   retrieval date) as a fixture, then set `absenceEligibility` to it.
2. Broker proposals P1 and P2 (INTEGRATION-D2f.md): FRS must distinguish
   missing from empty and offer a non-active (historical) query, and
   ECHO/UST must return itemised records. Until then FRS cannot be
   absence-eligible however many controls are recorded.
3. A human reads the IDEM LUST item terms. If they are acceptable, add a
   register entry and build the IN adapter.
4. Add an "EPA TRI" register entry only after the query shape in §3 item 2 is
   verified.
