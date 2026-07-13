/**
 * Statewide parcel endpoints — Open-Data Program Phase 3.
 *
 * Seven states publish FREE statewide parcel layers with public ArcGIS
 * REST query endpoints. Instead of bulk-ingesting millions of rows, we
 * seed the existing `county_gis_endpoints` seam with one STATEWIDE row
 * per state (county = "*", the wildcard sentinel) and add a
 * point-intersection lookup path so coordinate lookups in these states
 * hit the free service before paid Regrid.
 *
 * Every endpoint + field name below was verified LIVE on 2026-07-13 with
 * a real point-intersection query (f=json, geometry point inside the
 * state) returning parcel attributes. No unverified endpoints are seeded
 * (no-fabrication rule). States checked but NOT seeded this pass:
 *   - NY: only ~38 counties in the public polygon download; no verified
 *     single statewide polygon query service.
 *   - OR/KS/WI/UT/MD/VT/MA: coverage or public REST access unverified.
 *
 * Statewide rows are used ONLY for point-intersection (coordinate)
 * lookups. APN lookups keep the per-county rows: APN uniqueness across
 * counties within one statewide layer is not guaranteed (e.g. FL DOR
 * PARCEL_ID is county-scoped), so an APN where-clause against a
 * statewide layer could return the wrong county's parcel. A point can
 * only be in one parcel — the spatial query is unambiguous.
 *
 * This module is pure (no db, no fetch) so the mapping logic is
 * unit-testable; server/services/parcel.ts owns the I/O.
 */

/** Sentinel county value marking a row as statewide coverage. */
export const STATEWIDE_COUNTY = "*";

export interface StatewideParcelEndpointSeed {
  state: string;
  county: typeof STATEWIDE_COUNTY;
  endpointType: "arcgis_rest" | "arcgis_feature";
  baseUrl: string;
  layerId: string;
  apnField: string;
  ownerField?: string;
  fieldMappings: {
    apn?: string;
    owner?: string;
    address?: string;
    acres?: string;
    assessedValue?: string;
    taxAmount?: string;
    legalDescription?: string;
    zoning?: string;
    marketValue?: string;
    taxStatus?: string;
    lastSalePrice?: string;
    lastSaleDate?: string;
  };
  sourceUrl: string;
  termsUrl?: string;
  attribution: string;
  notes: string;
}

/**
 * Verified statewide parcel services (live-checked 2026-07-13). Field
 * names come from the service's own layer metadata + a real point query
 * response — never guessed.
 */
