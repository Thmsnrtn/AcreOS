/**
 * Gradient Boosted Decision Trees — pure TypeScript implementation.
 *
 * Used by the AcreOS valuation model to predict land prices from
 * tabular property features without external ML dependencies.
 *
 * Algorithm: Friedman's gradient boosting with regression trees (GBRT).
 *   - Loss function: mean squared error (MSE)
 *   - Weak learner: CART regression tree (depth-limited)
 *   - Shrinkage: configurable learning rate
 *   - Subsampling: row sampling per tree (stochastic GBM)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeatureVector = number[];

export interface GBMConfig {
  nEstimators?: number;       // number of trees (default 100)
  maxDepth?: number;          // max tree depth (default 4)
  learningRate?: number;      // shrinkage factor (default 0.1)
  subsample?: number;         // row sample fraction per tree (default 0.8)
  minSamplesLeaf?: number;    // min samples per leaf (default 5)
  minImpurityDecrease?: number; // min gain to split (default 0.0)
}

interface TreeNode {
  isLeaf: boolean;
  value?: number;             // leaf: mean residual
  featureIdx?: number;        // split feature
  threshold?: number;         // split threshold
  left?: TreeNode;
  right?: TreeNode;
}

interface FittedTree {
  root: TreeNode;
}

// ---------------------------------------------------------------------------
// Regression tree (CART — squared error criterion)
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function mse(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
}

function bestSplit(
  X: FeatureVector[],
  y: number[],
  minSamplesLeaf: number,
  minImpurityDecrease: number
): { featureIdx: number; threshold: number; gain: number } | null {
  const n = X.length;
  const nFeatures = X[0].length;
  const parentMSE = mse(y);

  let bestGain = minImpurityDecrease;
  let bestFeature = -1;
  let bestThreshold = 0;

  for (let f = 0; f < nFeatures; f++) {
    // Collect unique thresholds for this feature
    const seen = new Set<number>();
    const values: number[] = [];
    for (const row of X) {
      if (!seen.has(row[f])) { seen.add(row[f]); values.push(row[f]); }
    }
    values.sort((a, b) => a - b);

    for (let ti = 0; ti < values.length - 1; ti++) {
      const threshold = (values[ti] + values[ti + 1]) / 2;

      const leftIdx: number[] = [];
      const rightIdx: number[] = [];
      for (let i = 0; i < n; i++) {
        if (X[i][f] <= threshold) leftIdx.push(i);
        else rightIdx.push(i);
      }

      if (leftIdx.length < minSamplesLeaf || rightIdx.length < minSamplesLeaf) continue;

      const leftY = leftIdx.map((i) => y[i]);
      const rightY = rightIdx.map((i) => y[i]);

      const gain =
        parentMSE -
        (leftY.length / n) * mse(leftY) -
        (rightY.length / n) * mse(rightY);

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = threshold;
      }
    }
  }

  if (bestFeature === -1) return null;
  return { featureIdx: bestFeature, threshold: bestThreshold, gain: bestGain };
}

function buildTree(
  X: FeatureVector[],
  y: number[],
  depth: number,
  maxDepth: number,
  minSamplesLeaf: number,
  minImpurityDecrease: number
): TreeNode {
  if (depth >= maxDepth || y.length <= minSamplesLeaf * 2) {
    return { isLeaf: true, value: mean(y) };
  }

  const split = bestSplit(X, y, minSamplesLeaf, minImpurityDecrease);
  if (!split) return { isLeaf: true, value: mean(y) };

  const leftMask = X.map((row) => row[split.featureIdx] <= split.threshold);
  const leftX = X.filter((_, i) => leftMask[i]);
  const leftY = y.filter((_, i) => leftMask[i]);
  const rightX = X.filter((_, i) => !leftMask[i]);
  const rightY = y.filter((_, i) => !leftMask[i]);

  return {
    isLeaf: false,
    featureIdx: split.featureIdx,
    threshold: split.threshold,
    left: buildTree(leftX, leftY, depth + 1, maxDepth, minSamplesLeaf, minImpurityDecrease),
    right: buildTree(rightX, rightY, depth + 1, maxDepth, minSamplesLeaf, minImpurityDecrease),
  };
}

function predictTree(node: TreeNode, x: FeatureVector): number {
  if (node.isLeaf) return node.value!;
  return x[node.featureIdx!] <= node.threshold!
    ? predictTree(node.left!, x)
    : predictTree(node.right!, x);
}

// ---------------------------------------------------------------------------
// Gradient Boosting Machine
// ---------------------------------------------------------------------------

export class GradientBoostingRegressor {
  private config: Required<GBMConfig>;
  private trees: FittedTree[] = [];
  private basePrediction = 0;
  private featureImportances: number[] = [];
  private trained = false;

  constructor(config: GBMConfig = {}) {
    this.config = {
      nEstimators: config.nEstimators ?? 100,
      maxDepth: config.maxDepth ?? 4,
      learningRate: config.learningRate ?? 0.1,
      subsample: config.subsample ?? 0.8,
      minSamplesLeaf: config.minSamplesLeaf ?? 5,
      minImpurityDecrease: config.minImpurityDecrease ?? 0.0,
    };
  }

  /** Fit the model on training data */
  fit(X: FeatureVector[], y: number[]): void {
    const n = X.length;
    const nFeatures = X[0]?.length ?? 0;

    // Initialise: predict mean of targets
    this.basePrediction = mean(y);
    this.featureImportances = new Array(nFeatures).fill(0);

    let residuals = y.map((yi) => yi - this.basePrediction);

    for (let t = 0; t < this.config.nEstimators; t++) {
      // Row subsampling
      const sampleSize = Math.max(1, Math.round(n * this.config.subsample));
      const indices = shuffleSample(n, sampleSize);
      const Xsub = indices.map((i) => X[i]);
      const rsub = indices.map((i) => residuals[i]);

      // Fit regression tree on residuals (negative gradient of MSE)
      const root = buildTree(
        Xsub,
        rsub,
        0,
        this.config.maxDepth,
        this.config.minSamplesLeaf,
        this.config.minImpurityDecrease
      );

      this.trees.push({ root });
      accumulateImportance(root, this.featureImportances);

      // Update residuals for all training samples
      residuals = residuals.map((r, i) => {
        const treePred = predictTree(root, X[i]);
        return r - this.config.learningRate * treePred;
      });
    }

    // Normalise feature importances
    const totalImp = this.featureImportances.reduce((s, v) => s + v, 0);
    if (totalImp > 0) {
      this.featureImportances = this.featureImportances.map((v) => v / totalImp);
    }

    this.trained = true;
  }

  /** Predict for a single sample */
  predict(x: FeatureVector): number {
    if (!this.trained) throw new Error('Model not trained');
    let pred = this.basePrediction;
    for (const tree of this.trees) {
      pred += this.config.learningRate * predictTree(tree.root, x);
    }
    return pred;
  }

  /** Predict for multiple samples */
  predictBatch(X: FeatureVector[]): number[] {
    return X.map((x) => this.predict(x));
  }

  /** Evaluate on a held-out set — returns MAE and RMSE */
  evaluate(X: FeatureVector[], y: number[]): { mae: number; rmse: number; r2: number } {
    const preds = this.predictBatch(X);
    const errors = preds.map((p, i) => p - y[i]);
    const mae = mean(errors.map(Math.abs));
    const rmse = Math.sqrt(mean(errors.map((e) => e ** 2)));
    const yMean = mean(y);
    const ssTot = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0);
    const ssRes = errors.reduce((s, e) => s + e ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    return { mae, rmse, r2 };
  }

  /** Feature importance scores (sum to 1.0) */
  getFeatureImportances(): number[] {
    return [...this.featureImportances];
  }

  /** Serialise model to a plain object for storage */
  toJSON(): object {
    return {
      basePrediction: this.basePrediction,
      learningRate: this.config.learningRate,
      trees: this.trees.map((t) => ({ root: t.root })),
      featureImportances: this.featureImportances,
    };
  }

  /** Restore a model from a serialised object */
  static fromJSON(data: any): GradientBoostingRegressor {
    const model = new GradientBoostingRegressor({ learningRate: data.learningRate });
    model.basePrediction = data.basePrediction;
    model.trees = data.trees as FittedTree[];
    model.featureImportances = data.featureImportances ?? [];
    model.trained = true;
    return model;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fisher-Yates sample of `size` indices from [0, n) */
function shuffleSample(n: number, size: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, size);
}

