# AcreOS ML Pipeline

XGBoost-based land valuation and feature engineering pipeline for the AcreOS platform.

## Directory Structure

```
server/ml/
├── requirements.txt        Python dependencies
├── README.md               This file
├── preprocessing.py        Data cleaning and train/val/test split utilities
├── features.py             Feature engineering for property and market data
└── valuation_model.py      XGBoost LandValuationModel with SHAP explanations
```

## Setup

```bash
cd server/ml
pip install -r requirements.txt
```

## Usage

### Train a new model
```bash
python valuation_model.py train
python valuation_model.py train --samples 5000
```

### Evaluate an existing model
```bash
python valuation_model.py evaluate --model-path ./artifacts/valuation_v1.pkl
```

### Generate a prediction
```bash
python valuation_model.py predict --model-path ./artifacts/valuation_v1.pkl --input '{"sizeAcres":10,"state":"TX",...}'
```

The training script emits a JSON object on the final stdout line with keys:
`version`, `mae`, `rmse`, `mape`, `r2`, `trainSamples`, `valSamples`, `testSamples`, `modelPath`.
This output is parsed by the `valuationModelRetrain.ts` background job.

## Model Architecture

- **Algorithm**: XGBoost (gradient boosted trees)
- **Hyperparameter tuning**: Bayesian optimization via Optuna
- **Explainability**: SHAP TreeExplainer for per-prediction feature importance
- **Validation**: Stratified k-fold cross-validation by state + property type
- **Metrics**: MAE (primary), RMSE, MAPE, R²

## Feature Groups

| Group | Features |
|---|---|
| Location | distance_to_metro, flood_zone_risk, elevation |
| Property | size_acres, zoning, road_access, utilities, soil_quality |
| Market | county_avg_price_per_acre, median_dom, absorption_rate |
| Economic | county_median_income, population_density |

## Model Registry

Trained model artifacts are versioned and tracked in the `model_versions` database table.
The `valuationModelRetrain.ts` job automatically promotes a new model to production when
its test-set MAE improves by more than 2% relative to the current production model.
