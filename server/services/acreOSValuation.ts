import { db } from '../db';
import {
  transactionTraining,
  valuationPredictions,
  properties,
} from '../../shared/schema';
import { eq, and, desc, gte, sql, between } from 'drizzle-orm';
import { GradientBoostingRegressor, extractLandFeatures, LAND_FEATURE_NAMES, type LandFeatureInput } from './gradientBoosting';
import { requireOpenAIClient } from "../utils/openaiClient";
import { logger } from "../utils/logger";
import { addMonths } from "../utils/dateUtils";
import { assertFeeSimpleOrThrow } from "../utils/landStatus";

// ---------------------------------------------------------------------------
// Singleton GBM model — loaded once, reused per request.
// Falls back to null when no serialised model is available yet.
// ---------------------------------------------------------------------------
let _gbmModel: GradientBoostingRegressor | null = null;

/** Attempt to load a persisted GBM model from the environment or file system. */
async function loadGBMModel(): Promise<GradientBoostingRegressor | null> {
  if (_gbmModel) return _gbmModel;
  try {
    const modelJson = process.env.GBM_MODEL_JSON;
    if (modelJson) {
      _gbmModel = GradientBoostingRegressor.fromJSON(JSON.parse(modelJson));
      logger.info('[AcreOSValuation] GBM model loaded from GBM_MODEL_JSON env var');
      return _gbmModel;
    }
    // Optionally load from disk (e.g. mounted volume in production)
    const fs = await import('fs/promises');
    const path = await import('path');
    const modelPath = path.resolve(process.cwd(), 'server/ml/artifacts/gbm_valuation.json');
    const raw = await fs.readFile(modelPath, 'utf8');
    _gbmModel = GradientBoostingRegressor.fromJSON(JSON.parse(raw));
    logger.info('[AcreOSValuation] GBM model loaded from disk', { metadata: { detail: modelPath } });
    return _gbmModel;
  } catch {
    return null; // No trained model available yet — fall through to AI/baseline
  }
}

/**
 * Produce a fast GBM price-per-acre estimate from property characteristics.
 *
 * Returns null when no trained model is available, OR when there is no
 * comparable price signal to give it. Both are refusals, and the caller must
 * treat them as such — this feeds a billable customer valuation.
 */
async function gbmEstimatePricePerAcre(
  acres: number,
  /** null when no comparable sales are on file. The model declines rather
   *  than substituting a national baseline — see the refusal below. */
  compsMedianPricePerAcre: number | null,
  characteristics: {
    zoning?: string;
    waterRights?: boolean;
    roadAccess?: string;
    floodZone?: string;
  },
  marketConditions: {
    populationGrowth?: number;
    localUnemploymentRate?: number;
  }
): Promise<{ pricePerAcre: number; confidence: number; assumedFeatures: string[] } | null> {
  const model = await loadGBMModel();
  if (!model) return null;

  const zoningScore = characteristics.zoning?.toLowerCase().includes('commercial') ? 3
    : characteristics.zoning?.toLowerCase().includes('ag') ? 1
    : characteristics.zoning?.toLowerCase().includes('residential') ? 2
    : 1;

  const floodRisk = characteristics.floodZone?.toLowerCase().includes('high') ? 2
    : characteristics.floodZone?.toLowerCase().includes('partial') ? 1
    : 0;

  // REFUSE without a comparable price signal.
  //
  // This line was `pricePerAcreComps: compsMedianPricePerAcre || 1000,
  // // National median vacant land baseline when no comps available` — and the
  // only caller passes 0, so the `||` fired on EVERY call. W3.1 had already
  // removed the outer `= 1000` seed from `generateValuation` with the note
  // "every parcel in America 'was worth' $1,000/acre the moment both real
  // paths failed — branded as a proprietary model". That fix deleted the
  // visible constant and left this one, one level down, in the model's own
  // feature vector: the same number, reached the same way, on the same
  // billable surface.
  //
  // The feature is not incidental. It is price-per-acre — the model's target
  // variable in input form. Handing it a national constant makes the
  // prediction largely a function of that constant, and the result is returned
  // to a paying customer as `gbm_model`.
  if (compsMedianPricePerAcre === null || !Number.isFinite(compsMedianPricePerAcre) || compsMedianPricePerAcre <= 0) {
    logger.info('[AcreOSValuation] GBM declined: no comparable price signal', {
      metadata: { acres },
    });
    return null;
  }

  /**
   * Features this call does NOT measure. They are still passed — a trained
   * model needs a full vector — but they are counted, and the count discounts
   * the confidence below. Silently defaulting six of thirteen features and
   * then reporting the model's own headline confidence is how a mostly-assumed
   * prediction came to look like a measured one.
   */
  const assumed = [
    'days_on_market',
    'distance_to_highway_miles',
    'distance_to_city_miles',
    'soil_quality_score',
    'county_median_income_k',
    ...(marketConditions.populationGrowth === undefined ? ['population_growth_pct', 'market_trend_score'] : []),
  ];

  const input: LandFeatureInput = {
    acres,
    pricePerAcreComps: compsMedianPricePerAcre,
    daysOnMarket: 0,
    distanceToHighwayMiles: 5,   // assumed — enriched post-GIS lookup
    distanceToCityMiles: 20,     // assumed
    hasWaterAccess: characteristics.waterRights ?? false,
    hasRoadFrontage: characteristics.roadAccess === 'paved' || characteristics.roadAccess === 'gravel',
    zoningScore,
    soilQualityScore: 5,         // assumed; enriched by featureEngineeringJob
    floodZoneRisk: floodRisk,
    marketTrendScore: (marketConditions.populationGrowth ?? 0) > 1 ? 1 : 0,
    countyMedianIncomeK: 55,     // assumed — national median
    populationGrowthPct: marketConditions.populationGrowth ?? 0,
  };

  const features = extractLandFeatures(input);
  const predictedValue = model.predict(features);
  const importances = model.getFeatureImportances();

  // Confidence must depend on THIS prediction's inputs, not only on the model.
  // `topImportance` is a property of the trained model, so the old expression
  // returned the SAME confidence for every parcel a given model ever scored —
  // a confidence that cannot vary with the input is not a confidence.
  const topImportance = Math.max(...importances);
  const modelConfidence = Math.min(85, Math.round(50 + topImportance * 200));
  const measuredShare = (LAND_FEATURE_NAMES.length - assumed.length) / LAND_FEATURE_NAMES.length;
  const confidence = Math.round(modelConfidence * measuredShare);

  return {
    pricePerAcre: Math.max(100, Math.round(predictedValue)),
    confidence,
    assumedFeatures: assumed,
  };
}

