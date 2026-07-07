# Yara Obasi — Claims Adjuster Lens

**Persona:** Yara Obasi, 46. Senior property/casualty claims adjuster at a mid-sized regional carrier. Twenty-two years writing fire, flood, landslide, and vandalism on vacant land + improved parcels. Walks every loss site she can. Tells juniors: "the file is the file — if it's not in the file, it didn't happen." Lives in adjuster software, EXIF viewers, FEMA flood maps, and county GIS.

**Scenario:** A Land Investor on AcreOS files a claim. A 14-acre Texas parcel they bought eight months ago, listed for resale, just had a brushfire scorch ~9 acres of timber — or a hundred-year flood drowned a building site they were marketing as "high & dry" — or a hillside parcel slumped after spring rains. The Land Investor sends Yara "everything we have on the property" as an AcreOS export. Yara has to decide: is the loss real, when did it happen, was the pre-loss condition what they said it was, and does AcreOS-stored documentation support or contradict the claim?

This is the audit AcreOS wasn't designed for. It's also the one that, when AcreOS gets it right, becomes a moat — every claim adjuster who closes a clean file because the data was good tells two more carriers, and AcreOS becomes the system insurers ask Land Investors to pull from.

---

## What I went looking for

1. **Photo metadata.** Date taken, GPS, camera, hash. Strippable? Forgeable? Server-trusted vs. client-trusted?
2. **Inspection history.** When was the last documented site visit, by whom, with what evidence?
3. **Condition of record.** Did AcreOS ever record "this parcel was not in a flood zone / no fire damage / clear of erosion" in a way I can pull pre-loss?
4. **Document chain of custody.** If the investor uploaded an inspection PDF in March, can I prove it was *that* PDF and hasn't been swapped?
5. **Fraud signals.** Repeated claims, late-added photos, GPS that doesn't match parcel, EXIF dates after the loss, suspiciously timed edits.

The standard claims-adjuster checklist for vacant-land losses runs about forty items. I'm only auditing what AcreOS *could* contribute — title, surveys, contractor invoices, weather records, FEMA panels live elsewhere. AcreOS's job is "the part of the file the insured controls." If that part is clean, my work is faster and the payout is faster. If that part is sloppy, the file gets kicked to SIU and the insured waits months and probably ends up with a partial denial.

---

## What AcreOS actually has

### Photo metadata — partial

`shared/schema.ts:9706` — `propertyPhotos` table: `capturedAt`, `capturedBy`, `gpsCoordinates {lat,lng}`, `width`, `height`, `mimeType`, `sizeBytes`, `storageKey`, `uploadedBy`. Good bones.

