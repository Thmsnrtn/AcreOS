"""
AcreOS ML Pipeline — Feature Engineering
==========================================
Creates derived features from raw property and market data for use in the
land valuation and credit scoring models.
"""

import pandas as pd
import numpy as np
from typing import List, Dict, Any


# ---------------------------------------------------------------------------
# Feature name registry
# ---------------------------------------------------------------------------

_PROPERTY_FEATURES = [
    # Acreage
    "size_acres",
    "log_size_acres",
    "acreage_category",          # encoded: micro/small/medium/large/xl
    # Price signals
    "price_per_acre",
    "log_price_per_acre",
    # Location
    "distance_to_metro",
    "distance_to_metro_bucket",  # encoded: <25/25-75/75-150/150+
    "is_rural",
    # Physical
    "has_road_access",
    "has_utilities",
    "has_water",
    "has_wetlands",
    # Environmental
    "flood_risk_score",          # numeric encoding of flood_zone
    "soil_quality_score",        # numeric encoding of soil_quality
    # Zoning
    "zoning_encoded",
    # Boolean combos
    "full_amenities",            # road + utilities + water
    "infrastructure_score",      # 0–3 count
]

_MARKET_FEATURES = [
    "county_avg_price_per_acre",
    "county_price_ratio",        # property price_per_acre / county avg
    "county_median_dom",
    "county_active_inventory",
    "county_absorption_rate",
    "county_recent_transactions",
    "county_median_income",
    "population_density",
    "log_population_density",
]

ALL_FEATURE_NAMES = _PROPERTY_FEATURES + _MARKET_FEATURES


# ---------------------------------------------------------------------------
# Property feature engineering
# ---------------------------------------------------------------------------