interface TransactionDataPoint {
  propertyId: string;
  salePrice: number;
  saleDate: Date;
  acres: number;
  pricePerAcre: number;
  location: {
    state: string;
    county: string;
    zipCode: string;
    latitude: number;
    longitude: number;
  };
  characteristics: {
    zoning?: string;
    waterRights?: boolean;
    utilities?: string[];
    roadAccess?: string;
    topography?: string;
    soilType?: string;
    floodZone?: string;
  };
  marketConditions: {
    quarterlyInterestRate: number;
    localUnemploymentRate: number;
    populationGrowth: number;
    nearbyDevelopment: boolean;
  };
}

interface ValuationRequest {
  propertyId: string;
  acres: number;
  location: {
    state: string;
    county: string;
    zipCode: string;
    latitude: number;
    longitude: number;
  };
  characteristics: {
    zoning?: string;
    waterRights?: boolean;
    utilities?: string[];
    roadAccess?: string;
    topography?: string;
    soilType?: string;
    floodZone?: string;
  };
}

interface ValuationResult {
  /**
   * W3.1 (refuse-not-fabricate): "ok" means a value was actually modeled
   * from data (comps, trained model, or a labeled AI estimate).
   * "insufficient_data" is an HONEST refusal — no comps, no trained model,
   * no AI path — with `missing` naming exactly what's absent. The old
   * behavior (flat $1,000/acre branded as a proprietary model) fabricated
   * a number an investor might have bid real money on.
   */
  status: "ok" | "insufficient_data";
  /**
   * What actually produced the number, for honest labeling downstream:
   * comps_model (comps + adjustments), trained_model (GBM), ai_estimate
   * (LLM guess — must render as an AI estimate, never as a modeled value),
   * attom_avm (ATTOM's residential AVM via the residentialComps seam —
   * wave V3; must render as ATTOM's estimate, never as the AcreOS land model).
   */
  classification: "comps_model" | "trained_model" | "ai_estimate" | "attom_avm" | "insufficient_data";
  estimatedValue: number;
  pricePerAcre: number;
  confidenceInterval: {
    low: number;
    high: number;
  };
  confidence: number; // 0-100
  methodology: string;
  /** Present on insufficient_data — what would unlock a real valuation. */
  missing?: string[];
  comparables: {
    propertyId: string;
    salePrice: number;
    pricePerAcre: number;
    distance: number; // miles
    similarity: number; // 0-100
  }[];
  marketAdjustments: {
    factor: string;
    adjustment: number; // percentage
  }[];
}

class AcreOSValuationModel {
  /**
   * Record transaction for training data
   */
  async recordTransactionForTraining(
    _organizationId: string,
    transactionData: TransactionDataPoint,
    // On-platform CLOSED deals are arm's-length ground truth — the richest,
    // most-trusted training signal. Callers with that provenance can override
    // the heuristic quality score (which can't reach "high" without market
    // context a deal-close event doesn't carry) so those rows feed the retrain.
    dataQualityOverride?: "high" | "medium" | "low",
  ): Promise<string> {
    try {
      // transaction_training is intentionally anonymized — no organizationId,
      // no propertyId, no nested location/characteristics objects. Map the
      // incoming TransactionDataPoint onto the flat, anonymized columns.
      const qualityScore = this.assessDataQuality(transactionData);
      const dataQuality = dataQualityOverride
        ?? (qualityScore >= 75 ? "high" : qualityScore >= 50 ? "medium" : "low");
      // transaction_hash is a required unique key; derive a stable hash from
      // the anonymized fields so re-imports dedupe deterministically.
      const transactionHash = `${transactionData.location.state}|${transactionData.location.county}|${transactionData.acres}|${transactionData.salePrice}|${transactionData.saleDate.toISOString()}`;
      const [record] = await db.insert(transactionTraining).values({
        transactionHash,
        state: transactionData.location.state,
        county: transactionData.location.county,
        propertyType: "land",
        salePrice: String(transactionData.salePrice),
        saleDate: transactionData.saleDate,
        sizeAcres: String(transactionData.acres),
        pricePerAcre: String(transactionData.pricePerAcre),
        zoning: transactionData.characteristics.zoning,
        floodZone: transactionData.characteristics.floodZone,
        hasRoadAccess: transactionData.characteristics.roadAccess
          ? transactionData.characteristics.roadAccess !== "none"
          : undefined,
        hasWater: transactionData.characteristics.waterRights,
        dataQuality,
      }).returning();

      return String(record.id);
    } catch (error) {
      logger.error('Failed to record transaction for training', error);
      throw error;
    }
  }

