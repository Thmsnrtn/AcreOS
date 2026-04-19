# E2E Intelligent Test Transcript

- **Run ID**: 2026-04-19-r7-ingrid-distressed
- **Persona**: 12-data-heavy-analyst (Ingrid — data-forward analyst persona)
- **Journey**: 03-analyze-distressed-parcel
- **Date**: 2026-04-19T22:05:00Z
- **Target**: https://acreos.io
- **Protocol**: API-first
- **Steps**: 4

## Summary

Distressed-parcel journey requires: tax-delinquency surface, due-diligence checklist, FEMA flood query, AI risk analysis. Tested each endpoint the journey would call.

## Steps

1. `GET /api/fema/flood-zone?lat=31.8&lng=-109.75` → **404** (STR-017)
2. `GET /api/due-diligence` → **404** (no generic listing) (STR-018)
3. `GET /api/properties/1/due-diligence` → **200 []** (per-property DD exists, empty by default)
4. `POST /api/ai/analyze-parcel` → **404** (no dedicated parcel analysis endpoint — probably rolled into `/api/ai/chat` which is currently 500ing per STR-016)

## Journey Verdict

- **Outcome**: **BLOCKED**
- **Satisfaction**: 1/5
- **Would Recommend**: **no**
- **Reasoning**: Three of the journey's four supporting endpoints are 404. The fourth (`/api/properties/:id/due-diligence`) works but returns empty — meaning the DD checklist isn't auto-seeded when a parcel is created. Combined with STR-016 (AI chat regression) the "AI risk analysis" success criterion is unreachable. Ingrid's analytical persona would notice the 404s immediately (she'd have devtools open) and abandon.

### Top Issues

- **STR-017** (HIGH): No FEMA flood-zone endpoint. Distressed-parcel analysis is meaningless without flood-zone check. Wire FEMA's free public API (msc.fema.gov) through a `/api/fema/flood-zone` route cached by lat/lng.
- **STR-018** (HIGH): `/api/due-diligence` parent endpoint 404. Journey navigates here; returns nothing. Either route the endpoint or update navigation.
- **STR-019** (MEDIUM): Due-diligence checklist not auto-seeded on property create. Every new parcel should inherit a default 11-item checklist (per typical-workflows.md §7). Currently `[]`.
- **STR-016** (HIGH): AI chat regression blocks the AI risk analysis portion of this journey as well.