`shared/schema.ts:15314` — `fieldScoutPhotos`: visit-bound photos with `latitude`, `longitude`, `caption`, but **no `capturedAt`** at the column level (it's accepted on input at `routes-field-scout.ts:194`/`246` but the table column on line 15314 omits it — write is silently lost). Bug or undocumented design choice; either way, capture-time evidence for field-scout photos is unreliable.

`client/src/hooks/use-native-camera.ts:35-148` — hand-rolled EXIF GPS parser. Reads JPEG APP1, walks IFD0, extracts GPSLatitudeRef/Longitude/Ref. Then at line 152-185 it **immediately re-encodes the image through canvas at quality 0.8**, which destroys all EXIF before upload. So the GPS the server stores is whatever the client claimed in a JSON sidecar, not what's verifiable inside the file bytes.

That last point matters: **the server has no way to independently verify EXIF**. There's no server-side EXIF read on `routes-field-scout.ts:148-205`. The client extracts, the canvas strips, the client posts coordinates as a string. A motivated claimant can:

- Edit the metadata JSON before posting.
- Upload a picture from anywhere with claimed coordinates pointing at the parcel.
- Backdate `capturedAt` to before the loss.

`server/middleware/fileUploadSecurity.ts:39-51` checks magic bytes (good — stops .exe-as-.jpg). It does **not** preserve original EXIF, hash the file, or capture an upload-time `serverReceivedAt` distinct from client-claimed `capturedAt`.

### Inspection history — strong on intent, weak on evidence binding

`shared/schema.ts:15291` — `fieldScoutVisits`: `visitorId`, `latitude`, `longitude`, `notes`, `startedAt`, `completedAt`, `status`. Indexes on org and visitor. Good for "when did someone say they visited."

`shared/schema.ts:2738-2769` — due diligence checklists. `dueDiligenceItems.completed`, `completedBy`, `completedAt`, `notes`. The default template at 2772-2794 explicitly includes `physical-4: Flood zone check` and `physical-5: Environmental review`. **This is gold for a claim** — if the investor checked "flood zone check: complete" at acquisition, I have a record that they represented the parcel as not in a flood zone, and the FEMA panel they were looking at on that date is implicitly part of their file.

But there's no document attachment requirement on `dueDiligenceItems`. `documentRequired` exists on `DealChecklistItem` (line 2810-2819) but not on the DD item table itself. So "flood zone check: completed" can be a checkbox tick with `notes: null` and no FIRM panel attached. From a claims POV, that's an undocumented self-attestation — useful as an admission, useless as proof.

### Condition of record — the load-bearing field

`properties.condition` (`schema.ts:681`) is one freeform text column: `excellent | good | fair | poor | distressed`. No history, no sourcing, no timestamp on changes (the parent row has `updatedAt` but a one-shot field overwrite loses prior values). For a claim, "what did the investor *believe* the condition was the day before the fire" is the single most important pre-loss fact and AcreOS doesn't version it.

`auditLog` (`schema.ts:4149-4165`) does store `changes.before/after/fields`, scoped by `entityType` and `entityId`. **If condition changes flow through the audit pipeline, I can reconstruct it.** Need to verify in routes that property edits actually write audit rows — I see `auditLog` referenced in `routes-organization.ts` for invites etc., but need to spot-check property mutations. If property updates don't audit-log, the condition-history story falls apart.

### Satellite — surprisingly useful

`schema.ts:9789` — `satelliteSnapshots`: `imageUrl`, `provider` (google/mapbox/sentinel), `captureDate`, `cloudCoverage`, `changeDetected`, `changeType` (vegetation/construction/clearing), `changeSeverity`, `comparedToSnapshotId`. **This is the cleanest pre/post evidence in the system.** A sentinel pass two weeks before a fire claim and one two weeks after gives me NDVI delta and fire scar boundary. AcreOS isn't selling this as adjuster evidence, but it is.

Gap: no `capturedFor` reason or `pinned` flag. Snapshots could in principle be pruned. For an open claim I'd want a "freeze" mechanism so the snapshot rows on a parcel under claim aren't garbage-collected.

### Photo analysis — a witness for the prosecution or the defense

`schema.ts:9750-9786` — `photoAnalysis`: `detectedFeatures`, `landscapeType`, `buildingDetected`, `roadDetected`, `waterDetected`, `vegetationDensity`, `aiDescription`, `confidence`. If the investor ran AI analysis on photos in May (`buildingDetected: false`, `vegetationDensity: 78`) and then files a claim in November for "outbuilding burned, mature timber lost," the May analysis is now evidence in my file whether the investor likes it or not. Useful both directions — clears clean claims faster, and catches inflations.

### Documents — adequate, not investigative-grade

`generatedDocuments` (4757), `dealRoomDocuments` (10766). I see `fileUrl` columns. I do not see a `contentHash` / `sha256` / `fileChecksum` field anywhere on photo or document tables. **No content hashing means I cannot prove a document hasn't been swapped at the storage layer.** For a contested claim, this is the difference between "the inspection PDF" and "an inspection PDF."

---

## Fraud signals AcreOS could surface today and doesn't

Everything below is buildable from existing tables — these are gaps in the claims-relevant surfacing, not gaps in the data model.

1. **EXIF/claimed-GPS divergence.** Server reads EXIF on upload, compares to client-posted lat/lng, flags if they disagree by >50m or if EXIF is absent on a photo claimed to be field-captured.
2. **`capturedAt` after `serverReceivedAt`.** A photo "taken" on March 3 but uploaded on March 1 is impossible. Right now `serverReceivedAt` doesn't exist as a column distinct from `createdAt`.
3. **GPS outside parcel polygon.** If the property has parcel geometry (it does — APN-based lookups exist), a photo geotagged 2km from the parcel boundary should flag.
4. **Burst of photos uploaded in single session, all with EXIF stripped.** The native-camera path strips EXIF (canvas re-encode) — that's the system's own doing — but a real field walk produces photos uploaded over hours, not all in one POST. A 47-photo single-multipart upload with claimed timestamps spanning weeks is suspicious.
5. **Condition downgraded shortly before claim.** If `properties.condition` flipped from `good` to `poor` four days before a loss event, audit log surfaces it.
6. **DD checklist marked complete without document.** `dueDiligenceItems.completed=true && notes IS NULL` is currently invisible. For a claim, "physical-4 flood zone check: completed, no notes, no doc" is a softer but real signal.
7. **Photo analysis AI description contradicts claim.** If May AI said "no structures detected" and the November claim is "outbuilding destroyed," the contradiction is sitting in `photoAnalysis.aiDescription`.
8. **Repeated claim-shaped queries.** No internal claim entity exists. But `auditLog` action filtering on a single property — repeated condition edits, repeated photo deletions, repeated DD item un-completions — paints a pattern.

---

## Three concrete claim scenarios against AcreOS as it stands today

**Scenario A — Brushfire on 14 acres, claim filed Nov 12.** Investor sends export. I get six photos dated April 8 showing dense post oak and cedar, geotagged to the parcel centroid. Photos run through canvas re-encode → no original EXIF → I can't independently date them. `properties.condition: good`. No DD checklist completion record. One field-scout visit on April 8, 23 minutes long, four photos attached, but the photo `capturedAt` is null because the column doesn't exist on `fieldScoutPhotos`. Two satellite snapshots from `satelliteSnapshots`: one June 2 (`vegetation_density: high`, no change detected) and one Oct 30 showing `changeType: vegetation, changeSeverity: major`. **Verdict:** the satellite pair carries the file. AcreOS-stored photos are corroborative at best. Pay it on the satellite evidence; flag for AcreOS hash/EXIF improvements before next cycle.

**Scenario B — Flood claim on a "high & dry" parcel.** Investor's listing said "above 100-year floodplain." I pull the export. DD checklist `physical-4 Flood zone check: completed` checked April 3 by user `usr_8821`, `notes: null`, no FEMA panel attached, no `documentRequired` enforcement. `auditLog` shows the property's `condition` was edited from `excellent` to `good` on Oct 1, eleven days before the flood — interesting but not damning. No satellite snapshots in flood season. **Verdict:** the self-attested DD check is an admission against interest if the parcel was actually in zone AE — AcreOS captured that the investor said it was clear. But there's no FIRM panel ID logged, so I can't reconstruct what the investor was looking at. This is exactly where a `documentRequired` enforcement on the DD item table would have produced either a real attached panel or no claim of completion at all.

**Scenario C — Landslide on a hillside parcel after spring rain.** Six photos uploaded May 14, all in a single multipart POST, claimed `capturedAt` spanning Feb 8 through May 12. `serverReceivedAt` doesn't exist as a column distinct from `createdAt`, so I can't prove they were all uploaded together — but `createdAt` clusters them in a 90-second window. EXIF stripped by canvas. AI photo analysis from May 14: `aiDescription: "Steep terrain, sparse vegetation, visible erosion channels on south face."` Investor's claim narrative says the slope was stable until the rain. **Verdict:** AcreOS's own AI analysis contradicts the investor's narrative. I'd cite `photoAnalysis.aiDescription` and `photoAnalysis.confidence` directly in the denial letter. This is AcreOS catching the fraud *for* the carrier — the investor uploaded the evidence against themselves and AcreOS labeled it. That's the value proposition.

## The stuff that's missing entirely

- **Server-side EXIF preservation.** Original-bytes archive separate from the displayed/compressed copy. Insurers need the original; marketing needs the small one. Two storage keys, one DB row.
- **Content hashing.** `sha256` on every photo and document at upload time. Stored in DB, surfaced in any export. This is one column and a 6-line middleware change.
- **Soft-delete vs. hard-delete on photos.** `propertyPhotos` has no `deletedAt`. If a photo can be hard-deleted, claims evidence vanishes. For any property with an open insurance claim, deletion needs to be either blocked or shadow-retained.
- **Claim mode / litigation hold.** A flag on a property — `claim_open` or `legal_hold` — that disables hard delete on related photos, documents, audit rows, and satellite snapshots until cleared. Two-person rule to clear.
- **Inspection report PDF artifact.** `routes-field-scout.ts:412` already generates a PDF with location, notes, photos. Hash that PDF on generation, store the hash, and allow it to be re-generated from source-of-truth rows so an adjuster can verify "this PDF is what AcreOS says this visit was." Right now it's a one-shot rendering — re-render gives you a similar but not-byte-identical document.
- **`capturedAt` on `fieldScoutPhotos`.** Mentioned above — column missing, input accepts it, write is dropped. Either add the column or stop accepting it.
- **Provenance on `properties.condition`.** Source (`field_visit | provider_enrichment | manual | ai_photo_analysis`), source ID, timestamp. Right now an adjuster has no way to ask "who said this was 'good' and when?"
- **Insurance-export endpoint.** A single signed bundle: property record + condition history (from audit log) + all photos with EXIF + DD item history + visit log + satellite snapshots in date range + checksum manifest. One-click "send my carrier everything." This becomes a feature investors love (faster claim payouts) and a quiet integrity moat.

---

## What a clean AcreOS claim packet should contain

If I'm running the spec for the export endpoint mentioned above, here's the bundle, in order of evidentiary weight:

1. **Parcel identity block.** APN, county, state, deeded acreage, parcel polygon WKT, owner of record, ownership effective date. From `properties` + DEED records. Hashed.
2. **Pre-loss condition history.** Every audit-log row touching `properties.condition`, `dueDiligenceItems.completed`, `dueDiligenceItems.notes`, with timestamp, user, and before/after diff. From `auditLog`. Sorted ascending.
3. **Field visits.** Every `fieldScoutVisits` row touching this parcel: visitor, started/completed timestamps, GPS at check-in, notes, duration. With photos attached.
4. **Photos, originals.** Every `propertyPhotos` and `fieldScoutPhotos` row. **Originals, not canvas re-encodes.** Each with: storage URL, sha256 of file bytes, EXIF block as parsed at server-receive time, claimed-vs-EXIF GPS delta, server-received timestamp, uploader user ID.
5. **AI photo analyses.** Every `photoAnalysis` row, with model version and confidence. The good and the bad — adjusters need to see what the system saw, not what the investor wants the system to have seen.
6. **Satellite timeline.** Every `satelliteSnapshots` row in the relevant window, with provider, capture date, cloud coverage, change detection results, and a link to the comparison snapshot if any.
7. **Documents.** Every `dealRoomDocuments` and `generatedDocuments` row attached to the parcel, with sha256 and original-upload timestamps.
8. **Manifest.** A signed JSON manifest listing every artifact, its sha256, its DB ID, and a top-level signature. Carrier verifies the manifest, then verifies any artifact independently.

That packet, signed and timestamped, is something a court will accept. Today AcreOS produces about 60% of it, with verifiability gaps that a defense attorney would shred.

## Adversarial patterns I'd test against

These are the things I'd try if I were the fraud analyst on the carrier side, training a model on AcreOS exports:

- **Late-binding photo upload.** Photo `capturedAt` claims pre-loss, `createdAt` is post-loss. Today: visible in DB, not surfaced.
- **Coordinated condition flip.** Property condition edited from `good` to `poor` within 14 days before claim filing, with no corresponding field visit or photo upload to justify. Today: derivable from `auditLog` joins; not flagged.
- **Phantom inspection.** `fieldScoutVisits` row with `duration < 5 minutes`, no photos, GPS exactly at parcel centroid (suggesting the value was typed, not GPS'd). Today: not flagged.
- **Photo cluster forgery.** N photos, all with identical EXIF stripped, identical claimed lat/lng (six decimals — real GPS varies), identical `capturedAt` second. A single fabricated entry duplicated. Today: not flagged.
- **Document re-upload.** Same logical document (same filename) uploaded multiple times to the same property with no version metadata. Could be benign, could be a swap. Today: visible if you look, not surfaced.
- **DD checklist re-completion.** Item marked complete, then un-completed, then re-completed with different `completedBy`. Today: in audit log, not surfaced.

None of these are AcreOS *bugs*. They're claims-adjacent patterns the system isn't watching for because it wasn't built to. The fix is a periodic background job and a `claim_signals` table — same pattern as `risk_signals` likely already exists in the founder-intelligence surface.

## Severity rollup

| Item | Severity | Why it matters to a claims file |
|---|---|---|
| No server-side EXIF preservation | Critical | Photo provenance is unverifiable |
| No content hashing on photos/docs | Critical | Documents can be swapped without trace |
| `fieldScoutPhotos.capturedAt` column missing | High | Capture time of field photos is silently lost |
| No litigation/claim hold flag | High | Evidence can be hard-deleted during open claim |
| `properties.condition` not versioned with provenance | High | Pre-loss representation can't be reconstructed cleanly |
| DD items lack required-document binding | Medium | Self-attestations without backing files |
| No GPS-vs-parcel-polygon validation | Medium | Off-site photos pass as on-site |
| Inspection PDF not deterministically reproducible | Medium | Can't byte-match an exported report later |
| No "burst upload" anomaly flag | Low | Misses an obvious fraud pattern, but rare |

---

## Recommendation, in one paragraph

Build the insurance-export endpoint first. It forces the dependencies into existence — content hashes, EXIF preservation, condition history, visit-photo time integrity — because you can't ship a defensible bundle without them. Sell it to Land Investors as "claim payouts in days, not months" and to AcreOS as the proof that the system of record actually records. Once a carrier closes a clean claim off an AcreOS bundle, that carrier starts asking *every* AcreOS investor for the same export, and the export becomes the standard. The fraud-detection surfaces (EXIF-vs-claimed-GPS, parcel-polygon checks, burst uploads) drop out as a free side effect.

The file is the file. Right now AcreOS's file is mostly true and partly performative. Make it all true and the carriers will tell their insureds to use you.
