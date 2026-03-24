# Data Source Verification Report

**Date:** 2026-03-24T02:13:17.401Z
**Sources Tested:** 18
**Passed:** 17 | **Failed:** 1

## Results

| Status | Source | Category | HTTP | Latency | Error |
|--------|--------|----------|------|---------|-------|
| **FAIL** | FEMA Flood Hazard Layer | flood_zone | 404 | 235ms | HTTP 404 Not Found |
| PASS | USFWS National Wetlands Inventory | wetlands | 200 | 127ms | - |
| PASS | USDA NRCS Soil Survey | soil | 200 | 282ms | - |
| PASS | EPA Envirofacts/TRI | environmental | 200 | 1077ms | - |
| PASS | USGS Earthquake Hazards | natural_hazards | 200 | 202ms | - |
| PASS | Census Geocoder | demographics | 200 | 287ms | - |
| PASS | Census ACS Demographics | demographics | 200 | 393ms | - |
| PASS | BLM Surface Management | public_lands | 200 | 196ms | - |
| PASS | USGS Elevation (EPQS) | elevation | 200 | 469ms | - |
| PASS | Open-Meteo Climate | climate | 200 | 493ms | - |
| PASS | HIFLD Hospitals | infrastructure | 200 | 236ms | - |
| PASS | HIFLD Fire Stations | infrastructure | 200 | 169ms | - |
| PASS | DOT Highway Network | transportation | 200 | 371ms | - |
| PASS | USGS Water Services | water_resources | 200 | 262ms | - |
| PASS | USDA Agricultural Values | agricultural_values | 200 | 203ms | - |
| PASS | MRLC NLCD Land Cover | land_cover | 200 | 169ms | - |
| PASS | BLM PLSS Cadastral | plss | 200 | 96ms | - |
| PASS | FEMA National Risk Index | fema_nri | 200 | 303ms | - |

## Failed Sources

- **FEMA Flood Hazard Layer** (flood_zone): HTTP 404 Not Found
  URL: `https://hazards.fema.gov/gis/nfhl/rest/services?f=json`
