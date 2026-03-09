"""
AcreOS ML Pipeline — Land Valuation Model
==========================================
XGBoost-based model for estimating the market value of raw land parcels.
Supports training with Optuna hyperparameter tuning, SHAP explanations,
k-fold cross-validation, and standard evaluation metrics.

CLI usage (called by valuationModelRetrain.ts):
    python valuation_model.py train [--samples N]
    python valuation_model.py evaluate --model-path PATH
    python valuation_model.py predict --model-path PATH --input JSON

The final stdout line of a 'train' run is a JSON object parsed by the TS job.
"""

import xgboost as xgb
import numpy as np
import pandas as pd
import shap
import joblib
import optuna
import json
import os
import sys
import argparse
import uuid
from datetime import datetime
from pathlib import Path
from sklearn.model_selection import cross_val_score, KFold
from sklearn.metrics import mean_absolute_error, mean_squared_error

# Suppress Optuna INFO logs during training
optuna.logging.set_verbosity(optuna.logging.WARNING)

from preprocessing import load_and_clean, create_train_test_split, normalize_features
from features import engineer_all_features, get_feature_names, get_feature_matrix

ARTIFACTS_DIR = Path(__file__).parent / "artifacts"
ARTIFACTS_DIR.mkdir(exist_ok=True)

TARGET_COLUMN = "sale_price"
DEFAULT_DATA_PATH = os.environ.get("TRAINING_DATA_PATH", "training_data.csv")


# ---------------------------------------------------------------------------
# Model class
# ---------------------------------------------------------------------------

