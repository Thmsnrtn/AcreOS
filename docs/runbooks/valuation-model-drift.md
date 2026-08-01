# Runbook: Valuation Model Drift Detected

**Severity:** P2 — Product Quality Impact
**Task Reference:** #325

---

## Symptoms
- Automated monitoring: model MAE (Mean Absolute Error) increases >15% from baseline
- Users report valuations "seem off" or "way too high/low" for a given county
- A/B comparison of model predictions vs. recent actual sale prices shows bias

---

## Detection

### Monitoring checks (run weekly)
```bash
# From admin panel: Analytics → Valuation Model → Performance Report
# Or check DB directly:
# SELECT county, avg(predicted_value), avg(actual_sale_price),
#        abs(avg(predicted_value) - avg(actual_sale_price)) / avg(actual_sale_price) AS mae
# FROM valuation_comparisons
# WHERE created_at > NOW() - INTERVAL '30 days'
# GROUP BY county
# ORDER BY mae DESC LIMIT 10;
```

### Alert thresholds:
- MAE > 15%: Warning
- MAE > 25%: Critical — model needs retraining
- Directional bias > 10% (always over or always under): Immediate investigation

---

## Root Causes

| Cause | Indicators |
|---|---|
| Market conditions changed (rate spike, demand shift) | Drift uniform across counties |
| Data pipeline broke (stale training data) | Drift concentrated in specific data source |
| Feature encoding changed | Sudden jump in error after a deploy |
| County-specific tax change or rezoning | Drift in specific counties only |
| Training data contamination | Error on outliers is unusually large |

---

## Retraining Procedure

### 1. Pull fresh training data
```bash
# Trigger county assessor ingest to get latest comp data
curl -X POST /api/jobs/county-assessor-ingest \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Wait for completion (check job logs)
fly logs -a acreos | grep "county-assessor" | tail -20
```

### 2. Retrain the model (manual)

There is no scheduled retrain job. The `valuationModelRetrain.ts` background job
was deleted 2026-08-01 (module orphan — never registered with any scheduler; the
`retrain()` invocation this runbook previously showed was an export that never
existed). Retraining is a manual run of the ML pipeline in `server/ml`:

```bash
fly ssh console -a acreos
cd /app/server/ml && python valuation_model.py train
# The final stdout line is a JSON result: version, mae, rmse, mape, r2,
# trainSamples, valSamples, testSamples, modelPath. Record it.
```

### 3. Evaluate the new model
```bash
# Compare new model vs. current on held-out test set
# Expected: MAE should be ≤ current model on test set
# Output is written to /app/model-evaluation-report.json
```

### 4. Promote new model (if evaluation passes)
```bash
# Model promotion is gated by evaluation score (manual since the retrain
# job's deletion): promote only if test-set MAE improves >2% vs. current
# production model (see server/ml/README.md); otherwise keep current model

# Manual promotion (if needed):
curl -X POST /api/jobs/valuation-model-promote \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"modelVersion": "v2.1.3"}'
```

### 5. Verify after promotion
```bash
# Sample 10 test valuations and compare to known prices
# If error is within acceptable range, deployment is complete
```

---

## Rollback

If new model makes things worse:
```bash
# Restore previous model version
curl -X POST /api/jobs/valuation-model-rollback \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"modelVersion": "previous"}'
```

---

## Customer Communication

If drift caused clearly wrong valuations delivered to customers:
1. Identify affected valuations (date range + county)
2. Send proactive notification: "We've updated our valuation model with improved accuracy"
3. Offer re-valuation at no charge for affected properties

---

## Prevention
- Run weekly backtesting job comparing model predictions to actual sales
- Alert when any county has MAE > 15% for >3 consecutive weeks
- Pin model version in deploys — never auto-promote without evaluation pass