def engineer_property_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Create derived features from raw property columns.

    Input columns used (all optional except size_acres):
        size_acres, price_per_acre, distance_to_metro,
        has_road_access, has_utilities, has_water, has_wetlands,
        flood_zone, soil_quality, zoning.

    Returns a new DataFrame with original columns plus derived features.
    """
    df = df.copy()

    # --- Acreage features ---
    df["size_acres"] = pd.to_numeric(df.get("size_acres", 0), errors="coerce").fillna(0)
    df["log_size_acres"] = np.log1p(df["size_acres"])

    bins = [0, 1, 10, 50, 200, float("inf")]
    labels = [0, 1, 2, 3, 4]  # micro, small, medium, large, xl
    df["acreage_category"] = pd.cut(
        df["size_acres"], bins=bins, labels=labels, right=False
    ).astype(float)

    # --- Price per acre features ---
    if "price_per_acre" in df.columns:
        df["price_per_acre"] = pd.to_numeric(df["price_per_acre"], errors="coerce").fillna(0)
        df["log_price_per_acre"] = np.log1p(df["price_per_acre"])

    # --- Location features ---
    if "distance_to_metro" in df.columns:
        df["distance_to_metro"] = pd.to_numeric(df["distance_to_metro"], errors="coerce").fillna(150)
    else:
        df["distance_to_metro"] = 150.0

    metro_bins = [0, 25, 75, 150, float("inf")]
    metro_labels = [0, 1, 2, 3]  # urban-fringe, suburban, exurban, rural
    df["distance_to_metro_bucket"] = pd.cut(
        df["distance_to_metro"], bins=metro_bins, labels=metro_labels, right=False
    ).astype(float)

    df["is_rural"] = (df["distance_to_metro"] > 75).astype(int)

    # --- Boolean / access features ---
    for col in ["has_road_access", "has_utilities", "has_water", "has_wetlands"]:
        if col in df.columns:
            df[col] = df[col].fillna(False).astype(int)
        else:
            df[col] = 0

    df["infrastructure_score"] = (
        df["has_road_access"] + df["has_utilities"] + df["has_water"]
    )
    df["full_amenities"] = (df["infrastructure_score"] == 3).astype(int)

    # --- Environmental / flood risk ---
    flood_map = {"X": 0, "X500": 1, "AO": 2, "AE": 3, "A": 3, "VE": 4, "V": 4, "unknown": 1}
    if "flood_zone" in df.columns:
        df["flood_risk_score"] = df["flood_zone"].fillna("unknown").map(
            lambda x: flood_map.get(str(x).upper(), 1)
        )
    else:
        df["flood_risk_score"] = 1

    # --- Soil quality ---
    soil_map = {"prime": 5, "high": 4, "medium": 3, "low": 2, "poor": 1, "unknown": 3}
    if "soil_quality" in df.columns:
        df["soil_quality_score"] = df["soil_quality"].fillna("unknown").map(
            lambda x: soil_map.get(str(x).lower(), 3)
        )
    else:
        df["soil_quality_score"] = 3

    # --- Zoning encoding ---
    zoning_map: Dict[str, int] = {
        "agricultural": 1, "ag": 1, "residential": 2, "res": 2,
        "commercial": 3, "com": 3, "industrial": 4, "ind": 4,
        "recreational": 5, "rec": 5, "conservation": 6, "mixed": 7,
        "unknown": 0,
    }
    if "zoning" in df.columns:
        df["zoning_encoded"] = df["zoning"].fillna("unknown").str.lower().map(
            lambda x: next((v for k, v in zoning_map.items() if k in x), 0)
        )
    else:
        df["zoning_encoded"] = 0

    return df


# ---------------------------------------------------------------------------
# Market feature engineering
# ---------------------------------------------------------------------------

def engineer_market_features(
    df: pd.DataFrame,
    market_data: Dict[str, Any],
) -> pd.DataFrame:
    """
    Add county-level market features to each row.

    `market_data` is a dict keyed by "{state}|{county}" with values:
        {
            "avg_price_per_acre": float,
            "median_dom": float,
            "active_inventory": int,
            "absorption_rate": float,
            "recent_transactions": int,
            "median_income": float,
        }

    Returns df with additional market columns appended.
    """
    df = df.copy()

    def lookup(row: pd.Series, field: str, default: float = 0.0) -> float:
        key = f"{row.get('state', '')}|{row.get('county', '')}"
        return market_data.get(key, {}).get(field, default)

    df["county_avg_price_per_acre"] = df.apply(lambda r: lookup(r, "avg_price_per_acre", 5000), axis=1)
    df["county_median_dom"] = df.apply(lambda r: lookup(r, "median_dom", 120), axis=1)
    df["county_active_inventory"] = df.apply(lambda r: lookup(r, "active_inventory", 10), axis=1)
    df["county_absorption_rate"] = df.apply(lambda r: lookup(r, "absorption_rate", 0.1), axis=1)
    df["county_recent_transactions"] = df.apply(lambda r: lookup(r, "recent_transactions", 0), axis=1)

    if "county_median_income" not in df.columns:
        df["county_median_income"] = df.apply(lambda r: lookup(r, "median_income", 55000), axis=1)

    # Ratio: how does this property compare to county average?
    df["county_price_ratio"] = np.where(
        df["county_avg_price_per_acre"] > 0,
        df.get("price_per_acre", df["county_avg_price_per_acre"]) / df["county_avg_price_per_acre"],
        1.0,
    )

    # Log population density
    if "population_density" in df.columns:
        df["population_density"] = pd.to_numeric(df["population_density"], errors="coerce").fillna(10)
    else:
        df["population_density"] = 10.0
    df["log_population_density"] = np.log1p(df["population_density"])

    return df


# ---------------------------------------------------------------------------
# Combined pipeline
# ---------------------------------------------------------------------------

def engineer_all_features(
    df: pd.DataFrame,
    market_data: Dict[str, Any] | None = None,
) -> pd.DataFrame:
    """
    Run the full feature engineering pipeline (property + market).

    `market_data` defaults to an empty dict (market features will use defaults).
    """
    df = engineer_property_features(df)
    df = engineer_market_features(df, market_data or {})
    return df


def get_feature_names(include_market: bool = True) -> List[str]:
    """Return the ordered list of all engineered feature column names."""
    if include_market:
        return list(ALL_FEATURE_NAMES)
    return list(_PROPERTY_FEATURES)


def get_feature_matrix(df: pd.DataFrame, include_market: bool = True) -> pd.DataFrame:
    """
    Extract only the model-input feature columns from a fully-engineered DataFrame.

    Missing columns are filled with 0.
    """
    feature_names = get_feature_names(include_market=include_market)
    available = [f for f in feature_names if f in df.columns]
    missing = [f for f in feature_names if f not in df.columns]

    if missing:
        print(f"[features] Warning: {len(missing)} feature(s) missing — filling with 0: {missing}")

    X = df[available].copy()
    for col in missing:
        X[col] = 0.0

    return X[feature_names]  # Ensure consistent column order
