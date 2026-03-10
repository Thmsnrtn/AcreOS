"""
AcreOS ML Model Serving API — Epic I

FastAPI microservice wrapping the existing Python ML models for use by the Node.js backend.
Runs on port 5001. Node.js calls http://localhost:5001/predict/... internally.

Models:
  - valuation_model.py: Rule-based + ML land valuation
  - features.py: Feature engineering for deal probability scoring
  - preprocessing.py: Data normalization and encoding

Usage:
  pip install -r requirements.txt
  uvicorn server.ml.api:app --host 127.0.0.1 --port 5001

Or via the Node.js model serving bridge:
  server/services/modelServing.ts calls spawn("python", ["server/ml/api.py"])
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import sys
import os
import json
import traceback

# Add the ml directory to path for imports
sys.path.insert(0, os.path.dirname(__file__))

app = FastAPI(
    title="AcreOS ML API",
    description="Land valuation and deal probability ML microservice",
    version="1.0.0",
)


# ============================================
# REQUEST / RESPONSE MODELS
# ============================================

class ValuationRequest(BaseModel):
    acres: float
    state: str
    county: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    zoning: Optional[str] = None
    farmlandClass: Optional[str] = None  # Prime, Statewide, Local, Not prime
    roadAccess: Optional[bool] = True
    inFloodZone: Optional[bool] = False
    wetlandPercent: Optional[float] = 0.0
    usdaPricePerAcre: Optional[float] = None
    askingPrice: Optional[float] = None
    nccpiScore: Optional[float] = None  # 0-1 SSURGO soil productivity
    countyCagr5Year: Optional[float] = None  # 5-year USDA land value CAGR


class ValuationResponse(BaseModel):
    estimatedValue: float  # $ total
    estimatedValuePerAcre: float  # $/acre
    confidenceScore: float  # 0-1
    podolskyOfferPrice: float  # estimatedValue / 4
    ownerFinanceListPrice: float  # estimatedValue * 2-3
    cashFlipListPrice: float  # estimatedValue * 1.5-2
    methodology: str
    factors: Dict[str, Any]


class DealProbabilityRequest(BaseModel):
    leadId: Optional[int] = None
    ownershipYears: Optional[float] = 0
    isTaxDelinquent: Optional[bool] = False
    isOutOfState: Optional[bool] = False
    isAbsentee: Optional[bool] = False
    hasInheritanceSignal: Optional[bool] = False
    acreScore: Optional[int] = 0  # Betty-style -400 to +400 score
    daysOnMarket: Optional[int] = 0
    priceReduced: Optional[bool] = False
    distanceOwnerMiles: Optional[float] = 0
    campaignTouches: Optional[int] = 0
    emailEngaged: Optional[bool] = False
    lienCount: Optional[int] = 0


class DealProbabilityResponse(BaseModel):
    dealProbabilityScore: float  # 0-1
    dealProbabilityPercent: float  # 0-100
    recommendation: str  # "mail", "maybe", "skip"
    topPositiveFactors: List[str]
    topNegativeFactors: List[str]
    modelVersion: str


# ============================================
# VALUATION ENDPOINT
# ============================================

@app.post("/predict/valuation", response_model=ValuationResponse)
async def predict_valuation(req: ValuationRequest) -> ValuationResponse:
    """
    ML-powered land valuation using USDA data, parcel characteristics,
    and the Podolsky formula as a baseline.
    """
    try:
        # Try to use the valuation_model.py if available
        try:
            from valuation_model import predict as model_predict
            result = model_predict(req.dict())
            if result:
                return ValuationResponse(**result)
        except (ImportError, Exception):
            pass  # Fall back to rule-based

        # Rule-based valuation (Podolsky formula + USDA data)
        acres = req.acres
        usda_per_acre = req.usdaPricePerAcre or estimate_usda_price(req.state)
        nccpi = req.nccpiScore or 0.3

        # Base value from USDA land value data
        base_per_acre = usda_per_acre

        # Adjustments based on parcel characteristics
        multiplier = 1.0

        # Farmland classification
        if req.farmlandClass and "prime" in req.farmlandClass.lower():
            multiplier *= 1.3  # Prime farmland premium
        elif req.farmlandClass and "not" in req.farmlandClass.lower():
            multiplier *= 0.7  # Non-agricultural discount

        # NCCPI soil productivity
        if nccpi > 0.6:
            multiplier *= 1.25
        elif nccpi > 0.4:
            multiplier *= 1.1
        elif nccpi < 0.2:
            multiplier *= 0.85

        # Road access
        if req.roadAccess is False:
            multiplier *= 0.6  # Landlocked discount

        # Flood zone
        if req.inFloodZone:
            multiplier *= 0.8

        # Wetland coverage
        wetland_pct = req.wetlandPercent or 0
        if wetland_pct > 50:
            multiplier *= 0.5
        elif wetland_pct > 20:
            multiplier *= 0.75

        # Market appreciation
        if req.countyCagr5Year and req.countyCagr5Year > 5:
            multiplier *= 1.15  # Strong appreciation market premium

        adjusted_per_acre = base_per_acre * multiplier
        total_value = adjusted_per_acre * acres

        # Podolsky offer = lowest comp / 4 → use adjusted value / 4
        podolsky_offer = total_value / 4
        owner_finance_list = total_value * 2.5  # typical owner-finance listing
        cash_flip_list = total_value * 1.75  # typical cash flip listing

        confidence = 0.6 + (0.1 if req.usdaPricePerAcre else 0) + (0.1 if req.nccpiScore else 0) + (0.1 if req.countyCagr5Year else 0)

        return ValuationResponse(
            estimatedValue=round(total_value, 2),
            estimatedValuePerAcre=round(adjusted_per_acre, 2),
            confidenceScore=round(min(0.95, confidence), 2),
            podolskyOfferPrice=round(podolsky_offer, 2),
            ownerFinanceListPrice=round(owner_finance_list, 2),
            cashFlipListPrice=round(cash_flip_list, 2),
            methodology="rule-based-podolsky-usda",
            factors={
                "basePricePerAcre": usda_per_acre,
                "multiplier": round(multiplier, 3),
                "farmlandClass": req.farmlandClass,
                "nccpiScore": nccpi,
                "inFloodZone": req.inFloodZone,
                "wetlandPercent": wetland_pct,
                "roadAccess": req.roadAccess,
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Valuation failed: {str(e)}")


# ============================================
# DEAL PROBABILITY ENDPOINT
# ============================================

@app.post("/predict/deal-probability", response_model=DealProbabilityResponse)
async def predict_deal_probability(req: DealProbabilityRequest) -> DealProbabilityResponse:
    """
    ML deal probability score — probability that this lead will convert to a deal.
    Uses Betty-style scoring features as input.
    """
    try:
        # Try to use ML model if features.py is available
        try:
            from features import build_feature_vector
            from valuation_model import predict_deal_prob
            features = build_feature_vector(req.dict())
            prob = predict_deal_prob(features)
            if prob is not None:
                return format_probability_response(prob, req)
        except (ImportError, Exception):
            pass

        # Rule-based probability scoring
        score = 0.3  # base probability

        positive_factors = []
        negative_factors = []

        # Betty-score correlation: AcreScore → probability
        if req.acreScore and req.acreScore >= 200:
            score += 0.25
            positive_factors.append(f"Very high AcreScore ({req.acreScore}) — strong motivation signals")
        elif req.acreScore and req.acreScore >= 100:
            score += 0.15
            positive_factors.append(f"High AcreScore ({req.acreScore})")
        elif req.acreScore and req.acreScore < 0:
            score -= 0.1
            negative_factors.append(f"Low AcreScore ({req.acreScore})")

        if req.isTaxDelinquent:
            score += 0.15
            positive_factors.append("Tax delinquent — financial pressure to sell")

        if req.isOutOfState:
            score += 0.10
            positive_factors.append("Out-of-state owner — low emotional attachment")

        if req.hasInheritanceSignal:
            score += 0.12
            positive_factors.append("Inheritance indicator — heirs often want quick sale")

        if req.ownershipYears and req.ownershipYears > 20:
            score += 0.08
            positive_factors.append(f"Long ownership ({int(req.ownershipYears)} years) — forgotten asset")

        if req.priceReduced:
            score += 0.10
            positive_factors.append("Price reduced — willing to negotiate")

        if req.daysOnMarket and req.daysOnMarket > 180:
            score += 0.08
            positive_factors.append(f"Listed {req.daysOnMarket} days — stale, motivated")

        if req.emailEngaged:
            score += 0.10
            positive_factors.append("Email engagement — interested seller")

        if req.lienCount and req.lienCount >= 2:
            score += 0.08
            positive_factors.append("Multiple liens — financial distress signal")

        if req.campaignTouches and req.campaignTouches >= 3:
            score += 0.05
            positive_factors.append(f"{req.campaignTouches} campaign touches — awareness built")
        elif not req.campaignTouches or req.campaignTouches == 0:
            negative_factors.append("No campaign touches yet — cold outreach")

        score = max(0.02, min(0.97, score))

        rec = "mail" if score >= 0.5 else "maybe" if score >= 0.25 else "skip"

        return DealProbabilityResponse(
            dealProbabilityScore=round(score, 3),
            dealProbabilityPercent=round(score * 100, 1),
            recommendation=rec,
            topPositiveFactors=positive_factors[:3],
            topNegativeFactors=negative_factors[:3],
            modelVersion="rule-based-v1.0",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deal probability failed: {str(e)}")


def format_probability_response(prob: float, req: DealProbabilityRequest) -> DealProbabilityResponse:
    rec = "mail" if prob >= 0.5 else "maybe" if prob >= 0.25 else "skip"
    return DealProbabilityResponse(
        dealProbabilityScore=round(prob, 3),
        dealProbabilityPercent=round(prob * 100, 1),
        recommendation=rec,
        topPositiveFactors=["ML model prediction"],
        topNegativeFactors=[],
        modelVersion="ml-v1.0",
    )


def estimate_usda_price(state: str) -> float:
    """Rough USDA land value estimates by state ($/acre) for fallback."""
    state_prices = {
        "CA": 12000, "TX": 2500, "FL": 4000, "AZ": 1200, "NM": 900,
        "CO": 1800, "OR": 2000, "WA": 3000, "ID": 1500, "MT": 800,
        "ND": 2200, "SD": 1800, "NE": 3500, "KS": 2800, "MO": 3000,
        "IA": 7500, "IL": 8500, "IN": 7000, "OH": 6000, "MI": 3500,
        "WI": 4000, "MN": 4500, "NC": 3500, "SC": 2800, "GA": 3000,
        "TN": 2800, "KY": 3200, "VA": 4000, "WV": 1800, "PA": 4500,
        "NY": 4000, "NJ": 12000, "CT": 10000, "MA": 12000,
    }
    return state_prices.get(state.upper(), 2000)


# ============================================
# HEALTH CHECK
# ============================================

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "acreos-ml-api",
        "version": "1.0.0",
        "models": ["valuation", "deal-probability"],
    }


# ============================================
# MAIN ENTRY POINT
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=5001, reload=False)
