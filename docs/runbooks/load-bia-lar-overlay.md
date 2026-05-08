# Load the BIA LAR overlay (P0-18 Phase B)

The Bureau of Indian Affairs (BIA) publishes the **Land Area Representations
(LAR)** dataset — a shapefile of every federally-recognized reservation,
tribal-trust block, individual-trust allotment, and restricted-fee parcel
boundary in the United States. This runbook explains how to download,
simplify, and deploy that dataset so the platform's
`detectLandStatusFromCoords()` service in
`server/services/landStatusLAR.ts` returns `tribal_trust` /
`individual_trust` / `restricted_fee` for parcels that fall inside.

When this overlay is **not** loaded:
- Every detection returns `{ status: 'unknown', source: 'no_overlay_loaded' }`
- Manual verification via `PATCH /api/properties/:id/land-status` remains
  the authoritative path
- Existing automation guards (`assertFeeSimpleOrThrow` in
  `server/utils/landStatus.ts`) continue to block on `unknown` status
- **The system is safe — just less helpful.**

When this overlay **is** loaded:
- Operators can run `POST /api/properties/:id/detect-land-status` to get
  an instant pre-classification
- The detection result is audit-logged with regulatory basis
  (25 USC §177, 25 CFR §152)
- Operators still must manually approve via the existing PATCH endpoint —
  detection is a hint, not a verdict

---

## Step 1 — Download the BIA LAR shapefile

The dataset is published at:
- https://biamaps.geoplatform.gov/ (interactive viewer)
- Direct shapefile download: see the BIA-DCS data catalog at
  https://www.usgs.gov/the-national-map-data-delivery (search "Indian Lands")

Or, on the command line:

```bash
# Approx. 57 MB raw; updates roughly quarterly.
curl -L -o /tmp/bia-lar-source.zip \
  'https://biamaps.geoplatform.gov/datasets/...'
unzip /tmp/bia-lar-source.zip -d /tmp/bia-lar/
```

You'll get `BIA_AIAN_National_LAR.shp` plus the usual shapefile companions
(.dbf, .shx, .prj).

## Step 2 — Convert to GeoJSON + simplify

Use `mapshaper` (npm install -g mapshaper) or `ogr2ogr` (GDAL) to convert
shapefile → GeoJSON, simplifying to a tolerance the platform's
point-in-polygon routine can handle quickly:

```bash
# Mapshaper path (smaller output, easier UX):
mapshaper /tmp/bia-lar/BIA_AIAN_National_LAR.shp \
  -simplify 8% keep-shapes \
  -o format=geojson /tmp/bia-lar.geojson

# Or via ogr2ogr (GDAL):
ogr2ogr -f GeoJSON /tmp/bia-lar.geojson \
  /tmp/bia-lar/BIA_AIAN_National_LAR.shp \
  -simplify 0.001
```

Target output size: ~8 MB. Verify by checking `du -h /tmp/bia-lar.geojson`.

## Step 3 — Add metadata block

Edit the GeoJSON to add a `metadata` block at the root (the service reads
this for the `datasetVersion` field):

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "datasetVersion": "BIA_AIAN_LAR_2026-Q1",
    "sourceUrl": "https://biamaps.geoplatform.gov/...",
    "loadedAt": "2026-05-08T00:00:00Z"
  },
  "features": [...]
}
```

Also normalize the `properties` block on each feature to use AcreOS field
names. The service expects:

- `LARID` — BIA-assigned unique id
- `LARNAME` / `TRIBE` — tribal name (string, displayed in detection result)
- `LARTYPE` — one of `tribal_trust` | `individual_trust` | `restricted_fee` |
  `fee_within_reservation` | `off_reservation_trust`. Use a per-feature
  field-mapping pass if the upstream `LARTYPE` differs.

## Step 4 — Deploy

Two paths depending on infra preference:

### Option A — bundled in the server image (recommended)

Drop the file at `data/bia-lar.geojson` in the repo root, commit, deploy:

```bash
mkdir -p data/
mv /tmp/bia-lar.geojson data/bia-lar.geojson
git add data/bia-lar.geojson
git commit -m "data: BIA LAR shapefile 2026-Q1 (P0-18 Phase B)"
fly deploy
```

The service auto-loads from `data/bia-lar.geojson` at first detection call.

### Option B — out-of-band volume mount

If the file is too large to commit, mount it as a Fly volume and point at
it via env var:

```bash
fly volumes create bia_lar_data --region iad --size 1
# Mount at /data/bia-lar in fly.toml
fly secrets set BIA_LAR_GEOJSON_PATH=/data/bia-lar/bia-lar.geojson
```

## Step 5 — Verify

```bash
fly ssh console -a acreos -C "ls -la /app/data/bia-lar.geojson"
fly ssh console -a acreos -C "wc -l /app/data/bia-lar.geojson"
```

Then in the app, hit the detect endpoint on a known tribal parcel:

```bash
curl -X POST -H "Cookie: …" \
  https://acreos.io/api/properties/<id-known-tribal-trust>/detect-land-status
# Expect: { "status": "tribal_trust", "confidence": 1, ... }
```

## Step 6 — Schedule periodic refresh

The BIA dataset updates roughly quarterly. Add a calendar reminder to
re-run steps 1-4 every 90 days. Future improvement: a cron job that
downloads + simplifies + reloads automatically.

---

## Verification checklist

- [ ] File present at `data/bia-lar.geojson` OR `BIA_LAR_GEOJSON_PATH` env var set
- [ ] Server logs `[LAR] Loaded N BIA LAR features from <path>` on first call
- [ ] `POST /api/properties/:id/detect-land-status` returns
      `{ source: "lar_overlay" }` for a known tribal parcel (not
      `"no_overlay_loaded"`)
- [ ] Audit log row created with `action: 'detect_land_status'`

---

*Originally specified in `docs/exhaustive-completion/_MASTER-FINDINGS.md` P0-18
(Aniyah §2). Phase B implementation: this runbook + the
`server/services/landStatusLAR.ts` service.*