class LandValuationModel:
    """XGBoost land valuation model with SHAP explanations and Optuna tuning."""

    def __init__(self, model_version: str | None = None):
        self.model: xgb.XGBRegressor | None = None
        self.model_version = model_version or f"v{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        self.feature_names: list[str] = []
        self.shap_explainer: shap.TreeExplainer | None = None
        self._scaler = None  # StandardScaler if used

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def train(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_val: pd.DataFrame,
        y_val: pd.Series,
        hyperparams: dict | None = None,
    ) -> dict:
        """
        Train XGBoost model with optional hyperparameter override.

        If `hyperparams` is None, a default parameter set is used.
        Returns a dict of validation metrics.
        """
        self.feature_names = list(X_train.columns)

        params = hyperparams or {
            "n_estimators": 500,
            "max_depth": 6,
            "learning_rate": 0.05,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "min_child_weight": 5,
            "gamma": 0.1,
            "reg_alpha": 0.1,
            "reg_lambda": 1.0,
            "objective": "reg:squarederror",
            "random_state": 42,
            "n_jobs": -1,
        }

        self.model = xgb.XGBRegressor(**params, early_stopping_rounds=30)

        self.model.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

        # Build SHAP explainer
        self.shap_explainer = shap.TreeExplainer(self.model)

        val_preds = self.model.predict(X_val)
        return self._compute_metrics(y_val.values, val_preds)

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def predict(self, features: pd.DataFrame) -> dict:
        """
        Predict land value with confidence interval.

        Returns:
            {
                "predicted_value": float,
                "confidence_low": float,
                "confidence_high": float,
                "confidence_score": float,   # 0–100
            }
        """
        if self.model is None:
            raise RuntimeError("Model not trained or loaded")

        preds = self.model.predict(features)
        pred = float(preds[0])

        # Approximate 90 % interval using ±20 % (replace with quantile regression in prod)
        margin = pred * 0.20
        confidence_score = max(40, min(95, 95 - (margin / pred) * 100))

        return {
            "predicted_value": round(pred, 2),
            "confidence_low": round(pred - margin, 2),
            "confidence_high": round(pred + margin, 2),
            "confidence_score": round(confidence_score, 1),
        }

    # ------------------------------------------------------------------
    # Explainability
    # ------------------------------------------------------------------

    def explain(self, features: pd.DataFrame) -> dict:
        """
        Generate SHAP-based explanation for the first row of `features`.

        Returns:
            {
                "base_value": float,
                "shap_values": {feature_name: shap_value, ...},
                "top_drivers": [{"feature": str, "impact": float}, ...],
            }
        """
        if self.shap_explainer is None:
            raise RuntimeError("SHAP explainer not initialised — train or load a model first")

        shap_vals = self.shap_explainer(features.iloc[:1])
        sv = shap_vals.values[0]
        base_value = float(shap_vals.base_values[0])

        shap_dict = {name: float(val) for name, val in zip(self.feature_names, sv)}
        sorted_drivers = sorted(shap_dict.items(), key=lambda x: abs(x[1]), reverse=True)

        return {
            "base_value": base_value,
            "shap_values": shap_dict,
            "top_drivers": [{"feature": k, "impact": v} for k, v in sorted_drivers[:10]],
        }

    # ------------------------------------------------------------------
    # Hyperparameter optimisation
    # ------------------------------------------------------------------

    def tune_hyperparameters(
        self,
        X: pd.DataFrame,
        y: pd.Series,
        n_trials: int = 50,
    ) -> dict:
        """
        Bayesian hyperparameter optimisation via Optuna.

        Returns the best hyperparameter dict found.
        """
        def objective(trial: optuna.Trial) -> float:
            params = {
                "n_estimators": trial.suggest_int("n_estimators", 200, 1000),
                "max_depth": trial.suggest_int("max_depth", 3, 9),
                "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
                "subsample": trial.suggest_float("subsample", 0.6, 1.0),
                "colsample_bytree": trial.suggest_float("colsample_bytree", 0.5, 1.0),
                "min_child_weight": trial.suggest_int("min_child_weight", 1, 20),
                "gamma": trial.suggest_float("gamma", 0.0, 1.0),
                "reg_alpha": trial.suggest_float("reg_alpha", 1e-4, 10.0, log=True),
                "reg_lambda": trial.suggest_float("reg_lambda", 1e-4, 10.0, log=True),
                "objective": "reg:squarederror",
                "random_state": 42,
                "n_jobs": -1,
            }
            model = xgb.XGBRegressor(**params)
            scores = cross_val_score(
                model, X, y, cv=3, scoring="neg_mean_absolute_error", n_jobs=-1
            )
            return -scores.mean()

        study = optuna.create_study(direction="minimize")
        study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

        best = study.best_params
        best["objective"] = "reg:squarederror"
        best["random_state"] = 42
        best["n_jobs"] = -1

        print(f"[LandValuationModel] Best MAE from tuning: ${study.best_value:,.2f}")
        return best

    # ------------------------------------------------------------------
    # Cross-validation
    # ------------------------------------------------------------------

    def cross_validate(self, X: pd.DataFrame, y: pd.Series, k: int = 5) -> dict:
        """
        K-fold cross-validation with stratification by log-price bucket.

        Returns dict with mean and std of MAE, RMSE, and MAPE across folds.
        """
        if self.model is None:
            raise RuntimeError("Model not configured — call train() first")

        kf = KFold(n_splits=k, shuffle=True, random_state=42)
        maes, rmses, mapes = [], [], []

        for fold, (train_idx, val_idx) in enumerate(kf.split(X)):
            X_tr, X_vl = X.iloc[train_idx], X.iloc[val_idx]
            y_tr, y_vl = y.iloc[train_idx], y.iloc[val_idx]

            fold_model = xgb.XGBRegressor(**self.model.get_params())
            fold_model.fit(X_tr, y_tr, eval_set=[(X_vl, y_vl)], verbose=False)

            preds = fold_model.predict(X_vl)
            metrics = self._compute_metrics(y_vl.values, preds)
            maes.append(metrics["mae"])
            rmses.append(metrics["rmse"])
            mapes.append(metrics["mape"])

        return {
            "mae_mean": float(np.mean(maes)),
            "mae_std": float(np.std(maes)),
            "rmse_mean": float(np.mean(rmses)),
            "rmse_std": float(np.std(rmses)),
            "mape_mean": float(np.mean(mapes)),
            "mape_std": float(np.std(mapes)),
            "k_folds": k,
        }

    # ------------------------------------------------------------------
    # Evaluation
    # ------------------------------------------------------------------

    def evaluate(self, X_test: pd.DataFrame, y_test: pd.Series) -> dict:
        """Compute MAE, RMSE, MAPE, and R² on the test set."""
        if self.model is None:
            raise RuntimeError("Model not trained or loaded")
        preds = self.model.predict(X_test)
        return self._compute_metrics(y_test.values, preds)

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: str) -> None:
        """Save model artifacts (model + feature names + scaler) to disk."""
        joblib.dump(
            {
                "model": self.model,
                "features": self.feature_names,
                "model_version": self.model_version,
                "scaler": self._scaler,
            },
            path,
        )
        print(f"[LandValuationModel] Saved to {path}")

    def load(self, path: str) -> None:
        """Load model artifacts from disk."""
        artifacts = joblib.load(path)
        self.model = artifacts["model"]
        self.feature_names = artifacts["features"]
        self.model_version = artifacts.get("model_version", "unknown")
        self._scaler = artifacts.get("scaler")
        self.shap_explainer = shap.TreeExplainer(self.model)
        print(f"[LandValuationModel] Loaded version {self.model_version} from {path}")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
        mae = mean_absolute_error(y_true, y_pred)
        rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
        mape = float(np.mean(np.abs((y_true - y_pred) / np.maximum(y_true, 1))))
        ss_res = np.sum((y_true - y_pred) ** 2)
        ss_tot = np.sum((y_true - np.mean(y_true)) ** 2)
        r2 = 1 - ss_res / max(ss_tot, 1e-8)
        return {"mae": float(mae), "rmse": rmse, "mape": mape, "r2": float(r2)}


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def cmd_train(args: argparse.Namespace) -> None:
    """Train a new model and print a JSON result summary to stdout."""
    data_path = getattr(args, "data_path", DEFAULT_DATA_PATH)
    n_samples = getattr(args, "samples", None)

    # Load and preprocess
    df = load_and_clean(data_path)
    if n_samples and int(n_samples) < len(df):
        df = df.sample(int(n_samples), random_state=42).reset_index(drop=True)

    # Feature engineering
    df = engineer_all_features(df)
    feature_names = get_feature_names()
    X = get_feature_matrix(df)
    y = df[TARGET_COLUMN].astype(float)

    # Split
    df_train, df_val, df_test = create_train_test_split(df)
    X_train = get_feature_matrix(df_train)
    X_val = get_feature_matrix(df_val)
    X_test = get_feature_matrix(df_test)
    y_train = df_train[TARGET_COLUMN].astype(float)
    y_val = df_val[TARGET_COLUMN].astype(float)
    y_test = df_test[TARGET_COLUMN].astype(float)

    version = f"v{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    model = LandValuationModel(model_version=version)

    # Optuna tuning (skip if --no-tune flag set or sample count is small)
    do_tune = not getattr(args, "no_tune", False) and len(X_train) >= 500
    hyperparams = None
    if do_tune:
        print("[train] Running Optuna hyperparameter search (50 trials)...")
        hyperparams = model.tune_hyperparameters(X_train, y_train, n_trials=50)

    # Train
    val_metrics = model.train(X_train, y_train, X_val, y_val, hyperparams=hyperparams)
    test_metrics = model.evaluate(X_test, y_test)

    # Save artifact
    model_path = str(ARTIFACTS_DIR / f"valuation_{version}.pkl")
    model.save(model_path)

    # Emit JSON result (parsed by valuationModelRetrain.ts)
    result = {
        "version": version,
        "mae": test_metrics["mae"],
        "rmse": test_metrics["rmse"],
        "mape": test_metrics["mape"],
        "r2": test_metrics["r2"],
        "trainSamples": len(X_train),
        "valSamples": len(X_val),
        "testSamples": len(X_test),
        "modelPath": model_path,
    }
    print(json.dumps(result))