  /**
   * Assess quality of transaction data (for ML model confidence)
   */
  private assessDataQuality(data: TransactionDataPoint): number {
    let quality = 0;

    // Basic fields (40 points)
    if (data.salePrice && data.salePrice > 0) quality += 10;
    if (data.acres && data.acres > 0) quality += 10;
    if (data.location.state && data.location.county) quality += 10;
    if (data.location.latitude && data.location.longitude) quality += 10;

    // Characteristics (30 points)
    const charCount = Object.keys(data.characteristics).length;
    quality += Math.min(30, charCount * 5);

    // Market conditions (30 points)
    const marketCount = Object.keys(data.marketConditions).length;
    quality += Math.min(30, marketCount * 8);

    return Math.min(100, quality);
  }

  /**
   * Generate property valuation using hybrid model (comps + ML)
   */
  async generateValuation(
    organizationId: string,
    request: ValuationRequest
  ): Promise<ValuationResult> {
    try {
      // Aniyah §2 — block auto-AVM on Indian-Country / federal trust parcels.
      // 25 USC §177 + 25 CFR §152 govern alienability; an automated value
      // estimate on a tribal-trust parcel can mislead downstream offer +
      // contract automation. Require human verification of landStatus first.
      const propertyIdNum = Number(request.propertyId);
      if (Number.isFinite(propertyIdNum) && propertyIdNum > 0) {
        // Scoped, and the gate below is why it is safe to scope: a propertyId
        // that is not this org's now yields NO ROW, and
        // assertFeeSimpleOrThrow treats a missing row as landStatus "unknown"
        // and throws. So a foreign id is refused rather than valued — where
        // before it read a stranger's parcel to decide whether to proceed.
        const orgIdForParcel = Number(organizationId);
        const [parcel] = Number.isFinite(orgIdForParcel) && orgIdForParcel > 0
          ? await db
              .select({ landStatus: properties.landStatus })
              .from(properties)
              .where(and(
                eq(properties.id, propertyIdNum),
                eq(properties.organizationId, orgIdForParcel),
              ))
          : [];
        assertFeeSimpleOrThrow(parcel ?? null, "valuation");
      }

      // ── Residential fork (wave V3, founder ruling #11) ────────────────
      // Everything below this block is the LAND model: land transaction
      // training rows, a land-feature GBM, and a "rural land valuation
      // expert" LLM prompt. Serving that to a fix_and_flip / landlord-family
      // org is the 2026-07-11 demotion root cause. Residential orgs route
      // through the residentialComps seam (registry → ATTOM AVM) and degrade
      // honestly (insufficient_data + the real fix path) when no ATTOM key
      // exists — never a land number under a house label.
      {
        const orgIdNum = Number(organizationId);
        if (Number.isFinite(orgIdNum) && orgIdNum > 0) {
          const { getOrgBusinessType } = await import("./residentialComps");
          const { isResidentialBusinessType } = await import("@shared/models/persona-mapping");
          const businessType = await getOrgBusinessType(orgIdNum);
          if (isResidentialBusinessType(businessType)) {
            return await this.generateResidentialValuation(orgIdNum, request);
          }
        }
      }

      // Step 1: Find comparable sales
      const comparables = await this.findComparables(
        organizationId,
        request.location,
        request.acres
      );

      // Stage 2 fallback: if no comparables, use AI to estimate from county/state context
      if (comparables.length === 0) {
        return await this.generateMarketEstimate(organizationId, request);
      }

      // Step 2: Calculate baseline from comparables
      const baselineValue = this.calculateComparableBaseline(
        request.acres,
        comparables
      );

      // Step 3: Apply market adjustments
      const adjustments = await this.calculateMarketAdjustments(
        request,
        comparables
      );

      let adjustedValue = baselineValue;
      for (const adj of adjustments) {
        adjustedValue *= (1 + adj.adjustment / 100);
      }

      // Step 4: Use GPT-4 for qualitative analysis
      const aiEnhancement = await this.getAIValuationEnhancement(
        request,
        comparables,
        adjustedValue
      );

      const finalValue = adjustedValue * (1 + aiEnhancement.adjustment / 100);
      const pricePerAcre = finalValue / request.acres;

      // Step 5: Calculate confidence interval
      const volatility = this.calculateMarketVolatility(comparables);
      const confidenceInterval = {
        low: finalValue * (1 - volatility),
        high: finalValue * (1 + volatility),
      };

      // Calculate overall confidence
      const confidence = this.calculateConfidence(
        comparables.length,
        comparables[0].distance,
        volatility
      );

      // Save valuation prediction
      const [prediction] = await db.insert(valuationPredictions).values({
        propertyId: Number(request.propertyId),
        predictedValue: String(Math.round(finalValue)),
        confidenceScore: String(confidence),
        valueRange: {
          low: Math.round(confidenceInterval.low),
          high: Math.round(confidenceInterval.high),
        },
        modelVersion: 'hybrid_comps_ml',
        featuresUsed: adjustments.map((a) => a.factor),
        comparableCount: comparables.length,
        validUntil: addMonths(new Date(), 3),
      }).returning();

      // Magnus §1 — capture AVM input + estimate as a training snapshot. The
      // sale-price label is paired in later by the deal-close handler when
      // (and if) the property actually transacts. Fire-and-forget; never
      // blocks the AVM response.
      try {
        const { recordSnapshotAsync } = await import("./mlSnapshots");
        const orgIdNum = Number(organizationId);
        recordSnapshotAsync({
          snapshotType: "avm_vs_actual",
          subjectType: "property",
          subjectId: String(request.propertyId),
          orgId: Number.isFinite(orgIdNum) ? orgIdNum : null,
          decisionAt: new Date(),
          features: {
            acres: request.acres,
            location: request.location,
            characteristics: request.characteristics,
            comparablesUsed: comparables.length,
            marketAdjustments: adjustments,
          },
          labels: {
            avmEstimate: Math.round(finalValue),
            pricePerAcre: Math.round(pricePerAcre),
            confidence,
            methodology: 'hybrid_comps_ml',
          },
          metadata: { predictionId: prediction?.id },
        });
      } catch { /* non-fatal */ }

      return {
        status: "ok",
        classification: "comps_model",
        estimatedValue: Math.round(finalValue),
        pricePerAcre: Math.round(pricePerAcre),
        confidenceInterval: {
          low: Math.round(confidenceInterval.low),
          high: Math.round(confidenceInterval.high),
        },
        confidence,
        methodology: 'AcreOS Valuation Model v1.1 (comparable sales + market adjustments)',
        comparables,
        marketAdjustments: adjustments,
      };
    } catch (error) {
      logger.error('Valuation generation failed', error);
      throw error;
    }
  }