/** Recursively accumulate split-gain proxy as feature importance */
function accumulateImportance(node: TreeNode, importances: number[]): void {
  if (node.isLeaf) return;
  importances[node.featureIdx!] = (importances[node.featureIdx!] ?? 0) + 1;
  accumulateImportance(node.left!, importances);
  accumulateImportance(node.right!, importances);
}

// ---------------------------------------------------------------------------
// Land Valuation Feature Engineering
// ---------------------------------------------------------------------------

/**
 * Feature names used by the AcreOS land valuation GBM model.
 * Order must match the vector produced by `extractLandFeatures`.
 */
export const LAND_FEATURE_NAMES = [
  'acres',
  'price_per_acre_comps',
  'days_on_market',
  'distance_to_highway_miles',
  'distance_to_city_miles',
  'has_water_access',
  'has_road_frontage',
  'zoning_score',           // 0=restricted … 3=commercial
  'soil_quality_score',     // 0-10
  'flood_zone_risk',        // 0=none, 1=partial, 2=high
  'market_trend_score',     // -1=declining, 0=stable, 1=growing
  'county_median_income_k', // thousands of USD
  'population_growth_pct',
];

export interface LandFeatureInput {
  acres: number;
  pricePerAcreComps: number;
  daysOnMarket: number;
  distanceToHighwayMiles: number;
  distanceToCityMiles: number;
  hasWaterAccess: boolean;
  hasRoadFrontage: boolean;
  zoningScore: number;
  soilQualityScore: number;
  floodZoneRisk: number;
  marketTrendScore: number;
  countyMedianIncomeK: number;
  populationGrowthPct: number;
}

export function extractLandFeatures(input: LandFeatureInput): FeatureVector {
  return [
    input.acres,
    input.pricePerAcreComps,
    input.daysOnMarket,
    input.distanceToHighwayMiles,
    input.distanceToCityMiles,
    input.hasWaterAccess ? 1 : 0,
    input.hasRoadFrontage ? 1 : 0,
    input.zoningScore,
    input.soilQualityScore,
    input.floodZoneRisk,
    input.marketTrendScore,
    input.countyMedianIncomeK,
    input.populationGrowthPct,
  ];
}