export const STATEWIDE_PARCEL_ENDPOINTS: StatewideParcelEndpointSeed[] = [
  {
    // Florida DOR statewide cadastral (Florida GIO) — all 67 counties,
    // ~10.8M parcels. Verified point query at the FL Capitol returned
    // PARCEL_ID/OWN_NAME/PHY_ADDR1/JV. Native SR is EPSG:3086 — point
    // lookups must request outSR=4326.
    state: "FL",
    county: STATEWIDE_COUNTY,
    endpointType: "arcgis_feature",
    baseUrl:
      "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer",
    layerId: "0",
    apnField: "PARCEL_ID",
    ownerField: "OWN_NAME",
    fieldMappings: {
      apn: "PARCEL_ID",
      owner: "OWN_NAME",
      address: "PHY_ADDR1",
      assessedValue: "AV_NSD",
      marketValue: "JV",
      lastSalePrice: "SALE_PRC1",
      legalDescription: "S_LEGAL",
    },
    sourceUrl:
      "https://geodata.floridagio.gov/datasets/FGIO::florida-statewide-parcels/about",
    termsUrl: "https://floridarevenue.com/property/Pages/Cofficial_GIS.aspx",
    attribution: "Florida Department of Revenue / Florida Geographic Information Office",
    notes:
      "FDOR statewide cadastral (all 67 counties). Statewide point-lookup row; verified live 2026-07-13. No acreage field (LND_SQFOOT only).",
  },
  {
    // Montana Cadastral (MSDI framework, Montana State Library). Verified
    // point query in Bozeman returned PARCELID/OwnerName/TotalAcres/
    // TotalValue. Some public-land polygons carry null CAMA attributes.
    state: "MT",
    county: STATEWIDE_COUNTY,
    endpointType: "arcgis_rest",
    baseUrl:
      "https://gisservicemt.gov/arcgis/rest/services/MSDI_Framework/Parcels/MapServer",
    layerId: "0",
    apnField: "PARCELID",
    ownerField: "OwnerName",
    fieldMappings: {
      apn: "PARCELID",
      owner: "OwnerName",
      address: "AddressLine1",
      acres: "GISAcres",
      assessedValue: "TotalValue",
      legalDescription: "LegalDescriptionShort",
    },
    sourceUrl: "https://msl.mt.gov/geoinfo/msdi/cadastral/",
    termsUrl: "https://msl.mt.gov/geoinfo/msdi/cadastral/",
    attribution: "Montana State Library / Montana Department of Revenue",
    notes:
      "Montana Cadastral MSDI statewide layer. Statewide point-lookup row; verified live 2026-07-13.",
  },
  {
    // NC OneMap parcels — all 100 counties, standardized schema. Verified
    // point query in Raleigh returned parno/ownname/siteadd/gisacres/
    // parval. Native SR is EPSG:2264 — point lookups must request
    // outSR=4326. Layer 1 = polygons (layer 0 is points).
    state: "NC",
    county: STATEWIDE_COUNTY,
    endpointType: "arcgis_rest",
    baseUrl:
      "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer",
    layerId: "1",
    apnField: "parno",
    ownerField: "ownname",
    fieldMappings: {
      apn: "parno",
      owner: "ownname",
      address: "siteadd",
      acres: "gisacres",
      assessedValue: "parval",
      legalDescription: "legdecfull",
      lastSaleDate: "saledate",
    },
    sourceUrl: "https://www.nconemap.gov/pages/parcels",
    termsUrl: "https://www.nconemap.gov/pages/parcels",
    attribution: "NC OneMap / NC CGIA",
    notes:
      "NC OneMap statewide parcels (100 counties, polygons on layer 1). Statewide point-lookup row; verified live 2026-07-13.",
  },
  {
    // WA Current Parcels (geo.wa.gov statewide composite). Verified point
    // query in Olympia returned PARCEL_ID_NR/SITUS_ADDRESS/VALUE_LAND.
    // The composite carries NO owner-name field — owner resolves
    // "Unknown"; parcel id + situs address + values are still free wins.
    state: "WA",
    county: STATEWIDE_COUNTY,
    endpointType: "arcgis_feature",
    baseUrl:
      "https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer",
    layerId: "0",
    apnField: "PARCEL_ID_NR",
    fieldMappings: {
      apn: "PARCEL_ID_NR",
      address: "SITUS_ADDRESS",
    },
    sourceUrl: "https://geo.wa.gov/datasets/current-parcels",
    termsUrl: "https://geo.wa.gov/datasets/current-parcels",
    attribution: "Washington State Geospatial Portal (geo.wa.gov)",
    notes:
      "WA Current Parcels statewide composite. No owner-name field in the layer. Statewide point-lookup row; verified live 2026-07-13.",
  },
  {
    // NJGIN Parcels + MOD-IV composite (Web Mercator copy). Verified point
    // query in Trenton returned PAMS_PIN/OWNER_NAME/PROP_LOC/CALC_ACRE/
    // NET_VALUE/LAST_YR_TX.
    state: "NJ",
    county: STATEWIDE_COUNTY,
    endpointType: "arcgis_feature",
    baseUrl:
      "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer",
    layerId: "0",
    apnField: "PAMS_PIN",
    ownerField: "OWNER_NAME",
    fieldMappings: {
      apn: "PAMS_PIN",
      owner: "OWNER_NAME",
      address: "PROP_LOC",
      acres: "CALC_ACRE",
      assessedValue: "NET_VALUE",
      taxAmount: "LAST_YR_TX",
      lastSalePrice: "SALE_PRICE",
      lastSaleDate: "DEED_DATE",
    },
    sourceUrl: "https://njgin.nj.gov/njgin/edata/parcels/",
    termsUrl: "https://njgin.nj.gov/njgin/edata/parcels/",
    attribution: "NJ Office of GIS (NJGIN) parcels + MOD-IV composite",
    notes:
      "NJGIN statewide edge-matched parcel composite with MOD-IV tax attributes. Statewide point-lookup row; verified live 2026-07-13.",
  },
  {
    // Arkansas GIS Office CAMP parcel polygons (~74 of 75 counties).
    // Verified point query in Little Rock returned parcelid/ownername/
    // adrlabel/assessvalue/totalvalue. Layer 6 = PARCEL_POLYGON_CAMP.
    state: "AR",
    county: STATEWIDE_COUNTY,
    endpointType: "arcgis_feature",
    baseUrl:
      "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer",
    layerId: "6",
    apnField: "parcelid",
    ownerField: "ownername",
    fieldMappings: {
      apn: "parcelid",
      owner: "ownername",
      address: "adrlabel",
      assessedValue: "assessvalue",
      marketValue: "totalvalue",
      legalDescription: "parcellgl",
    },
    sourceUrl:
      "https://gis.arkansas.gov/product/parcel-polygon-county-assessor-mapping-program-polygon/",
    termsUrl: "https://gis.arkansas.gov/",
    attribution: "Arkansas GIS Office (CAMP)",
    notes:
      "Arkansas CAMP statewide parcel polygons (~74/75 counties), layer 6 of Planning_Cadastre. Statewide point-lookup row; verified live 2026-07-13.",
  },
  {
    // Tennessee Property Boundaries Public Use (TNMap / Comptroller) —
    // ~86 counties; the 4 self-mapping counties (Davidson, Knox,
    // Hamilton, Shelby) are NOT in this layer, so points there fall
    // through to the next provider. Verified point query in DeKalb Co.
    // returned PARCELID/OWNER/ADDRESS/DEEDAC.
    state: "TN",
    county: STATEWIDE_COUNTY,
    endpointType: "arcgis_feature",
    baseUrl:
      "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer",
    layerId: "0",
    apnField: "PARCELID",
    ownerField: "OWNER",
    fieldMappings: {
      apn: "PARCELID",
      owner: "OWNER",
      address: "ADDRESS",
      acres: "DEEDAC",
    },
    sourceUrl:
      "https://tn-tnmap.opendata.arcgis.com/maps/53ee269639334ad8b70bfea77bde7333",
    termsUrl:
      "https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html",
    attribution: "Tennessee Comptroller of the Treasury / TNMap (OIR)",
    notes:
      "TN Property Boundaries Public Use (~86 counties; Davidson/Knox/Hamilton/Shelby self-mapping counties excluded). Statewide point-lookup row; verified live 2026-07-13.",
  },
];

