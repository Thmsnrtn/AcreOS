import { db } from "../server/db";
import { dataSources } from "../shared/schema";
import { eq } from "drizzle-orm";

interface StateGISEndpoint {
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

const STATE_GIS_ENDPOINTS: StateGISEndpoint[] = [
  // ALABAMA
  {
    key: "al_geoportal",
    title: "Alabama - State GIS Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Alabama state GIS data including boundaries and parcels",
    apiUrl: "https://maps.alabama.gov/algogis/rest/services",
    coverage: "AL",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "al_environmental",
    title: "Alabama - Environmental Management",
    category: "state_gis",
    subcategory: "environmental",
    description: "Alabama environmental data",
    portalUrl: "https://adem.alabama.gov",
    apiUrl: "https://gis.adem.alabama.gov/arcgis/rest/services",
    coverage: "AL",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "al_transportation",
    title: "Alabama - Department of Transportation",
    category: "state_gis",
    subcategory: "transportation",
    description: "Alabama roads and transportation data",
    apiUrl: "https://aldotgis.dot.state.al.us/pubgis1/rest/services",
    coverage: "AL",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "al_parcels",
    title: "Alabama - Statewide Parcels",
    category: "state_gis",
    subcategory: "parcels",
    description: "Alabama statewide parcel data",
    apiUrl: "https://services7.arcgis.com/jF2q3LPxL7PETdYk/arcgis/rest/services",
    coverage: "AL",
    accessLevel: "free",
    priority: 1
  },

  // ALASKA
  {
    key: "ak_geoportal",
    title: "Alaska - State Geoportal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Alaska state geospatial data portal",
    portalUrl: "https://dec.alaska.gov/das/gis/links",
    apiUrl: "https://geoportal.alaska.gov/arcgis/rest/services",
    coverage: "AK",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "ak_dnr",
    title: "Alaska - Natural Resources",
    category: "state_gis",
    subcategory: "natural_resources",
    description: "Alaska Department of Natural Resources data",
    portalUrl: "https://dnr.alaska.gov",
    apiUrl: "https://arcgis.dnr.alaska.gov/arcgis/rest/services",
    coverage: "AK",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "ak_parcels",
    title: "Alaska - Statewide Parcels",
    category: "state_gis",
    subcategory: "parcels",
    description: "Alaska statewide parcel data",
    apiUrl: "https://services1.arcgis.com/7HDiw78fcUiM2BWn/arcgis/rest/services",
    coverage: "AK",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "ak_elevation",
    title: "Alaska - Elevation Data",
    category: "state_gis",
    subcategory: "topography",
    description: "Alaska elevation and terrain data",
    apiUrl: "https://elevation.alaska.gov/arcgis/rest/services",
    coverage: "AK",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "ak_geology",
    title: "Alaska - Geological Survey",
    category: "state_gis",
    subcategory: "geology",
    description: "Alaska geological and geophysical data",
    portalUrl: "https://dggs.alaska.gov",
    apiUrl: "https://maps.dggs.alaska.gov/arcgis/rest/services",
    coverage: "AK",
    accessLevel: "free",
    priority: 2
  },

  // ARIZONA
  {
    key: "az_geoportal",
    title: "Arizona - AZGEO Open Data",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Arizona state GIS data including boundaries and administrative data",
    portalUrl: "https://azgeo-open-data-agic.hub.arcgis.com",
    apiUrl: "https://azgeo.az.gov/arcgis/rest/services",
    coverage: "AZ",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "az_water",
    title: "Arizona - Water Resources",
    category: "state_gis",
    subcategory: "water",
    description: "Arizona water resources including parcels by county",
    portalUrl: "https://new.azwater.gov/",
    apiUrl: "https://azwatermaps.azwater.gov/arcgis/rest/services",
    coverage: "AZ",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "az_land",
    title: "Arizona - Land Department",
    category: "state_gis",
    subcategory: "land",
    description: "Arizona Land Department data",
    portalUrl: "https://land.az.gov",
    apiUrl: "https://services1.arcgis.com/UpxtrwRYNaXVpkGe/ArcGIS/rest/services",
    coverage: "AZ",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "az_environmental",
    title: "Arizona - Environmental Quality",
    category: "state_gis",
    subcategory: "environmental",
    description: "Arizona environmental data",
    portalUrl: "https://azdeq.gov",
    apiUrl: "https://services.arcgis.com/SzoH1oFM2apCSkx3/arcgis/rest/services",
    coverage: "AZ",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "az_transportation",
    title: "Arizona - Department of Transportation",
    category: "state_gis",
    subcategory: "transportation",
    description: "Arizona transportation data",
    portalUrl: "https://www.azdot.gov",
    apiUrl: "https://services1.arcgis.com/XAiBIVuto7zeZj1B/ArcGIS/rest/services",
    coverage: "AZ",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "az_mag",
    title: "Arizona - Maricopa Association of Governments",
    category: "regional_gis",
    subcategory: "planning",
    description: "Maricopa regional planning data",
    apiUrl: "https://geo.azmag.gov/arcgis/rest/services",
    coverage: "AZ",
    accessLevel: "free",
    priority: 2
  },

  // ARKANSAS  
  {
    key: "ar_geoportal",
    title: "Arkansas - GIS Office",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Arkansas state GIS data",
    apiUrl: "https://gis.arkansas.gov/arcgis/rest/services",
    coverage: "AR",
    accessLevel: "free",
    priority: 2
  },

  // CALIFORNIA
  {
    key: "ca_geoportal",
    title: "California - Open Data Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "California state open data GIS services",
    apiUrl: "https://gis.data.ca.gov/arcgis/rest/services",
    coverage: "CA",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "ca_resources",
    title: "California - Natural Resources Agency",
    category: "state_gis",
    subcategory: "natural_resources",
    description: "California natural resources data",
    apiUrl: "https://gis.cnra.ca.gov/arcgis/rest/services",
    coverage: "CA",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "ca_forestry",
    title: "California - Forestry and Fire Protection",
    category: "state_gis",
    subcategory: "fire",
    description: "California fire hazard and forestry data",
    apiUrl: "https://egis.fire.ca.gov/arcgis/rest/services",
    coverage: "CA",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "ca_water",
    title: "California - Water Resources",
    category: "state_gis",
    subcategory: "water",
    description: "California water resources data",
    apiUrl: "https://gis.water.ca.gov/arcgis/rest/services",
    coverage: "CA",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "ca_geology",
    title: "California - Geological Survey",
    category: "state_gis",
    subcategory: "geology",
    description: "California geological data and earthquake faults",
    apiUrl: "https://maps.conservation.ca.gov/arcgis/rest/services",
    coverage: "CA",
    accessLevel: "free",
    priority: 1
  },

  // COLORADO
  {
    key: "co_geoportal",
    title: "Colorado - GIS Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Colorado state GIS data",
    apiUrl: "https://www.arcgis.com/sharing/rest/search?q=orgid:4RTg7AHaZv4Y&f=json",
    coverage: "CO",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "co_dola",
    title: "Colorado - Local Affairs",
    category: "state_gis",
    subcategory: "demographics",
    description: "Colorado demographics and local data",
    apiUrl: "https://services5.arcgis.com/ttNGmDvKTfljHzkm/arcgis/rest/services",
    coverage: "CO",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "co_water",
    title: "Colorado - Water Conservation Board",
    category: "state_gis",
    subcategory: "water",
    description: "Colorado water and flood data",
    apiUrl: "https://services6.arcgis.com/CIH3sDvp0sGZNaRn/arcgis/rest/services",
    coverage: "CO",
    accessLevel: "free",
    priority: 2
  },

  // CONNECTICUT
  {
    key: "ct_geoportal",
    title: "Connecticut - GIS Data",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Connecticut state GIS data",
    apiUrl: "https://ctgismaps.ct.gov/arcgis/rest/services",
    coverage: "CT",
    accessLevel: "free",
    priority: 2
  },

  // DELAWARE
  {
    key: "de_geoportal",
    title: "Delaware - FirstMap",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Delaware state GIS data portal",
    apiUrl: "https://firstmap.delaware.gov/arcgis/rest/services",
    coverage: "DE",
    accessLevel: "free",
    priority: 2
  },

  // FLORIDA
  {
    key: "fl_geoportal",
    title: "Florida - Geographic Data Library",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Florida state GIS data library",
    apiUrl: "https://ca.dep.state.fl.us/arcgis/rest/services",
    coverage: "FL",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "fl_environmental",
    title: "Florida - Environmental Protection",
    category: "state_gis",
    subcategory: "environmental",
    description: "Florida environmental data",
    apiUrl: "https://geodata.dep.state.fl.us/arcgis/rest/services",
    coverage: "FL",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "fl_water",
    title: "Florida - Water Management Districts",
    category: "state_gis",
    subcategory: "water",
    description: "Florida water management data",
    apiUrl: "https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services",
    coverage: "FL",
    accessLevel: "free",
    priority: 1
  },

  // GEORGIA
  {
    key: "ga_geoportal",
    title: "Georgia - GIS Clearinghouse",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Georgia state GIS data clearinghouse",
    apiUrl: "https://gis.gadnr.org/server/rest/services",
    coverage: "GA",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "ga_transportation",
    title: "Georgia - Department of Transportation",
    category: "state_gis",
    subcategory: "transportation",
    description: "Georgia transportation data",
    apiUrl: "https://gdot.dot.ga.gov/gdotmaps/rest/services",
    coverage: "GA",
    accessLevel: "free",
    priority: 2
  },

  // HAWAII
  {
    key: "hi_geoportal",
    title: "Hawaii - Statewide GIS Program",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Hawaii state GIS data",
    apiUrl: "https://geodata.hawaii.gov/arcgis/rest/services",
    coverage: "HI",
    accessLevel: "free",
    priority: 2
  },

  // IDAHO
  {
    key: "id_geoportal",
    title: "Idaho - INSIDE Idaho",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Idaho state GIS data",
    apiUrl: "https://gis.idwr.idaho.gov/arcgis/rest/services",
    coverage: "ID",
    accessLevel: "free",
    priority: 2
  },
  {
    key: "id_lands",
    title: "Idaho - Department of Lands",
    category: "state_gis",
    subcategory: "land",
    description: "Idaho land management data",
    apiUrl: "https://gis.idl.idaho.gov/arcgis/rest/services",
    coverage: "ID",
    accessLevel: "free",
    priority: 2
  },

  // ILLINOIS
  {
    key: "il_geoportal",
    title: "Illinois - GIS Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Illinois state GIS data",
    apiUrl: "https://clearinghouse.isgs.illinois.edu/arcgis/rest/services",
    coverage: "IL",
    accessLevel: "free",
    priority: 2
  },

  // INDIANA
  {
    key: "in_geoportal",
    title: "Indiana - IndianaMAP",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Indiana state GIS data portal",
    apiUrl: "https://maps.indiana.edu/arcgis/rest/services",
    coverage: "IN",
    accessLevel: "free",
    priority: 2
  },

  // IOWA
  {
    key: "ia_geoportal",
    title: "Iowa - GIS Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Iowa state GIS data",
    apiUrl: "https://programs.iowadnr.gov/maps/rest/services",
    coverage: "IA",
    accessLevel: "free",
    priority: 2
  },

  // KANSAS
  {
    key: "ks_geoportal",
    title: "Kansas - Data Access and Support Center",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Kansas state GIS data",
    apiUrl: "https://services.kansasgis.org/arcgis/rest/services",
    coverage: "KS",
    accessLevel: "free",
    priority: 2
  },

  // KENTUCKY
  {
    key: "ky_geoportal",
    title: "Kentucky - Division of Geographic Information",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Kentucky state GIS data",
    apiUrl: "https://kygisserver.ky.gov/arcgis/rest/services",
    coverage: "KY",
    accessLevel: "free",
    priority: 2
  },

  // LOUISIANA
  {
    key: "la_geoportal",
    title: "Louisiana - Atlas",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Louisiana state GIS data",
    apiUrl: "https://maps.lsuagcenter.com/arcgis/rest/services",
    coverage: "LA",
    accessLevel: "free",
    priority: 2
  },

  // MAINE
  {
    key: "me_geoportal",
    title: "Maine - Office of GIS",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Maine state GIS data",
    apiUrl: "https://gis.maine.gov/arcgis/rest/services",
    coverage: "ME",
    accessLevel: "free",
    priority: 2
  },

  // MARYLAND
  {
    key: "md_geoportal",
    title: "Maryland - iMAP",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Maryland state GIS data portal",
    apiUrl: "https://geodata.md.gov/imap/rest/services",
    coverage: "MD",
    accessLevel: "free",
    priority: 2
  },

  // MASSACHUSETTS
  {
    key: "ma_geoportal",
    title: "Massachusetts - MassGIS",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Massachusetts state GIS data",
    apiUrl: "https://gis.massdot.state.ma.us/arcgis/rest/services",
    coverage: "MA",
    accessLevel: "free",
    priority: 2
  },

  // MICHIGAN
  {
    key: "mi_geoportal",
    title: "Michigan - Open Data Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Michigan state GIS data",
    apiUrl: "https://services3.arcgis.com/MsPIFPFRD6x8K5tV/arcgis/rest/services",
    coverage: "MI",
    accessLevel: "free",
    priority: 2
  },

  // MINNESOTA
  {
    key: "mn_geoportal",
    title: "Minnesota - Geospatial Commons",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Minnesota state GIS data",
    apiUrl: "https://gis.mn.gov/arcgis/rest/services",
    coverage: "MN",
    accessLevel: "free",
    priority: 2
  },

  // MISSISSIPPI
  {
    key: "ms_geoportal",
    title: "Mississippi - MARIS",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Mississippi state GIS data",
    apiUrl: "https://maps.maris.state.ms.us/arcgis/rest/services",
    coverage: "MS",
    accessLevel: "free",
    priority: 2
  },

  // MISSOURI
  {
    key: "mo_geoportal",
    title: "Missouri - Spatial Data Information Service",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Missouri state GIS data",
    apiUrl: "https://msdis.maps.arcgis.com/sharing/rest/content",
    coverage: "MO",
    accessLevel: "free",
    priority: 2
  },

  // MONTANA
  {
    key: "mt_geoportal",
    title: "Montana - State Library GIS",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Montana state GIS data",
    apiUrl: "https://gis.dnrc.mt.gov/arcgis/rest/services",
    coverage: "MT",
    accessLevel: "free",
    priority: 2
  },

  // NEBRASKA
  {
    key: "ne_geoportal",
    title: "Nebraska - NEGIS",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Nebraska state GIS data",
    apiUrl: "https://www.nebraskamap.gov/arcgis/rest/services",
    coverage: "NE",
    accessLevel: "free",
    priority: 2
  },

  // NEVADA
  {
    key: "nv_geoportal",
    title: "Nevada - State Lands",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Nevada state GIS data",
    apiUrl: "https://maps.nvdot.com/arcgis/rest/services",
    coverage: "NV",
    accessLevel: "free",
    priority: 2
  },

  // NEW HAMPSHIRE
  {
    key: "nh_geoportal",
    title: "New Hampshire - GRANIT",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "New Hampshire state GIS data",
    apiUrl: "https://nhgeodata.unh.edu/arcgis/rest/services",
    coverage: "NH",
    accessLevel: "free",
    priority: 2
  },

  // NEW JERSEY
  {
    key: "nj_geoportal",
    title: "New Jersey - GIS Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "New Jersey state GIS data",
    apiUrl: "https://mapsdep.nj.gov/arcgis/rest/services",
    coverage: "NJ",
    accessLevel: "free",
    priority: 2
  },

  // NEW MEXICO
  {
    key: "nm_geoportal",
    title: "New Mexico - Resource Geographic Information System",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "New Mexico state GIS data",
    apiUrl: "https://gis.nm.gov/arcgis/rest/services",
    coverage: "NM",
    accessLevel: "free",
    priority: 2
  },

  // NEW YORK
  {
    key: "ny_geoportal",
    title: "New York - GIS Clearinghouse",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "New York state GIS data",
    apiUrl: "https://gis.ny.gov/arcgis/rest/services",
    coverage: "NY",
    accessLevel: "free",
    priority: 2
  },

  // NORTH CAROLINA
  {
    key: "nc_geoportal",
    title: "North Carolina - OneMap",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "North Carolina state GIS data",
    apiUrl: "https://services.nconemap.gov/arcgis/rest/services",
    coverage: "NC",
    accessLevel: "free",
    priority: 2
  },

  // NORTH DAKOTA
  {
    key: "nd_geoportal",
    title: "North Dakota - GIS Hub",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "North Dakota state GIS data",
    apiUrl: "https://ndgishub.nd.gov/arcgis/rest/services",
    coverage: "ND",
    accessLevel: "free",
    priority: 2
  },

  // OHIO
  {
    key: "oh_geoportal",
    title: "Ohio - OGRIP",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Ohio state GIS data",
    apiUrl: "https://gis.ohiodnr.gov/arcgis/rest/services",
    coverage: "OH",
    accessLevel: "free",
    priority: 2
  },

  // OKLAHOMA
  {
    key: "ok_geoportal",
    title: "Oklahoma - Geographic Information Council",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Oklahoma state GIS data",
    apiUrl: "https://gis.ok.gov/arcgis/rest/services",
    coverage: "OK",
    accessLevel: "free",
    priority: 2
  },

  // OREGON
  {
    key: "or_geoportal",
    title: "Oregon - Spatial Data Library",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Oregon state GIS data",
    apiUrl: "https://navigator.state.or.us/arcgis/rest/services",
    coverage: "OR",
    accessLevel: "free",
    priority: 2
  },

  // PENNSYLVANIA
  {
    key: "pa_geoportal",
    title: "Pennsylvania - PASDA",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Pennsylvania state GIS data",
    apiUrl: "https://mapservices.pasda.psu.edu/arcgis/rest/services",
    coverage: "PA",
    accessLevel: "free",
    priority: 2
  },

  // RHODE ISLAND
  {
    key: "ri_geoportal",
    title: "Rhode Island - RIGIS",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Rhode Island state GIS data",
    apiUrl: "https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services",
    coverage: "RI",
    accessLevel: "free",
    priority: 2
  },

  // SOUTH CAROLINA
  {
    key: "sc_geoportal",
    title: "South Carolina - DNR GIS",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "South Carolina state GIS data",
    apiUrl: "https://gisweb.dnr.sc.gov/arcgis/rest/services",
    coverage: "SC",
    accessLevel: "free",
    priority: 2
  },

  // SOUTH DAKOTA
  {
    key: "sd_geoportal",
    title: "South Dakota - GIS Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "South Dakota state GIS data",
    apiUrl: "https://arcgis.sd.gov/arcgis/rest/services",
    coverage: "SD",
    accessLevel: "free",
    priority: 2
  },

  // TENNESSEE
  {
    key: "tn_geoportal",
    title: "Tennessee - GIS Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Tennessee state GIS data",
    apiUrl: "https://services1.arcgis.com/NupP5b0P5kKdEzc4/arcgis/rest/services",
    coverage: "TN",
    accessLevel: "free",
    priority: 2
  },

  // TEXAS
  {
    key: "tx_geoportal",
    title: "Texas - Natural Resources Information System",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Texas state GIS data including land and natural resources",
    apiUrl: "https://mapserver.tnris.org/arcgis/rest/services",
    coverage: "TX",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "tx_land",
    title: "Texas - General Land Office",
    category: "state_gis",
    subcategory: "land",
    description: "Texas land office data",
    apiUrl: "https://gis.glo.texas.gov/arcgis/rest/services",
    coverage: "TX",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "tx_water",
    title: "Texas - Water Development Board",
    category: "state_gis",
    subcategory: "water",
    description: "Texas water resources data",
    apiUrl: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services",
    coverage: "TX",
    accessLevel: "free",
    priority: 1
  },
  {
    key: "tx_rrc",
    title: "Texas - Railroad Commission",
    category: "state_gis",
    subcategory: "energy",
    description: "Texas oil and gas data",
    apiUrl: "https://gis.rrc.texas.gov/arcgis/rest/services",
    coverage: "TX",
    accessLevel: "free",
    priority: 1
  },

  // UTAH
  {
    key: "ut_geoportal",
    title: "Utah - UGRC AGOL",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Utah state GIS data",
    apiUrl: "https://gis.utah.gov/arcgis/rest/services",
    coverage: "UT",
    accessLevel: "free",
    priority: 2
  },

  // VERMONT
  {
    key: "vt_geoportal",
    title: "Vermont - Open Geodata Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Vermont state GIS data",
    apiUrl: "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services",
    coverage: "VT",
    accessLevel: "free",
    priority: 2
  },

  // VIRGINIA
  {
    key: "va_geoportal",
    title: "Virginia - VGIN",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Virginia state GIS data",
    apiUrl: "https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services",
    coverage: "VA",
    accessLevel: "free",
    priority: 2
  },

  // WASHINGTON
  {
    key: "wa_geoportal",
    title: "Washington - Geospatial Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Washington state GIS data",
    apiUrl: "https://gis.dnr.wa.gov/arcgis/rest/services",
    coverage: "WA",
    accessLevel: "free",
    priority: 2
  },

  // WEST VIRGINIA
  {
    key: "wv_geoportal",
    title: "West Virginia - GIS Technical Center",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "West Virginia state GIS data",
    apiUrl: "https://services.wvgis.wvu.edu/arcgis/rest/services",
    coverage: "WV",
    accessLevel: "free",
    priority: 2
  },

  // WISCONSIN
  {
    key: "wi_geoportal",
    title: "Wisconsin - SCO GIS Data Portal",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Wisconsin state GIS data",
    apiUrl: "https://services.sco.wisc.edu/arcgis/rest/services",
    coverage: "WI",
    accessLevel: "free",
    priority: 2
  },

  // WYOMING
  {
    key: "wy_geoportal",
    title: "Wyoming - Geospatial Hub",
    category: "state_gis",
    subcategory: "multi_layer",
    description: "Wyoming state GIS data",
    apiUrl: "https://gis.wyo.gov/arcgis/rest/services",
    coverage: "WY",
    accessLevel: "free",
    priority: 2
  }
];

async function importStateGISSources() {
  console.log("Starting State GIS data source import...\n");

  console.log(`Total state endpoints to process: ${STATE_GIS_ENDPOINTS.length}`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const endpoint of STATE_GIS_ENDPOINTS) {
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

  console.log("\n=== State GIS Import Summary ===");
  console.log(`Inserted: ${inserted} new state endpoints`);
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
    .slice(0, 25)
    .forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });

  const stateCount = STATE_GIS_ENDPOINTS.reduce((acc, ep) => {
    acc[ep.coverage] = (acc[ep.coverage] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`\nStates covered: ${Object.keys(stateCount).length}`);
}

importStateGISSources()
  .then(() => {
    console.log("\nState GIS import completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Import failed:", error);
    process.exit(1);
  });
