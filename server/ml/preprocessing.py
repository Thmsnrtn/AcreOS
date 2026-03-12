"""
AcreOS ML Pipeline — Data Preprocessing
========================================
Cleans raw transaction data, removes outliers, handles missing values,
and creates stratified train / validation / test splits.
"""

import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from typing import Tuple, Dict, Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Columns expected in the raw transaction export from the DB
REQUIRED_COLUMNS = [
    "state", "county", "property_type", "size_acres", "sale_price", "price_per_acre"
]

NUMERIC_COLUMNS = [
    "size_acres", "sale_price", "price_per_acre",
    "county_median_income", "population_density", "distance_to_metro",
]

CATEGORICAL_COLUMNS = [
    "state", "county", "property_type", "zoning", "flood_zone", "soil_quality",
    "data_quality",
]

BOOLEAN_COLUMNS = [
    "has_road_access", "has_utilities", "has_water", "has_wetlands",
]

# Reasonable bounds for raw land in the US
PRICE_MIN = 500
PRICE_MAX = 50_000_000
ACRES_MIN = 0.1
ACRES_MAX = 100_000
PRICE_PER_ACRE_MIN = 50
PRICE_PER_ACRE_MAX = 500_000


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def load_and_clean(data_path: str) -> pd.DataFrame:
    """
    Load raw transaction data from a CSV or JSON file and clean it.

    Steps:
    1. Load file (CSV or JSON based on extension).
    2. Validate required columns exist.
    3. Cast column types.
    4. Remove records with null required fields.
    5. Apply value-range filters (price, acreage).
    6. Remove statistical outliers using IQR on price_per_acre.
    7. Fill reasonable defaults for optional fields.

    Returns a clean DataFrame ready for feature engineering.
    """
    # Load
    if data_path.endswith(".json"):
        df = pd.read_json(data_path, orient="records")
    else:
        df = pd.read_csv(data_path)

    # Normalise column names to snake_case
    df.columns = df.columns.str.lower().str.replace(" ", "_").str.replace("-", "_")

    # Validate required columns
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    # Cast numeric columns
    for col in NUMERIC_COLUMNS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Cast boolean columns
    for col in BOOLEAN_COLUMNS:
        if col in df.columns:
            df[col] = df[col].fillna(False).astype(bool)

    # Drop rows with nulls in required fields
    df = df.dropna(subset=["size_acres", "sale_price", "price_per_acre", "state", "county"])

    # Value-range filters
    df = df[
        (df["sale_price"] >= PRICE_MIN) & (df["sale_price"] <= PRICE_MAX) &
        (df["size_acres"] >= ACRES_MIN) & (df["size_acres"] <= ACRES_MAX) &
        (df["price_per_acre"] >= PRICE_PER_ACRE_MIN) & (df["price_per_acre"] <= PRICE_PER_ACRE_MAX)
    ]

    # Remove flagged outliers from the DB
    if "is_outlier" in df.columns:
        df = df[~df["is_outlier"].astype(bool)]

    # IQR-based outlier removal on price_per_acre (per state)
    df = _remove_iqr_outliers(df, "price_per_acre", group_by="state", k=3.0)

    # Fill defaults for optional numeric columns
    for col in ["county_median_income", "population_density", "distance_to_metro"]:
        if col in df.columns:
            df[col] = df[col].fillna(df[col].median())

    # Fill categorical defaults
    for col in ["zoning", "flood_zone", "soil_quality"]:
        if col in df.columns:
            df[col] = df[col].fillna("unknown")

    df = df.reset_index(drop=True)
    print(f"[preprocessing] Loaded {len(df)} clean records from {data_path}")
    return df