/**
 * Coarse WGS84 bounding boxes for the seeded states — a cheap router
 * from a coordinate to CANDIDATE states (boxes overlap at borders; a
 * wrong candidate just returns zero features from its service). Only
 * states with a seeded statewide endpoint appear here.
 */
const STATE_BBOXES: Record<
  string,
  { minLat: number; maxLat: number; minLng: number; maxLng: number }
> = {
  FL: { minLat: 24.3, maxLat: 31.1, minLng: -87.7, maxLng: -79.8 },
  MT: { minLat: 44.3, maxLat: 49.1, minLng: -116.2, maxLng: -103.9 },
  NC: { minLat: 33.7, maxLat: 36.7, minLng: -84.5, maxLng: -75.3 },
  WA: { minLat: 45.5, maxLat: 49.1, minLng: -124.9, maxLng: -116.8 },
  NJ: { minLat: 38.8, maxLat: 41.4, minLng: -75.6, maxLng: -73.8 },
  AR: { minLat: 32.9, maxLat: 36.6, minLng: -94.7, maxLng: -89.5 },
  TN: { minLat: 34.9, maxLat: 36.8, minLng: -90.4, maxLng: -81.5 },
};

/**
 * States whose statewide endpoint MIGHT cover this point (bbox test).
 * Empty array = no seeded statewide service can cover it.
 */
export function statesForPoint(lat: number, lng: number): string[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return [];
  const out: string[] = [];
  for (const [state, b] of Object.entries(STATE_BBOXES)) {
    if (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) {
      out.push(state);
    }
  }
  return out;
}

/**
 * ArcGIS point-intersection query parameters. outSR=4326 is REQUIRED:
 * several statewide layers are natively non-Web-Mercator (FL EPSG:3086,
 * NC EPSG:2264) and the downstream ring normalizer only understands
 * WGS84 degrees + Web Mercator meters.
 */
export function buildArcgisPointQueryParams(
  lat: number,
  lng: number,
  additionalParams?: Record<string, string> | null,
): URLSearchParams {
  return new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    f: "json",
    ...(additionalParams || {}),
  });
}
