import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { eq } from "drizzle-orm";

interface GISEndpoint {
  key: string;
  title: string;
  category: string;
  subcategory: string;
  description: string;
  portalUrl?: string;
  apiUrl: string;
  coverage: string;
  accessLevel: string;
  priority: number;
}

const TIGERWEB_ENDPOINTS: GISEndpoint[] = [
  {
    key: "tigerweb_state_county",
    title: "Census Bureau - States and Counties",
    category: "census_boundaries",
    subcategory: "administrative",
    description: "State and county boundaries from US Census Bureau TIGERweb",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "tigerweb_tracts_blocks",
    title: "Census Bureau - Census Tracts and Blocks",
    category: "census_boundaries",
    subcategory: "census_geography",
    description: "Census tracts and blocks boundaries for demographic analysis",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "tigerweb_places",
    title: "Census Bureau - Places and County Subdivisions",
    category: "census_boundaries",
    subcategory: "administrative",
    description: "Incorporated places, CDPs, county subdivisions, and consolidated cities",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "tigerweb_legislative",
    title: "Census Bureau - Legislative Areas",
    category: "census_boundaries",
    subcategory: "legislative",
    description: "Congressional districts and state legislative districts",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "tigerweb_cbsa",
    title: "Census Bureau - Metropolitan Statistical Areas",
    category: "census_boundaries",
    subcategory: "statistical",
    description: "Metropolitan and micropolitan statistical areas and related statistical areas",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/CBSA/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "tigerweb_school",
    title: "Census Bureau - School Districts",
    category: "census_boundaries",
    subcategory: "school_districts",
    description: "Elementary, secondary, and unified school district boundaries",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "tigerweb_urban",
    title: "Census Bureau - Urban Areas",
    category: "census_boundaries",
    subcategory: "urban",
    description: "Urban area boundaries and classifications",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Urban/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "tigerweb_transportation",
    title: "Census Bureau - Transportation",
    category: "transportation",
    subcategory: "roads_railroads",
    description: "Roads, railroads, and other transportation features",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "tigerweb_hydro",
    title: "Census Bureau - Hydrography",
    category: "environmental",
    subcategory: "water_features",
    description: "Rivers, lakes, streams, and other water features",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Hydro/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "tigerweb_aiannha",
    title: "Census Bureau - American Indian/Alaska Native Areas",
    category: "census_boundaries",
    subcategory: "tribal",
    description: "American Indian, Alaska Native, and Native Hawaiian areas",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/AIANNHA/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 3
  },
  {
    key: "tigerweb_puma_zcta",
    title: "Census Bureau - PUMAs and ZCTAs",
    category: "census_boundaries",
    subcategory: "statistical",
    description: "Public Use Microdata Areas and ZIP Code Tabulation Areas",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "tigerweb_regions",
    title: "Census Bureau - Census Regions and Divisions",
    category: "census_boundaries",
    subcategory: "regions",
    description: "Census regions and divisions",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Region_Division/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 3
  },
  {
    key: "tigerweb_labels",
    title: "Census Bureau - Labels",
    category: "census_boundaries",
    subcategory: "reference",
    description: "Reference labels for geographic features",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Labels/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 4
  },
  {
    key: "tigerweb_special_land",
    title: "Census Bureau - Military and Special Land Use Areas",
    category: "land_use",
    subcategory: "military",
    description: "Military installations and other special land use areas",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Special_Land_Use_Areas/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "tigerweb_tribal_tracts",
    title: "Census Bureau - Tribal Census Tracts",
    category: "census_boundaries",
    subcategory: "tribal",
    description: "Tribal census tracts and block groups",
    portalUrl: "https://tigerweb.geo.census.gov/",
    apiUrl: "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/TribalTracts/MapServer",
    coverage: "usa",
    accessLevel: "free",
    priority: 3
  }
];