def create_train_test_split(
    df: pd.DataFrame,
    test_size: float = 0.2,
    val_size: float = 0.1,
    random_state: int = 42,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Create stratified train / validation / test splits.

    Stratification key is 'state' to ensure geographic representation across splits.
    Validation set is carved from the training set after the initial test split.

    Returns (df_train, df_val, df_test).
    """
    stratify_col = df["state"] if df["state"].value_counts().min() >= 2 else None

    df_trainval, df_test = train_test_split(
        df,
        test_size=test_size,
        stratify=stratify_col,
        random_state=random_state,
    )

    val_fraction_of_trainval = val_size / (1.0 - test_size)
    stratify_trainval = df_trainval["state"] if stratify_col is not None else None

    df_train, df_val = train_test_split(
        df_trainval,
        test_size=val_fraction_of_trainval,
        stratify=stratify_trainval,
        random_state=random_state,
    )

    print(
        f"[preprocessing] Split sizes — train: {len(df_train)}, val: {len(df_val)}, test: {len(df_test)}"
    )
    return df_train, df_val, df_test


def normalize_features(
    X_train: pd.DataFrame,
    X_val: pd.DataFrame,
    X_test: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, StandardScaler]:
    """
    Fit a StandardScaler on the training set and apply it to val / test sets.

    Only numeric columns are scaled; categorical columns are left unchanged.
    Returns (X_train_scaled, X_val_scaled, X_test_scaled, fitted_scaler).
    """
    numeric_cols = X_train.select_dtypes(include=[np.number]).columns.tolist()

    scaler = StandardScaler()
    X_train = X_train.copy()
    X_val = X_val.copy()
    X_test = X_test.copy()

    X_train[numeric_cols] = scaler.fit_transform(X_train[numeric_cols])
    X_val[numeric_cols] = scaler.transform(X_val[numeric_cols])
    X_test[numeric_cols] = scaler.transform(X_test[numeric_cols])

    return X_train, X_val, X_test, scaler


def encode_categoricals(
    df_train: pd.DataFrame,
    df_val: pd.DataFrame,
    df_test: pd.DataFrame,
    categorical_cols: list | None = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, Dict[str, LabelEncoder]]:
    """
    Fit LabelEncoders on training data and apply to val / test.

    Unknown categories in val / test are mapped to -1 (safe for tree models).
    Returns (df_train_enc, df_val_enc, df_test_enc, encoders_dict).
    """
    if categorical_cols is None:
        categorical_cols = [c for c in CATEGORICAL_COLUMNS if c in df_train.columns]

    encoders: Dict[str, LabelEncoder] = {}

    for col in categorical_cols:
        le = LabelEncoder()
        df_train = df_train.copy()
        df_val = df_val.copy()
        df_test = df_test.copy()

        df_train[col] = le.fit_transform(df_train[col].astype(str))

        # Handle unseen categories gracefully
        known = set(le.classes_)
        df_val[col] = df_val[col].astype(str).apply(
            lambda x: le.transform([x])[0] if x in known else -1
        )
        df_test[col] = df_test[col].astype(str).apply(
            lambda x: le.transform([x])[0] if x in known else -1
        )

        encoders[col] = le

    return df_train, df_val, df_test, encoders


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _remove_iqr_outliers(
    df: pd.DataFrame,
    column: str,
    group_by: str | None = None,
    k: float = 3.0,
) -> pd.DataFrame:
    """Remove rows where `column` is outside [Q1 - k*IQR, Q3 + k*IQR]."""
    if group_by and group_by in df.columns:
        mask = pd.Series(True, index=df.index)
        for _, group in df.groupby(group_by):
            q1 = group[column].quantile(0.25)
            q3 = group[column].quantile(0.75)
            iqr = q3 - q1
            lower = q1 - k * iqr
            upper = q3 + k * iqr
            out_mask = (group[column] < lower) | (group[column] > upper)
            mask[out_mask.index[out_mask]] = False
        return df[mask]
    else:
        q1 = df[column].quantile(0.25)
        q3 = df[column].quantile(0.75)
        iqr = q3 - q1
        return df[(df[column] >= q1 - k * iqr) & (df[column] <= q3 + k * iqr)]
