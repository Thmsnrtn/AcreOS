# ADR-008: Land Credit Score Design (300–850, 6 Dimensions)

## Context

Land investors need a fast way to assess parcel quality. Raw data from 18 sources is overwhelming — users need a single number that answers "is this worth my time?" The score must be interpretable (users should understand why a parcel scored the way it did), credible (the scale should feel familiar), and improvable (accuracy should increase with usage).

## Decision

The Land Credit Score (LCS) uses a 300–850 scale with 6 weighted dimensions:

1. **Flood risk** (FEMA NFHL) — Zone X = high score, Zone A/AE = low score
2. **Soil quality** (USDA/SSURGO) — drainage class, agricultural capability
3. **Access** (OpenStreetMap) — road proximity, road type, legal access
4. **Utilities** (infrastructure proximity) — power, water, sewer availability
5. **Topography** (USGS 3DEP) — slope, elevation relative to surroundings
6. **Environmental** (EPA, USFWS, NWI) — contamination, wetlands, endangered species

Each dimension produces a 0–100 sub-score. Dimensions are weighted and combined into the 300–850 scale. Default weights are based on domain expertise. After 20+ closed-deal outcomes are recorded, the calibration loop adjusts weights based on which dimensions best predicted profitable transactions.

The 300–850 scale was chosen for familiarity (FICO), interpretability (everyone understands "720 is good"), and range (enough granularity to differentiate parcels without false precision).

## Consequences

**Positive:** Users get a single, interpretable number per parcel. The FICO-like scale requires zero explanation. Six transparent dimensions let users understand and trust the score. Outcome-based calibration means the score gets more accurate over time — a compounding advantage. The score becomes a marketing asset ("Land Credit Score" is memorable and differentiated).

**Negative:** 6 dimensions may not capture all value-relevant factors (mineral rights, timber value, view quality). Initial weights are based on assumption, not data — accuracy improves only after sufficient transaction volume. Users may over-rely on the score and skip qualitative assessment. Confidence interval should be displayed alongside the score to communicate uncertainty.