const FEDERAL_ENDPOINTS: GISEndpoint[] = [
  // BLM - Bureau of Land Management (Critical for land investing!)
  {
    key: "blm_national",
    title: "BLM - National Land Management",
    category: "public_lands",
    subcategory: "blm",
    description: "Bureau of Land Management national data including public lands, recreation areas, and land ownership",
    portalUrl: "https://www.blm.gov/",
    apiUrl: "https://gis.blm.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "blm_arizona",
    title: "BLM - Arizona",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for Arizona public lands",
    apiUrl: "https://gis.blm.gov/azarcgis/rest/services",
    coverage: "AZ",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_california",
    title: "BLM - California",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for California public lands",
    apiUrl: "https://gis.blm.gov/caarcgis/rest/services",
    coverage: "CA",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_colorado",
    title: "BLM - Colorado",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for Colorado public lands",
    apiUrl: "https://gis.blm.gov/coarcgis/rest/services",
    coverage: "CO",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_idaho",
    title: "BLM - Idaho",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for Idaho public lands",
    apiUrl: "https://gis.blm.gov/idarcgis/rest/services",
    coverage: "ID",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_montana",
    title: "BLM - Montana",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for Montana public lands",
    apiUrl: "https://gis.blm.gov/mtarcgis/rest/services",
    coverage: "MT",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_nevada",
    title: "BLM - Nevada",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for Nevada public lands",
    apiUrl: "https://gis.blm.gov/nvarcgis/rest/services",
    coverage: "NV",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_new_mexico",
    title: "BLM - New Mexico",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for New Mexico public lands",
    apiUrl: "https://gis.blm.gov/nmarcgis/rest/services",
    coverage: "NM",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_oregon",
    title: "BLM - Oregon",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for Oregon public lands",
    apiUrl: "https://gis.blm.gov/orarcgis/rest/services",
    coverage: "OR",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_utah",
    title: "BLM - Utah",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for Utah public lands",
    apiUrl: "https://gis.blm.gov/utarcgis/rest/services",
    coverage: "UT",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_wyoming",
    title: "BLM - Wyoming",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for Wyoming public lands",
    apiUrl: "https://gis.blm.gov/wyarcgis/rest/services",
    coverage: "WY",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "blm_alaska",
    title: "BLM - Alaska",
    category: "public_lands",
    subcategory: "blm_state",
    description: "BLM data for Alaska public lands",
    apiUrl: "https://gis.blm.gov/akarcgis/rest/services",
    coverage: "AK",
    accessLevel: "free",
    priority: 2
  },

  // USDA Forest Service
  {
    key: "usfs_edw",
    title: "USDA Forest Service - Enterprise Data Warehouse",
    category: "public_lands",
    subcategory: "forest_service",
    description: "National forest boundaries, trails, recreation sites, and ownership data",
    portalUrl: "https://data.fs.usda.gov/geodata/edw/mapServices.php",
    apiUrl: "https://apps.fs.usda.gov/arcx/rest/services/EDW",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "usfs_wildfire",
    title: "USDA Forest Service - Wildfire Data",
    category: "natural_hazards",
    subcategory: "wildfire",
    description: "Wildfire risk assessment, fire perimeters, and fire history",
    apiUrl: "https://apps.fs.usda.gov/arcx/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "usfs_forest_health",
    title: "USDA Forest Service - Forest Health",
    category: "environmental",
    subcategory: "forest_health",
    description: "Forest health monitoring and assessment data",
    apiUrl: "https://apps.fs.usda.gov/fsgisx02/rest/services/foresthealth",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // USDA NRCS Soil Data
  {
    key: "nrcs_soil_survey",
    title: "USDA NRCS - Soil Survey Geographic (SSURGO)",
    category: "soil_data",
    subcategory: "soil_survey",
    description: "Detailed soil survey data including soil types, drainage, and land capability",
    portalUrl: "https://www.nrcs.usda.gov/conservation-basics/natural-resource-concerns/soils/soil-geography",
    apiUrl: "https://nrcsgeoservices.sc.egov.usda.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },

  // USDA Farm Production
  {
    key: "usda_apfo_naip",
    title: "USDA - NAIP Aerial Imagery",
    category: "imagery",
    subcategory: "aerial",
    description: "National Agriculture Imagery Program high-resolution aerial imagery",
    apiUrl: "https://gis.apfo.usda.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },

  // USGS National Map
  {
    key: "usgs_national_map",
    title: "USGS - The National Map",
    category: "topographic",
    subcategory: "basemap",
    description: "USGS topographic maps and base data",
    portalUrl: "https://apps.nationalmap.gov/services/",
    apiUrl: "https://basemap.nationalmap.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "usgs_elevation",
    title: "USGS - Elevation Data",
    category: "topographic",
    subcategory: "elevation",
    description: "National elevation dataset including DEMs and contours",
    apiUrl: "https://elevation.nationalmap.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "usgs_hydrography",
    title: "USGS - National Hydrography Dataset",
    category: "environmental",
    subcategory: "hydrology",
    description: "Streams, rivers, lakes, and watersheds",
    apiUrl: "https://hydro.nationalmap.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "usgs_3dhp",
    title: "USGS - 3D National Hydrography Program",
    category: "environmental",
    subcategory: "hydrology",
    description: "3D hydrography data for streams and water bodies",
    apiUrl: "https://3dhp.nationalmap.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "usgs_cartography",
    title: "USGS - Cartographic Data",
    category: "reference",
    subcategory: "cartography",
    description: "Cartographic reference layers including boundaries and place names",
    apiUrl: "https://carto.nationalmap.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "usgs_imagery",
    title: "USGS - National Imagery",
    category: "imagery",
    subcategory: "satellite",
    description: "NAIP and NAIPPlus satellite imagery",
    apiUrl: "https://imagery.nationalmap.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "usgs_earthquake",
    title: "USGS - Earthquake Hazards",
    category: "natural_hazards",
    subcategory: "seismic",
    description: "Earthquake hazards, faults, and seismic data",
    portalUrl: "https://earthquake.usgs.gov/",
    apiUrl: "https://earthquake.usgs.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "usgs_landfire",
    title: "USGS - LANDFIRE",
    category: "natural_hazards",
    subcategory: "wildfire",
    description: "Landscape fire and resource management planning tools data",
    apiUrl: "https://lfps.usgs.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "usgs_geologic_map",
    title: "USGS - National Geologic Map Database",
    category: "geology",
    subcategory: "geologic_maps",
    description: "Geologic maps and geological data",
    portalUrl: "https://ngmdb.usgs.gov/ngmdb/ngmdb_home.html",
    apiUrl: "https://ngmdb.usgs.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // FEMA Flood Data
  {
    key: "fema_flood_hazards",
    title: "FEMA - National Flood Hazard Layer",
    category: "natural_hazards",
    subcategory: "flood",
    description: "FEMA flood zones, flood hazard areas, and FIRM panels",
    apiUrl: "https://hazards.fema.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "fema_gis",
    title: "FEMA - Emergency Management GIS",
    category: "natural_hazards",
    subcategory: "emergency",
    description: "FEMA disaster data, weather hazards, and emergency management layers",
    apiUrl: "https://gis.fema.gov/arcgis/rest/services/",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },

  // EPA Environmental Data
  {
    key: "epa_edg",
    title: "EPA - Environmental Data Gateway",
    category: "environmental",
    subcategory: "epa",
    description: "EPA environmental data including Superfund sites and brownfields",
    portalUrl: "https://www.epa.gov/data/environmental-dataset-gateway",
    apiUrl: "https://edg.epa.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "epa_enviroatlas",
    title: "EPA - EnviroAtlas",
    category: "environmental",
    subcategory: "epa",
    description: "EPA environmental data atlas with ecosystem services",
    portalUrl: "https://www.epa.gov/enviroatlas",
    apiUrl: "https://enviroatlas.epa.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "epa_waters",
    title: "EPA - WATERS (Watershed Assessment)",
    category: "environmental",
    subcategory: "water_quality",
    description: "Watershed assessment, tracking, and environmental results",
    apiUrl: "https://watersgeo.epa.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "epa_echo",
    title: "EPA - Enforcement and Compliance History",
    category: "environmental",
    subcategory: "compliance",
    description: "EPA enforcement and compliance history for facilities",
    portalUrl: "https://echo.epa.gov",
    apiUrl: "https://echogeo.epa.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "epa_geopub",
    title: "EPA - Geospatial Publishing",
    category: "environmental",
    subcategory: "epa",
    description: "EPA geospatial data publications",
    apiUrl: "https://geopub.epa.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "epa_geodata",
    title: "EPA - Geodata Services",
    category: "environmental",
    subcategory: "epa",
    description: "EPA geodata services",
    apiUrl: "https://geodata.epa.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // HUD Housing Data
  {
    key: "hud_geospatial",
    title: "HUD - Geospatial Data Storefront",
    category: "housing",
    subcategory: "hud",
    description: "HUD housing and community development data",
    apiUrl: "https://egis.hud.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "hud_location_affordability",
    title: "HUD - Location Affordability",
    category: "housing",
    subcategory: "affordability",
    description: "Housing and transportation affordability data",
    portalUrl: "https://www.locationaffordability.info",
    apiUrl: "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // NOAA Weather and Climate
  {
    key: "noaa_water",
    title: "NOAA - Water Resources",
    category: "natural_hazards",
    subcategory: "flood",
    description: "NOAA flood and water resources data",
    apiUrl: "https://maps.water.noaa.gov/server/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "noaa_coast",
    title: "NOAA - Coastal Data",
    category: "environmental",
    subcategory: "coastal",
    description: "NOAA coastal imagery and data",
    apiUrl: "https://coast.noaa.gov/arcgis/rest/services/",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "noaa_weather",
    title: "NOAA - Weather Services",
    category: "natural_hazards",
    subcategory: "weather",
    description: "NOAA weather data and hazard outlooks",
    portalUrl: "https://www.weather.gov/ncep",
    apiUrl: "https://mapservices.weather.noaa.gov/static/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "noaa_ncei",
    title: "NOAA - National Centers for Environmental Information",
    category: "environmental",
    subcategory: "climate",
    description: "Climate and weather historical data including tsunami hazards",
    portalUrl: "https://www.ngdc.noaa.gov/",
    apiUrl: "https://gis.ngdc.noaa.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // DOT Transportation
  {
    key: "dot_bts",
    title: "DOT - Bureau of Transportation Statistics",
    category: "transportation",
    subcategory: "ntad",
    description: "National Transportation Atlas Database including dams, bridges, congressional districts",
    portalUrl: "https://geodata.bts.gov",
    apiUrl: "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "dot_fhwa",
    title: "DOT - Federal Highway Administration",
    category: "transportation",
    subcategory: "highways",
    description: "Highway safety and infrastructure data including pipelines",
    apiUrl: "https://geo.dot.gov/server/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "dot_fra",
    title: "DOT - Federal Railroad Administration",
    category: "transportation",
    subcategory: "railroads",
    description: "Railroad infrastructure and grade crossings data",
    portalUrl: "https://railroads.dot.gov",
    apiUrl: "https://fragis.fra.dot.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "dot_faa",
    title: "DOT - Federal Aviation Administration",
    category: "transportation",
    subcategory: "aviation",
    description: "FAA airspace data including drone flight restrictions",
    apiUrl: "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 3
  },

  // National Park Service
  {
    key: "nps_national",
    title: "National Park Service - National Datasets",
    category: "public_lands",
    subcategory: "nps",
    description: "National park boundaries, trails, and recreation data",
    portalUrl: "https://www.nps.gov/orgs/1581/index.htm",
    apiUrl: "https://mapservices.nps.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },

  // Fish and Wildlife Service
  {
    key: "fws_wetlands",
    title: "USFWS - National Wetlands Inventory",
    category: "environmental",
    subcategory: "wetlands",
    description: "National Wetlands Inventory data",
    portalUrl: "https://www.fws.gov",
    apiUrl: "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "fws_critical_habitat",
    title: "USFWS - Critical Habitat",
    category: "environmental",
    subcategory: "wildlife",
    description: "Critical habitat for threatened and endangered species",
    apiUrl: "https://services.arcgis.com/QVENGdaPbd4LUkLV/ArcGIS/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "fws_cbrs",
    title: "USFWS - Coastal Barrier Resources System",
    category: "environmental",
    subcategory: "coastal",
    description: "Coastal barrier resources and protected areas",
    apiUrl: "https://cbrsgis.wim.usgs.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // Bureau of Indian Affairs
  {
    key: "bia_tribal_lands",
    title: "Bureau of Indian Affairs - Tribal Lands",
    category: "public_lands",
    subcategory: "tribal",
    description: "Bureau of Indian Affairs tribal land boundaries",
    portalUrl: "https://opendata-1-bia-geospatial.hub.arcgis.com",
    apiUrl: "https://biamaps.geoplatform.gov/server/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // Bureau of Reclamation
  {
    key: "usbr_reclamation",
    title: "Bureau of Reclamation - Water Projects",
    category: "water_resources",
    subcategory: "reclamation",
    description: "Bureau of Reclamation water projects and infrastructure",
    portalUrl: "https://www.usbr.gov",
    apiUrl: "https://geo.usbr.gov/server/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // Surface Mining
  {
    key: "osmre_mining",
    title: "OSMRE - Surface Mining Reclamation",
    category: "mineral_resources",
    subcategory: "mining",
    description: "Surface mining and reclamation data",
    portalUrl: "https://www.osmre.gov/",
    apiUrl: "https://geoservices.osmre.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // Army Corps of Engineers
  {
    key: "usace_dams",
    title: "Army Corps of Engineers - National Inventory of Dams",
    category: "water_resources",
    subcategory: "dams",
    description: "National Inventory of Dams and related infrastructure",
    apiUrl: "https://geospatial.sec.usace.army.mil/dls/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "usace_congressional",
    title: "Army Corps of Engineers - Congressional Districts",
    category: "census_boundaries",
    subcategory: "legislative",
    description: "Congressional districts with representative data",
    apiUrl: "https://geospatial.sec.usace.army.mil/server/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // Energy
  {
    key: "doe_eia",
    title: "DOE - Energy Information Administration",
    category: "energy",
    subcategory: "eia",
    description: "Energy infrastructure data from EIA",
    portalUrl: "https://www.eia.gov",
    apiUrl: "https://services.arcgis.com/jDGuO8tYggdCCnUJ/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "doe_oil_gas",
    title: "DOE - Oil and Gas Wells",
    category: "energy",
    subcategory: "oil_gas",
    description: "Oil and gas well locations",
    apiUrl: "https://services7.arcgis.com/FGr1D95XCGALKXqM/ArcGIS/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  },

  // FCC Communications
  {
    key: "fcc_broadband",
    title: "FCC - Broadband Data",
    category: "infrastructure",
    subcategory: "telecommunications",
    description: "FCC broadband coverage and communications data",
    apiUrl: "https://services.arcgis.com/YnOQrIGdN9JGtBh4/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 3
  },

  // Education
  {
    key: "nces_education",
    title: "NCES - Education Statistics",
    category: "education",
    subcategory: "schools",
    description: "National Center for Education Statistics data",
    portalUrl: "https://www.ed.gov/data",
    apiUrl: "https://nces.ed.gov/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 3
  },

  // USPS Postal
  {
    key: "usps_zip5",
    title: "USPS - ZIP Code Boundaries",
    category: "administrative",
    subcategory: "postal",
    description: "USPS ZIP Code 5 boundaries",
    apiUrl: "https://gis.usps.com/arcgis/rest/services",
    coverage: "usa",
    accessLevel: "free",
    priority: 2
  }
];

async function importGISSources() {
  console.log("Starting GIS data source import...\n");

  const allEndpoints = [...TIGERWEB_ENDPOINTS, ...FEDERAL_ENDPOINTS];
  console.log(`Total endpoints to process: ${allEndpoints.length}`);
  console.log(`  - TIGERweb Census endpoints: ${TIGERWEB_ENDPOINTS.length}`);
  console.log(`  - Federal endpoints: ${FEDERAL_ENDPOINTS.length}\n`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const endpoint of allEndpoints) {
    try {
      const existing = await db.select()
        .from(dataSources)
        .where(eq(dataSources.key, endpoint.key))
        .limit(1);

      if (existing.length > 0) {
        const existingRecord = existing[0];
        if (existingRecord.apiUrl !== endpoint.apiUrl || existingRecord.title !== endpoint.title) {
          await db.update(dataSources)
            .set({
              title: endpoint.title,
              category: endpoint.category,
              subcategory: endpoint.subcategory,
              description: endpoint.description,
              portalUrl: endpoint.portalUrl || null,
              apiUrl: endpoint.apiUrl,
              coverage: endpoint.coverage,
              accessLevel: endpoint.accessLevel,
              priority: endpoint.priority,
              updatedAt: new Date()
            })
            .where(eq(dataSources.id, existingRecord.id));
          updated++;
          console.log(`  Updated: ${endpoint.title}`);
        } else {
          skipped++;
        }
      } else {
        await db.insert(dataSources).values({
          key: endpoint.key,
          title: endpoint.title,
          category: endpoint.category,
          subcategory: endpoint.subcategory,
          description: endpoint.description,
          portalUrl: endpoint.portalUrl || null,
          apiUrl: endpoint.apiUrl,
          coverage: endpoint.coverage,
          accessLevel: endpoint.accessLevel,
          priority: endpoint.priority,
          isEnabled: true
        });
        inserted++;
        console.log(`  Inserted: ${endpoint.title}`);
      }
    } catch (error) {
      console.error(`  Error processing ${endpoint.key}:`, error);
    }
  }

  console.log("\n=== Import Summary ===");
  console.log(`Inserted: ${inserted} new endpoints`);
  console.log(`Updated: ${updated} existing endpoints`);
  console.log(`Skipped: ${skipped} unchanged endpoints`);

  const finalCount = await db.select().from(dataSources);
  console.log(`\nTotal data sources in database: ${finalCount.length}`);

  const byCategory = finalCount.reduce((acc, ds) => {
    acc[ds.category] = (acc[ds.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log("\nData sources by category:");
  Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
}

importGISSources()
  .then(() => {
    console.log("\nImport completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  });
