# INTEGRATION — D2f historical-use screening

These are proposals only, and the integrator applies them. Nothing in this
document is wired in by D2f. The proposals touch no tables, no money and no
shared files.

The code that ships is limited to two files.
`server/services/screening/historicalUse.ts` holds the model and the
aggregator. `server/services/screening/historicalUseSources.ts` holds the EPA
adapters over `dataSourceBroker.lookup` and `screenParcelHistoricalUse`.

## P0 — reachability allowlist (scripts/ratchets/reachability.json)

Until P4 or P5 mounts a caller, `screenParcelHistoricalUse` has no production
caller. Add these entries in the existing `TEST SEAM` format, or land P4 in the
same merge and keep only the first two:

```json
{ "kind": "export", "id": "server/services/screening/historicalUse.ts::findingProvenanceProblem",
  "reason": "TEST SEAM (D2f, 2026-10-24). The provenance check runHistoricalUseScreening applies to every adverse finding; exported so historicalUse.test.ts asserts every emitted finding passes it. REVOCATION: when a production module imports it, remove this entry." },
{ "kind": "export", "id": "server/services/screening/historicalUseSources.ts::createEpaBrokerAdapters",
  "reason": "TEST SEAM (D2f, 2026-10-24). Builds the EPA adapters over an injected broker lookup; historicalUseIndianaE2E.test.ts pins every adapter's licence key and positive-control honesty. REVOCATION: when a production module imports it, remove this entry." },
{ "kind": "export", "id": "server/services/screening/historicalUseSources.ts::screenParcelHistoricalUse",
  "reason": "UNWIRED ENTRY POINT (D2f, 2026-10-24). The production entry point; mounted by INTEGRATION-D2f P4. REVOCATION: remove when P4 lands." }
```

`SCREENING_CATEGORIES` is used inside its module and by the test. If the gate
flags it as internal-only, add a fourth test-seam entry for it.

## P1 — broker: make the FRS answer citable as an absence (server/services/data-source-broker.ts, `queryEpaFrs`)

Before:
```ts
const items = data?.Results?.FRSFacility || [];
for (const f of items.slice(0, 20)) {
```
After:
```ts
const items = data?.Results?.FRSFacility;
if (!Array.isArray(items)) throw new Error("EPA FRS response has no Results.FRSFacility");
for (const f of items.slice(0, 20)) {
```
Also add `returnedCount: items.length` and `capped: items.length > 20` to the
return object. With this change an error body becomes `unreachable` instead of
`[]`. That is what lets `epa_frs` become absence-eligible once a positive
control is recorded. The change is additive, and existing consumers read
`facilities`, `totalCount` and so on unchanged.

There is a separate defect to note but not fix in the same change.
`distanceMiles: f.PGM_SYS_ACRNM !== undefined ? undefined : undefined` is
always `undefined`. The screening adapter computes its own distance from
LATITUDE83/LONGITUDE83 instead.

## P2 — broker: historical (non-active) FRS and itemized ECHO/UST

- FRS: the broker hard-codes `p_act=Y`, which returns active facilities only.
  Historical-use screening needs the inactive ones. Proposal: a new category
  `epa_frs_all`, or an option, that omits `p_act`. This touches the
  `LookupCategory` union and `BUILTIN_FEDERAL_CATEGORIES`, so the integrator
  should decide.
- ECHO: the broker keeps only `CVRows`. Proposal: also keep `QueryRows`, plus
  the facility list from ECHO's `get_qid` paging. Without the list, a count
  above 0 stays an unitemized signal, which the screen reports as
  inconclusive.
- UST Finder: `returnCountOnly=true`. Proposal: a second query with
  `outFields=*` and `returnGeometry=true`, capped and reported as capped. First
  verify, on the network, which layer index is facilities and which is
  releases.

## P3 — broker TRI honesty and the "EPA TRI" register entry

`queryEpaData` returns `superfundSites` built from TRI rows and returns
`nearestSiteDistance: sites.length > 0 ? radiusMiles : null`. That second
field presents the search radius as a distance. Proposal: rename the field
(additive: add `triFacilities`, deprecate `superfundSites`) and set
`nearestSiteDistance: null` unless it is computed. Before an `"EPA TRI"` entry
goes into `DATA_LICENSE_REGISTER` (`server/services/providers/data-licenses.ts`),
verify on the network that
`efservice/tri_facility/latitude/{lat}/longitude/{lng}/radius/3/JSON` is a
spatial query and not an exact-match column filter. Until then TRI stays in
`KNOWN_UNSCREENED_SOURCES`.

## P4 — route (customer door: **Map**, the parcel detail page)