  /**
   * Residential (house) valuation — wave V3 of founder ruling #11.
   * Routes through the residentialComps seam (provider registry restricted
   * to ATTOM) instead of the land comps/GBM/LLM ladder. Honest refusal
   * (status insufficient_data, with the real fix path in `missing`) when no
   * ATTOM key is connected or ATTOM returns no usable value — the AVM route
   * already refunds the pool debit on insufficient_data, so an honest
   * refusal is never billed.
   */
  private async generateResidentialValuation(
    organizationId: number,
    request: ValuationRequest
  ): Promise<ValuationResult> {
    const refuse = (missing: string[]): ValuationResult => ({
      status: "insufficient_data",
      classification: "insufficient_data",
      estimatedValue: 0,
      pricePerAcre: 0,
      confidenceInterval: { low: 0, high: 0 },
      confidence: 0,
      methodology: 'No residential valuation — not enough data to produce one honestly',
      missing,
      comparables: [],
      marketAdjustments: [],
    });

    const { latitude, longitude } = request.location;
    if (!latitude || !longitude) {
      return refuse(['Property coordinates (required for a residential ATTOM valuation)']);
    }

    const { getResidentialValuation, extractResidentialAvm } = await import("./residentialComps");
    const outcome = await getResidentialValuation(organizationId, {
      kind: "coordinates",
      latitude,
      longitude,
    });

    if (outcome.status === "unavailable") {
      logger.info('[avm] refusing residential valuation — ATTOM unavailable', {
        metadata: { organizationId, reason: outcome.reason },
      });
      return refuse([outcome.message]);
    }
    if (outcome.status === "no_data") {
      return refuse([outcome.message]);
    }

    const avm = extractResidentialAvm(outcome.result.data);
    if (!avm) {
      return refuse(['ATTOM AVM returned no usable value for this property']);
    }

    const estimatedValue = Math.round(avm.value);
    const confidenceInterval = {
      // When ATTOM provides no band, low = high = value states "no band
      // provided" rather than inventing a spread.
      low: Math.round(avm.low ?? avm.value),
      high: Math.round(avm.high ?? avm.value),
    };
    // ATTOM's own confidence score when present; otherwise the provider-
    // declared lookup confidence — never an invented number.
    const confidence = Math.max(
      0,
      Math.min(100, Math.round(avm.score ?? outcome.result.confidence)),
    );

    // Persist with an honest model version so history/labels can never
    // masquerade as the AcreOS land model (see routes-avm METHODOLOGY_LABELS).
    try {
      await db.insert(valuationPredictions).values({
        propertyId: Number(request.propertyId),
        predictedValue: String(estimatedValue),
        confidenceScore: String(confidence),
        valueRange: confidenceInterval,
        modelVersion: 'attom_avm',
        featuresUsed: [],
        comparableCount: 0,
        validUntil: addMonths(new Date(), 3),
      });
    } catch {
      // Non-fatal — the valuation response is still returned.
    }

    return {
      status: "ok",
      classification: "attom_avm",
      estimatedValue,
      pricePerAcre: request.acres > 0 ? Math.round(estimatedValue / request.acres) : 0,
      confidenceInterval,
      confidence,
      methodology: 'ATTOM AVM (residential) — automated valuation by ATTOM Data, not the AcreOS land model',
      comparables: [],
      marketAdjustments: [],
    };
  }