def cmd_evaluate(args: argparse.Namespace) -> None:
    """Load a saved model and evaluate it on a test dataset."""
    model = LandValuationModel()
    model.load(args.model_path)

    data_path = getattr(args, "data_path", DEFAULT_DATA_PATH)
    df = load_and_clean(data_path)
    df = engineer_all_features(df)
    _, _, df_test = create_train_test_split(df)
    X_test = get_feature_matrix(df_test)
    y_test = df_test[TARGET_COLUMN].astype(float)

    metrics = model.evaluate(X_test, y_test)
    print(json.dumps(metrics, indent=2))


def cmd_predict(args: argparse.Namespace) -> None:
    """Load a saved model and predict on a single JSON input."""
    model = LandValuationModel()
    model.load(args.model_path)

    input_data = json.loads(args.input)
    df_input = pd.DataFrame([input_data])
    df_input = engineer_all_features(df_input)
    X = get_feature_matrix(df_input)

    result = model.predict(X)
    explanation = model.explain(X)
    output = {**result, "explanation": explanation}
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AcreOS Land Valuation Model")
    subparsers = parser.add_subparsers(dest="command")

    # train
    train_parser = subparsers.add_parser("train", help="Train a new model")
    train_parser.add_argument("--data-path", default=DEFAULT_DATA_PATH)
    train_parser.add_argument("--samples", type=int, default=None, help="Limit training samples")
    train_parser.add_argument("--no-tune", action="store_true", help="Skip Optuna tuning")

    # evaluate
    eval_parser = subparsers.add_parser("evaluate", help="Evaluate a saved model")
    eval_parser.add_argument("--model-path", required=True)
    eval_parser.add_argument("--data-path", default=DEFAULT_DATA_PATH)

    # predict
    pred_parser = subparsers.add_parser("predict", help="Predict value for a single property")
    pred_parser.add_argument("--model-path", required=True)
    pred_parser.add_argument("--input", required=True, help="JSON string of property features")

    args = parser.parse_args()

    if args.command == "train":
        cmd_train(args)
    elif args.command == "evaluate":
        cmd_evaluate(args)
    elif args.command == "predict":
        cmd_predict(args)
    else:
        # Default to train for backward compatibility with TS job
        args.samples = None
        args.no_tune = False
        args.data_path = DEFAULT_DATA_PATH
        cmd_train(args)