The screening lives on **Map → Inventory → parcel detail** (`/parcels/:id`,
`client/src/pages/parcel-detail.tsx`), in the existing due-diligence section.
It adds no nav entry. The route goes on the existing, already-mounted
`server/routes-due-diligence.ts` router
(`app.use('/api/due-diligence', isAuthenticated, getOrCreateOrg, …)`):

```ts
// GET /api/due-diligence/:propertyId/historical-use
router.get("/:propertyId/historical-use", isAuthenticated, getOrCreateOrg, async (req, res) => {
  try {
    const propertyId = Number.parseInt(req.params.propertyId, 10);
    if (!Number.isFinite(propertyId)) return Errors.badRequest(res, "Invalid property ID");
    const orgId = getOrganizationId(req);                       // AuthenticatedRequest helpers
    const property = await storage.getProperty(orgId, propertyId); // org-scoped read (tenancy lint)
    if (!property) return Errors.notFound(res, "Property");
    const lat = Number(property.latitude), lng = Number(property.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !property.state) {
      return Errors.badRequest(res, "Property has no coordinates or state; screening refused");
    }
    const verdict = await screenParcelHistoricalUse({
      parcelRef: String(property.id), state: property.state.toUpperCase(),
      county: property.county ?? undefined, centroid: { lat, lng },
    });
    res.json({ verdict });
  } catch (err) { Errors.internal(res, err); }
});
```
Check the `storage.getProperty` signature and argument order against the
storage layer before applying, so the tenant key is never omitted
(`tenantKeyIsNeverOmitted.test.ts`).

UI rules for the parcel-detail panel:
- Render `verdict.statement`, and list every `verifiedAbsences[]` entry with
  its coverage and as-of date, along with `inconclusive[]`, `notScreened[]`
  and `categoriesWithoutVerifiedAnswer`.
- **Never auto-set the existing `noEnvironmentalIssues` checkbox** in
  parcel-detail's DD checklist from a screening result. A
  `no_adverse_found_in_verified_sources` verdict is not "no environmental
  issues".
- Show the "synthetic" badge whenever `verdict.synthetic` is true.
- Loading uses `Skeleton`, errors use `QueryErrorState`, and icon-only
  buttons need an `aria-label`.

Pin it with a test that mutates a verdict to `adverse_found` and asserts the
checkbox stays unset.

## P5 — Pax tool (read-only)

`screen_historical_use(propertyId)` goes in `server/ai/tools.ts`. If
`server/ai/supportAgent.ts` already has `lookup_epa_facilities` alongside it,
add the tool to both dispatch switches. It returns the verdict object
verbatim. The tool description must say: *"Never describe a parcel as clean.
Report the verdict name, the sources checked with their coverage, and what was
not screened."* Add a `dataGroundingEvalCases.ts` case whose adversarial
output is "the parcel is clean" on an `inconclusive` verdict.

Note: `dueDiligenceEngine.checkSuperfund` (FRS `pgm_sys_acrnm=SEMS`) and
`data-source-lookup.ts` (TRI) are two more EPA implementations with their own
semantics. Recommendation: in a later change, make them consume the
screening's adapters so there is one canonical EPA reading.

## P6 — persistence (NO table proposed now)

The verdict is computed on demand, and the broker's 30-day `data_source_cache`
already holds the upstream payloads. Each receipt's `responseSha256` and
`dataAsOf` tie a verdict back to the cached payload. If a durable screening
record becomes necessary later, for example to attach it to a deal file, the
smallest table would be:

```sql
-- NOT APPLIED. Needs COO approval (table-count ratchet is down-only).
CREATE TABLE historical_use_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id integer NOT NULL REFERENCES organizations(id),
  property_id integer NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('adverse_found','no_adverse_found_in_verified_sources','inconclusive')),
  result jsonb NOT NULL,          -- the full ScreeningVerdict
  synthetic boolean NOT NULL DEFAULT false,
  screened_at timestamptz NOT NULL
);
CREATE INDEX historical_use_screenings_org_property ON historical_use_screenings (organization_id, property_id, screened_at DESC);
```
Recommendation: do not add it until a deal-file feature needs to read it.
The alternative is to attach the verdict JSON to the existing due-diligence
dossier row, if that row has a JSON findings column. That is to be verified.

## P7 — go-live: positive controls (needs network; not possible in this container)

For each adapter, record one query at a location with a known match, using
the URL plus the retrieval date. Commit the recording under
`tests/fixtures/screening/recorded/`, and set that adapter's
`absenceEligibility` to `{ eligible: true, positiveControl: { …, synthetic:
false } }`. FRS also needs P1 before it can become eligible. The E2E test
already asserts that no production adapter claims a synthetic control.