  /**
   * Stage 2 fallback: generate a market estimate using OpenAI when no comparables exist.
   * Returns a lower-confidence valuation clearly labeled as a market estimate.
   */
  private async generateMarketEstimate(
    organizationId: string,
    request: ValuationRequest
  ): Promise<ValuationResult> {
    const { county, state } = request.location;
    const { zoning, roadAccess, floodZone } = request.characteristics;

    // W3.1: no fabricated baseline. Either a trained model or a clearly
    // labeled AI estimate produces a number, or we refuse honestly. The old
    // `= 1000` seed meant every parcel in America "was worth" $1,000/acre
    // the moment both real paths failed — branded as a proprietary model.
    let pricePerAcreEstimate: number | null = null;
    let estimateSource = 'baseline';
    let gbmConfidence = 0;
    /** Features the model was NOT given for this parcel — see below. */
    let gbmAssumedFeatures: string[] = [];

    // --- Path 1: TypeScript GBM (fast, deterministic, no API cost) ---
    try {
      // `null`, not `0`: this path has no comparable sales on hand, and the
      // model must decline rather than price the parcel off a national
      // constant. Passing 0 previously tripped `|| 1000` inside the feature
      // vector, which is how the $1,000/acre baseline W3.1 deleted from this
      // function survived one level below it.
      const gbmResult = await gbmEstimatePricePerAcre(
        request.acres,
        null,
        request.characteristics,
        {}
      );
      if (gbmResult) {
        pricePerAcreEstimate = gbmResult.pricePerAcre;
        gbmConfidence = gbmResult.confidence;
        gbmAssumedFeatures = gbmResult.assumedFeatures;
        estimateSource = 'gbm_model';
      }
    } catch {
      // GBM unavailable — continue to AI fallback
    }

    // --- Path 2: AI fallback (richer context, used when GBM isn't trained yet) ---
    // Routed through OpenRouter → gpt-4o-mini equivalent for cost efficiency.
    // `requireOpenAIClient()` throws if OPENROUTER isn't configured, so the
    // outer try/catch above the path-2 block handles that as a soft failure.
    if (estimateSource !== 'gbm_model' && process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY) {
      try {
        const prompt = `You are a rural land valuation expert. Provide a realistic price-per-acre estimate for vacant land with these characteristics:

County: ${county}, ${state}
Acres: ${request.acres}
Zoning: ${zoning || 'unknown'}
Road access: ${roadAccess || 'unknown'}
Flood zone: ${floodZone || 'unknown'}

Return ONLY a JSON object with this exact format (no markdown, no explanation):
{"pricePerAcre": <number>, "lowPerAcre": <number>, "highPerAcre": <number>, "rationale": "<one sentence>"}

Base your estimate on typical rural land market conditions in ${county} County, ${state}. Be conservative.`;

        const completion = await requireOpenAIClient().chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 200,
        });

        const raw = completion.choices[0]?.message?.content?.trim() || '';
        const parsed = JSON.parse(raw);
        if (parsed.pricePerAcre && typeof parsed.pricePerAcre === 'number') {
          pricePerAcreEstimate = parsed.pricePerAcre;
          estimateSource = 'ai_market_estimate';
        }
      } catch {
        // AI call failed — nothing left that can honestly produce a value.
      }
    }

    // ── Honest refusal (W3.1) ──────────────────────────────────────────────
    // No comps (we're only here because comparables.length === 0), the GBM
    // isn't trained, and the AI path didn't produce a value. Refuse with
    // exactly what's missing instead of inventing a number.
    if (pricePerAcreEstimate === null) {
      logger.info('[avm] refusing valuation — insufficient data', {
        metadata: { county, state, acres: request.acres },
      });
      return {
        status: "insufficient_data",
        classification: "insufficient_data",
        estimatedValue: 0,
        pricePerAcre: 0,
        confidenceInterval: { low: 0, high: 0 },
        confidence: 0,
        methodology: 'No valuation — not enough data to produce one honestly',
        missing: [
          `Comparable land sales in ${county} County, ${state} (last 24 months)`,
          'A trained regional valuation model for this area',
        ],
        comparables: [],
        marketAdjustments: [],
      };
    }

    const estimatedValue = Math.round(pricePerAcreEstimate * request.acres);
    const confidence = gbmConfidence || 45; // GBM provides dynamic confidence; AI estimate = 45
    const confidenceInterval = {
      low: Math.round(estimatedValue * 0.6),
      high: Math.round(estimatedValue * 1.5),
    };

    // Save as a low-confidence prediction
    try {
      await db.insert(valuationPredictions).values({
        propertyId: Number(request.propertyId),
        predictedValue: String(estimatedValue),
        confidenceScore: String(confidence),
        valueRange: {
          low: Math.round(confidenceInterval.low),
          high: Math.round(confidenceInterval.high),
        },
        modelVersion: estimateSource,
        featuresUsed: [],
        comparableCount: 0,
        validUntil: addMonths(new Date(), 3),
      });
    } catch {
      // Non-fatal — continue even if save fails
    }

    // Magnus §1 — capture AVM input + estimate as a training snapshot for
    // the no-comparables fallback path too. Same pairing semantics as the
    // hybrid path: sale price is filled in on deal close.
    try {
      const { recordSnapshotAsync } = await import("./mlSnapshots");
      const orgIdNum = Number(organizationId);
      recordSnapshotAsync({
        snapshotType: "avm_vs_actual",
        subjectType: "property",
        subjectId: String(request.propertyId),
        orgId: Number.isFinite(orgIdNum) ? orgIdNum : null,
        decisionAt: new Date(),
        features: {
          acres: request.acres,
          location: request.location,
          characteristics: request.characteristics,
          comparablesUsed: 0,
          estimateSource,
        },
        labels: {
          avmEstimate: estimatedValue,
          pricePerAcre: Math.round(pricePerAcreEstimate),
          confidence,
          methodology: estimateSource,
        },
      });
    } catch { /* non-fatal */ }

    // W3.1(b): the LLM rung must never masquerade as a modeled value — it
    // is an AI's educated guess and is labeled as exactly that.
    const isAiEstimate = estimateSource === 'ai_market_estimate';
    return {
      status: "ok",
      classification: isAiEstimate ? "ai_estimate" : "trained_model",
      estimatedValue,
      pricePerAcre: Math.round(pricePerAcreEstimate),
      confidenceInterval,
      confidence,
      // A modeled value must disclose what the model was not told. Naming the
      // assumed features is what separates "trained model estimate" from
      // "trained model estimate computed largely from defaults" — the two read
      // identically to a customer otherwise, and only one of them is worth
      // what this endpoint charges for it.
      methodology: isAiEstimate
        ? 'AI estimate (no local comparables) — an educated guess by a language model, not a comps-based value'
        : gbmAssumedFeatures.length > 0
          ? `AcreOS trained model estimate (no local comparables). ${gbmAssumedFeatures.length} of ${LAND_FEATURE_NAMES.length} model inputs were not measured for this parcel and used defaults: ${gbmAssumedFeatures.join(', ')}.`
          : 'AcreOS trained model estimate (no local comparables)',
      comparables: [],
      marketAdjustments: [],
    };
  }

  /**
   * Find comparable sales within geographic radius
   */
  private async findComparables(
    organizationId: string,
    location: ValuationRequest['location'],
    acres: number,
    maxDistance: number = 50, // miles
    maxResults: number = 10
  ): Promise<ValuationResult['comparables']> {
    try {
      // Get transactions within past 24 months
      const cutoffDate = addMonths(new Date(), -24);

      // transaction_training is anonymized — no organizationId, no nested
      // location, and acreage lives in the `size_acres` column (returned as a
      // string by drizzle). It also carries no lat/long, so we scope comps by
      // state/county and acreage band rather than by geographic radius.
      const transactions = await db.query.transactionTraining.findMany({
        where: and(
          eq(transactionTraining.state, location.state),
          gte(transactionTraining.saleDate, cutoffDate),
          // Filter by similar acreage (50% to 200% of target)
          between(transactionTraining.sizeAcres, String(acres * 0.5), String(acres * 2.0)),
          // W3.2 comps discipline: assessor last-sale rows flagged as
          // outliers or low-quality are not comps. (Ingest marks nominal-
          // price transfers — the classic non-arm's-length signature — as
          // outliers; see countyAssessorIngest.)
          eq(transactionTraining.isOutlier, false),
          sql`${transactionTraining.dataQuality} != 'low'`
        ),
        orderBy: [desc(transactionTraining.saleDate)],
        limit: 100, // Get broader set for filtering
      });

      // Without geo coordinates we cannot compute haversine distance; comps are
      // ranked purely on county/state + acreage similarity.
      const comparablesWithScores = transactions
        .map(t => {
          const compAcres = Number(t.sizeAcres);
          const similarity = this.calculateSimilarity(
            acres,
            location,
            compAcres,
            { state: t.state, county: t.county, zipCode: '' }
          );

          return {
            propertyId: t.transactionHash,
            salePrice: Number(t.salePrice),
            pricePerAcre: Number(t.pricePerAcre),
            distance: 0,
            similarity,
          };
        })
        .filter(c => c.distance <= maxDistance)
        .sort((a, b) => b.similarity - a.similarity) // Sort by similarity
        .slice(0, maxResults);

      return comparablesWithScores;
    } catch (error) {
      logger.error('Failed to find comparables', error);
      return [];
    }
  }

  /**
   * Calculate distance between two lat/lon points (Haversine formula)
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Calculate similarity score between properties
   */
  private calculateSimilarity(
    acres1: number,
    location1: ValuationRequest['location'],
    acres2: number,
    location2: any
  ): number {
    let similarity = 0;

    // Acreage similarity (40 points)
    const acreRatio = Math.min(acres1, acres2) / Math.max(acres1, acres2);
    similarity += acreRatio * 40;

    // Same county (30 points)
    if (location1.county === location2.county) {
      similarity += 30;
    } else if (location1.state === location2.state) {
      // Same state but different county (15 points)
      similarity += 15;
    }

    // Zip code proximity (30 points)
    if (location1.zipCode === location2.zipCode) {
      similarity += 30;
    }

    return Math.min(100, similarity);
  }

  /**
   * Calculate baseline value from comparable sales
   */
  private calculateComparableBaseline(
    acres: number,
    comparables: ValuationResult['comparables']
  ): number {
    if (comparables.length === 0) return 0;

    // Weight comparables by similarity
    const weightedPricePerAcre = comparables.reduce((sum, comp) => {
      return sum + (comp.pricePerAcre * comp.similarity / 100);
    }, 0);

    const totalWeight = comparables.reduce((sum, comp) => sum + comp.similarity / 100, 0);
    const avgPricePerAcre = weightedPricePerAcre / totalWeight;

    return avgPricePerAcre * acres;
  }

  /**
   * Calculate market adjustments based on property characteristics
   */
  private async calculateMarketAdjustments(
    request: ValuationRequest,
    comparables: ValuationResult['comparables']
  ): Promise<{ factor: string; adjustment: number }[]> {
    const adjustments: { factor: string; adjustment: number }[] = [];

    // Water rights adjustment
    if (request.characteristics.waterRights) {
      adjustments.push({
        factor: 'Water Rights',
        adjustment: 15, // +15%
      });
    }

    // Utilities adjustment
    if (request.characteristics.utilities && request.characteristics.utilities.length > 0) {
      const utilityBonus = request.characteristics.utilities.length * 3;
      adjustments.push({
        factor: 'Utilities Available',
        adjustment: Math.min(15, utilityBonus), // Up to +15%
      });
    }

    // Road access adjustment
    if (request.characteristics.roadAccess === 'paved') {
      adjustments.push({
        factor: 'Paved Road Access',
        adjustment: 10,
      });
    } else if (request.characteristics.roadAccess === 'dirt') {
      adjustments.push({
        factor: 'Dirt Road Access',
        adjustment: -5,
      });
    } else if (request.characteristics.roadAccess === 'none') {
      adjustments.push({
        factor: 'No Road Access',
        adjustment: -20,
      });
    }

    // Topography adjustment
    if (request.characteristics.topography === 'flat') {
      adjustments.push({
        factor: 'Flat Topography',
        adjustment: 8,
      });
    } else if (request.characteristics.topography === 'steep') {
      adjustments.push({
        factor: 'Steep Topography',
        adjustment: -10,
      });
    }

    // Flood zone adjustment
    if (request.characteristics.floodZone === 'X') {
      // No flood risk
      adjustments.push({
        factor: 'No Flood Risk',
        adjustment: 5,
      });
    } else if (request.characteristics.floodZone === 'A' || request.characteristics.floodZone === 'AE') {
      // High flood risk
      adjustments.push({
        factor: 'Flood Zone',
        adjustment: -15,
      });
    }

    // Zoning adjustment
    if (request.characteristics.zoning?.includes('commercial')) {
      adjustments.push({
        factor: 'Commercial Zoning',
        adjustment: 25,
      });
    } else if (request.characteristics.zoning?.includes('residential')) {
      adjustments.push({
        factor: 'Residential Zoning',
        adjustment: 20,
      });
    }

    return adjustments;
  }

  /**
   * Get AI-powered valuation enhancement
   */
  private async getAIValuationEnhancement(
    request: ValuationRequest,
    comparables: ValuationResult['comparables'],
    preliminaryValue: number
  ): Promise<{ adjustment: number; reasoning: string }> {
    try {
      const prompt = `You are a land valuation expert analyzing a property in ${request.location.county}, ${request.location.state}.

Property Details:
- Acres: ${request.acres}
- Zoning: ${request.characteristics.zoning || 'Unknown'}
- Water Rights: ${request.characteristics.waterRights ? 'Yes' : 'No'}
- Utilities: ${request.characteristics.utilities?.join(', ') || 'None'}
- Road Access: ${request.characteristics.roadAccess || 'Unknown'}
- Topography: ${request.characteristics.topography || 'Unknown'}

Comparable Sales: ${comparables.length} properties
Average Comparable Price/Acre: $${Math.round(comparables.reduce((sum, c) => sum + c.pricePerAcre, 0) / comparables.length).toLocaleString()}

Preliminary Valuation: $${preliminaryValue.toLocaleString()}

Based on market trends, location factors, and property characteristics, provide:
1. A percentage adjustment (-20% to +20%) to the preliminary valuation
2. Brief reasoning (1-2 sentences)

Consider factors like:
- Market momentum in this area
- Unique property characteristics
- Development potential
- Location advantages/disadvantages

Respond in JSON format: { "adjustment": number, "reasoning": string }`;

      const completion = await requireOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(completion.choices[0].message.content || '{}');
      
      return {
        adjustment: result.adjustment || 0,
        reasoning: result.reasoning || 'No additional adjustments',
      };
    } catch (error) {
      logger.error('AI valuation enhancement failed', error);
      return { adjustment: 0, reasoning: 'AI enhancement unavailable' };
    }
  }

  /**
   * Calculate market volatility from comparables
   */
  private calculateMarketVolatility(comparables: ValuationResult['comparables']): number {
    if (comparables.length < 2) return 0.20; // Default 20% volatility

    const pricesPerAcre = comparables.map(c => c.pricePerAcre);
    const mean = pricesPerAcre.reduce((sum, p) => sum + p, 0) / pricesPerAcre.length;
    
    // Calculate standard deviation
    const variance = pricesPerAcre.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pricesPerAcre.length;
    const stdDev = Math.sqrt(variance);
    
    // Coefficient of variation
    const coefficientOfVariation = stdDev / mean;
    
    // Cap at reasonable bounds (10% to 50%)
    return Math.max(0.10, Math.min(0.50, coefficientOfVariation));
  }

  /**
   * Calculate overall confidence score
   */
  private calculateConfidence(
    comparableCount: number,
    nearestDistance: number,
    volatility: number
  ): number {
    let confidence = 50;

    // More comparables = higher confidence (up to +30)
    confidence += Math.min(30, comparableCount * 3);

    // Closer comparables = higher confidence (up to +15)
    if (nearestDistance < 5) confidence += 15;
    else if (nearestDistance < 15) confidence += 10;
    else if (nearestDistance < 30) confidence += 5;

    // Lower volatility = higher confidence (up to +15)
    const volatilityScore = Math.max(0, (0.5 - volatility) * 30);
    confidence += volatilityScore;

    return Math.max(10, Math.min(95, confidence));
  }

  /**
   * Bulk import transactions from external source
   */
  async bulkImportTransactions(
    organizationId: string,
    transactions: TransactionDataPoint[]
  ): Promise<{ imported: number; failed: number }> {
    let imported = 0;
    let failed = 0;

    for (const transaction of transactions) {
      try {
        await this.recordTransactionForTraining(organizationId, transaction);
        imported++;
      } catch (error) {
        failed++;
        logger.error('Failed to import transaction', error);
      }
    }

    return { imported, failed };
  }

  /**
   * Get valuation history for property
   */
  async getValuationHistory(
    _organizationId: string,
    propertyId: string
  ): Promise<any[]> {
    try {
      // valuation_predictions has no organizationId column; scope by property.
      return await db.query.valuationPredictions.findMany({
        where: eq(valuationPredictions.propertyId, Number(propertyId)),
        orderBy: [desc(valuationPredictions.createdAt)],
      });
    } catch (error) {
      logger.error('Failed to get valuation history', error);
      throw error;
    }
  }

  /**
   * Get training data statistics
   */
  async getTrainingDataStats(_organizationId: string): Promise<{
    totalTransactions: number;
    avgDataQuality: number;
    dateRange: { oldest: Date; newest: Date };
    coverageByState: { state: string; count: number }[];
    avgPricePerAcre: number;
  }> {
    try {
      // transactionTraining is intentionally anonymized — no organizationId
      // column. Stats are global aggregates across all contributing orgs;
      // an earlier version tried to filter by org.id, hit a missing column
      // at runtime, and crashed /avm with HTTP 500.
      const transactions = await db.query.transactionTraining.findMany({
        orderBy: [desc(transactionTraining.saleDate)],
      });

      if (transactions.length === 0) {
        return {
          totalTransactions: 0,
          avgDataQuality: 0,
          dateRange: { oldest: new Date(), newest: new Date() },
          coverageByState: [],
          avgPricePerAcre: 0,
        };
      }

      // dataQuality is text ("high" | "medium" | "low"); map to a 0-100 score.
      const qualityScore: Record<string, number> = { high: 90, medium: 60, low: 30 };
      const avgDataQuality =
        transactions.reduce((sum, t) => sum + (qualityScore[t.dataQuality] ?? 0), 0) /
        transactions.length;

      const dates = transactions
        .map((t) => t.saleDate)
        .sort((a, b) => a.getTime() - b.getTime());
      const dateRange = {
        oldest: dates[0],
        newest: dates[dates.length - 1],
      };

      const stateMap = new Map<string, number>();
      for (const t of transactions) {
        // Real column is `state` (text), not a nested location.state.
        const state = t.state ?? "unknown";
        stateMap.set(state, (stateMap.get(state) || 0) + 1);
      }
      const coverageByState = Array.from(stateMap.entries())
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count);

      // pricePerAcre is `numeric`, which drizzle returns as string — coerce.
      const totalPpa = transactions.reduce(
        (sum, t) => sum + Number(t.pricePerAcre ?? 0),
        0,
      );
      const avgPricePerAcre = totalPpa / transactions.length;

      return {
        totalTransactions: transactions.length,
        avgDataQuality: Math.round(avgDataQuality),
        dateRange,
        coverageByState,
        avgPricePerAcre: Math.round(avgPricePerAcre),
      };
    } catch (error) {
      logger.error('Failed to get training data stats', error);
      throw error;
    }
  }

  /**
   * Generate automated valuation for all properties in organization
   */
  async generateBulkValuations(
    organizationId: string
  ): Promise<{ valuated: number; failed: number }> {
    try {
      const props = await db.query.properties.findMany({
        where: eq(properties.organizationId, Number(organizationId)),
      });

      let valuated = 0;
      let failed = 0;

      for (const prop of props) {
        try {
          if (!prop.sizeAcres || !prop.state || !prop.county) {
            failed++;
            continue;
          }
          // Aniyah §2 — skip non-fee parcels in bulk mode. Per-call guard
          // inside generateValuation will also block; we short-circuit here
          // so the failure count is meaningful and we don't hammer the DB.
          if ((prop.landStatus ?? "unknown") !== "fee") {
            failed++;
            logger.warn(`[BulkValuation] Skipping property ${prop.id} — landStatus=${prop.landStatus ?? "unknown"} requires manual review`);
            continue;
          }

          const request: ValuationRequest = {
            propertyId: String(prop.id),
            acres: Number(prop.sizeAcres),
            location: {
              state: prop.state,
              county: prop.county,
              zipCode: prop.zip || '',
              latitude: Number(prop.latitude) || 0,
              longitude: Number(prop.longitude) || 0,
            },
            characteristics: {
              zoning: prop.zoning ?? undefined,
              // waterRights / floodZone are not columns on properties; they
              // live in due-diligence data and aren't wired in for bulk runs.
              waterRights: undefined,
              utilities: [], // Would come from property details
              roadAccess: prop.roadAccess ?? undefined,
              topography: undefined,
              soilType: undefined,
              floodZone: undefined,
            },
          };

          await this.generateValuation(organizationId, request);
          valuated++;
        } catch (error) {
          failed++;
          logger.error(`Failed to valuate property ${prop.id}`, error);
        }
      }

      return { valuated, failed };
    } catch (error) {
      logger.error('Bulk valuation failed', error);
      throw error;
    }
  }
}

export const acreOSValuation = new AcreOSValuationModel();
