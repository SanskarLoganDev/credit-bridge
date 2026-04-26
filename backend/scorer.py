import json
import math
import os
import warnings
from functools import lru_cache
from pathlib import Path
from typing import Optional


WEIGHTS = {
    "payment_consistency": 0.30,
    "rental_tenure":       0.25,
    "bill_regularity":     0.20,
    "income_stability":    0.15,
    "data_completeness":   0.10,
}

GRADE_BANDS = [
    (800, "Exceptional",  "#22c55e"),
    (740, "Very Good",    "#84cc16"),
    (670, "Good",         "#eab308"),
    (580, "Fair",         "#f97316"),
    (300, "Poor",         "#ef4444"),
]

MODEL_DIR = Path(__file__).resolve().parent / "model"
MODEL_BUNDLE_PATH = MODEL_DIR / "credit_ml_inference_bundle_v3.joblib"
MODEL_METADATA_PATH = MODEL_DIR / "credit_ml_inference_metadata_v3.json"

# Some model dependencies may import Matplotlib while unpickling. Keep its cache
# inside a writable temp path so scoring does not emit filesystem warnings.
os.environ.setdefault("MPLCONFIGDIR", "/tmp/matplotlib")

# The exported ML model was trained on application-level features, while the
# live app currently receives extracted document signals. Keep the rule score
# dominant until the extractor collects the exact ML feature schema directly.
RULE_SCORE_WEIGHT = 0.60
ML_SCORE_WEIGHT = 0.40
MAX_LLM_ADJUSTMENT = 25


def calculate_score(signals: dict) -> dict:
    """Blend rule scoring, ML default risk, and optional LLM-assisted calibration."""
    rule_data = _calculate_rule_score(signals)
    ml_data = _score_with_ml_model(signals)

    blended_score = rule_data["final_score"]
    if ml_data:
        blended_score = round(
            (RULE_SCORE_WEIGHT * rule_data["final_score"])
            + (ML_SCORE_WEIGHT * ml_data["score"])
        )

    agent_data = _run_credit_decision_agent(signals, rule_data, ml_data, blended_score)
    final_score = _clamp_score(blended_score + agent_data.get("score_adjustment", 0))

    grade, color = _grade_for_score(final_score)
    normalized = round(((final_score - 300) / 550) * 100, 1)

    return {
        "final_score": final_score,
        "grade": grade,
        "grade_color": color,
        "signal_scores": rule_data["signal_scores"],
        "normalized_pct": normalized,
        "recommendation": agent_data.get("recommendation") or _recommendation(grade),
    }


def _calculate_rule_score(signals: dict) -> dict:
    """Apply the original weighted rubric to produce a deterministic baseline."""
    weighted_sum = 0.0
    total_weight = 0.0

    signal_scores = {}
    for key, weight in WEIGHTS.items():
        sig = signals.get(key, {})
        raw = sig.get("score", 0)
        clamped = _clamp_signal_score(raw)
        signal_scores[key] = clamped
        weighted_sum += clamped * weight
        total_weight += weight

    normalized = weighted_sum / total_weight if total_weight else 0
    final_score = _clamp_score(300 + (normalized / 100) * 550)
    grade, color = _grade_for_score(final_score)

    return {
        "final_score": final_score,
        "grade": grade,
        "grade_color": color,
        "signal_scores": signal_scores,
        "normalized_pct": round(normalized, 1),
        "recommendation": _recommendation(grade),
    }


def _score_with_ml_model(signals: dict) -> Optional[dict]:
    """Run the exported risk model and convert P(default) to a 300-850 score."""
    bundle = _load_model_bundle()
    if not bundle:
        return None

    model = _select_model(bundle)
    if model is None:
        return None

    features = _engineer_model_features(signals, bundle)
    row = [[features[column] for column in bundle["feature_columns"]]]

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            probability_default = float(model.predict_proba(row)[0][1])
    except Exception:
        return None

    score_config = bundle.get("score_config", {})
    ml_score = _prob_to_score(
        probability_default,
        pdo=score_config.get("pdo", 20),
        base_score=score_config.get("base_score", 600),
        base_odds=score_config.get("base_odds", 1.0),
        min_score=score_config.get("min_score", 300),
        max_score=score_config.get("max_score", 850),
    )

    return {
        "score": ml_score,
        "probability_default": probability_default,
        "model_name": bundle.get("best_model_name", "ML risk model"),
        "features": features,
    }


@lru_cache(maxsize=1)
def _load_model_bundle() -> Optional[dict]:
    if not MODEL_BUNDLE_PATH.exists():
        return None

    try:
        import joblib

        bundle = joblib.load(MODEL_BUNDLE_PATH)
    except Exception:
        return None

    metadata = _load_model_metadata()
    return {
        "models": bundle.get("models", {}),
        "best_model_name": bundle.get("best_model_name") or metadata.get("best_model_name"),
        "feature_columns": bundle.get("feature_columns") or metadata.get("feature_columns", []),
        "score_config": bundle.get("score_config") or metadata.get("score_config", {}),
    }


@lru_cache(maxsize=1)
def _load_model_metadata() -> dict:
    if not MODEL_METADATA_PATH.exists():
        return {}
    try:
        return json.loads(MODEL_METADATA_PATH.read_text())
    except Exception:
        return {}


def _select_model(bundle: dict):
    models = bundle.get("models", {})
    best_model_name = (bundle.get("best_model_name") or "").lower()

    if "lightgbm" in best_model_name and models.get("lightgbm_tuned"):
        return models["lightgbm_tuned"]
    if "xgboost" in best_model_name and models.get("xgboost_tuned"):
        return models["xgboost_tuned"]
    if "logistic" in best_model_name and models.get("logistic_regression"):
        return models["logistic_regression"]

    return (
        models.get("lightgbm_tuned")
        or models.get("xgboost_tuned")
        or models.get("logistic_regression")
    )


def _engineer_model_features(signals: dict, bundle: dict) -> dict:
    """Map extracted document signals onto the ML feature schema conservatively."""
    signal_scores = {
        key: _clamp_signal_score(signals.get(key, {}).get("score", 0))
        for key in WEIGHTS
    }
    evidence_text = " ".join(
        str(signals.get(key, {}).get("evidence", ""))
        for key in WEIGHTS
    ).lower()

    income_signal = signals.get("income_stability", {})
    declared_income = _safe_float(income_signal.get("declared_income"))
    if declared_income is None:
        declared_income = _scale(signal_scores["income_stability"], 4000, 45000)

    sms_net_monthly = _scale(signal_scores["income_stability"], 1000, 50000)
    gig_payment_inflows = _scale(signal_scores["bill_regularity"], 0, 45000)
    job_app_sessions = round(_scale(100 - signal_scores["income_stability"], 0, 7))
    gig_income_trend = _income_trend_from_signal(signal_scores["income_stability"], evidence_text)

    values = {
        "job_app_sessions_per_week": job_app_sessions,
        "gig_payment_inflows_monthly_inr": gig_payment_inflows,
        "sms_net_monthly_inr": max(0, min(250000, (0.60 * sms_net_monthly) + (0.40 * declared_income))),
        "gender_M": 0,
        "gender_Other": 0,
        "id_type_Aadhaar": 0,
        "id_type_Driving Licence": 0,
        "id_type_Voter ID": 0,
        "gig_income_trend_Declining": 1 if gig_income_trend == "Declining" else 0,
        "gig_income_trend_Growing": 1 if gig_income_trend == "Growing" else 0,
        "gig_income_trend_Stable": 1 if gig_income_trend == "Stable" else 0,
    }

    # Do not infer protected or identity fields from documents unless explicit.
    if "aadhaar" in evidence_text:
        values["id_type_Aadhaar"] = 1
    elif "driving licence" in evidence_text or "driver" in evidence_text:
        values["id_type_Driving Licence"] = 1
    elif "voter" in evidence_text:
        values["id_type_Voter ID"] = 1

    return {column: float(values.get(column, 0)) for column in bundle["feature_columns"]}


def _run_credit_decision_agent(
    signals: dict,
    rule_data: dict,
    ml_data: Optional[dict],
    blended_score: int,
) -> dict:
    """Use deterministic guardrails and optional Claude reasoning for calibration."""
    grade, _ = _grade_for_score(blended_score)
    agent_data = {
        "score_adjustment": _rule_based_adjustment(signals, ml_data),
        "recommendation": _recommendation(grade),
    }

    llm_data = _llm_agent_calibration(signals, rule_data, ml_data, blended_score)
    if not llm_data:
        adjusted_grade, _ = _grade_for_score(blended_score + agent_data["score_adjustment"])
        agent_data["recommendation"] = _recommendation(adjusted_grade)
        return agent_data

    llm_adjustment = int(llm_data.get("score_adjustment", 0))
    rule_adjustment = agent_data["score_adjustment"]
    agent_data["score_adjustment"] = max(
        -MAX_LLM_ADJUSTMENT,
        min(MAX_LLM_ADJUSTMENT, rule_adjustment + llm_adjustment),
    )
    agent_data["recommendation"] = (
        str(llm_data.get("recommendation") or "").strip()
        or agent_data["recommendation"]
    )
    return agent_data


def _rule_based_adjustment(signals: dict, ml_data: Optional[dict]) -> int:
    signal_scores = {
        key: _clamp_signal_score(signals.get(key, {}).get("score", 0))
        for key in WEIGHTS
    }

    adjustment = 0
    if signal_scores["data_completeness"] < 35:
        adjustment -= 15
    if signal_scores["payment_consistency"] < 45:
        adjustment -= 15
    if signal_scores["rental_tenure"] >= 80 and signal_scores["payment_consistency"] >= 70:
        adjustment += 10
    if signal_scores["income_stability"] >= 80 and signal_scores["bill_regularity"] >= 75:
        adjustment += 8

    if ml_data:
        probability_default = ml_data["probability_default"]
        if probability_default >= 0.65:
            adjustment -= 15
        elif probability_default <= 0.25:
            adjustment += 10

    return max(-MAX_LLM_ADJUSTMENT, min(MAX_LLM_ADJUSTMENT, adjustment))


def _llm_agent_calibration(
    signals: dict,
    rule_data: dict,
    ml_data: Optional[dict],
    blended_score: int,
) -> Optional[dict]:
    if os.environ.get("SCORER_LLM_ENABLED", "true").lower() in {"0", "false", "no"}:
        return None
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return None

    try:
        import anthropic
    except Exception:
        return None

    prompt = f"""You are a credit decision agent for an alternative micro-lending score.
Use the rule score, ML default risk score, and evidence signals to make a bounded calibration.

Return ONLY valid JSON:
{{
  "score_adjustment": <integer from -10 to 10>,
  "recommendation": "<one concise frontend-safe recommendation sentence>"
}}

Rules:
- Do not invent facts.
- Keep the recommendation aligned with the final score direction.
- Penalize missing data, weak payment consistency, and high default risk.
- Reward strong consistency only when document completeness is also credible.

Rule score: {rule_data["final_score"]}
ML score: {ml_data["score"] if ml_data else "unavailable"}
ML probability of default: {round(ml_data["probability_default"], 4) if ml_data else "unavailable"}
Initial blended score: {blended_score}
Signals JSON: {json.dumps(signals)[:3000]}
"""

    try:
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=8.0)
        msg = client.messages.create(
            model=os.environ.get("SCORER_LLM_MODEL", "claude-sonnet-4-5"),
            max_tokens=120,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        return _parse_agent_json(raw)
    except Exception:
        return None


def _parse_agent_json(raw: str) -> Optional[dict]:
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        data = json.loads(raw.strip())
    except Exception:
        return None

    adjustment = data.get("score_adjustment", 0)
    try:
        data["score_adjustment"] = max(-10, min(10, int(adjustment)))
    except Exception:
        data["score_adjustment"] = 0
    return data


def _prob_to_score(
    probability_default: float,
    pdo: float = 20,
    base_score: float = 600,
    base_odds: float = 1.0,
    min_score: int = 300,
    max_score: int = 850,
) -> int:
    """Convert default probability to score using the notebook log-odds formula."""
    probability_default = max(1e-6, min(1 - 1e-6, probability_default))
    factor = pdo / math.log(2)
    offset = base_score - factor * math.log(base_odds)
    score = offset - factor * math.log(probability_default / (1 - probability_default))
    return _clamp_score(score, min_score, max_score)


def _income_trend_from_signal(income_score: int, evidence_text: str) -> str:
    if any(word in evidence_text for word in ["declining", "decreasing", "reduced", "falling"]):
        return "Declining"
    if any(word in evidence_text for word in ["growing", "increasing", "rising", "improved"]):
        return "Growing"
    if income_score < 45:
        return "Declining"
    return "Stable"


def _grade_for_score(score: int) -> tuple[str, str]:
    for threshold, grade, color in GRADE_BANDS:
        if score >= threshold:
            return grade, color
    return "Poor", "#ef4444"


def _recommendation(grade: str) -> str:
    return {
        "Exceptional": "Approve with standard terms.",
        "Very Good":   "Approve with standard terms.",
        "Good":        "Approve with minor conditions.",
        "Fair":        "Consider with enhanced review or reduced loan amount.",
        "Poor":        "High risk - recommend decline or additional verification.",
    }.get(grade, "Manual review required.")


def _scale(value: float, low: float, high: float) -> float:
    value = max(0, min(100, value))
    return low + ((value / 100) * (high - low))


def _safe_float(value) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp_signal_score(value) -> int:
    try:
        return int(max(0, min(100, float(value))))
    except (TypeError, ValueError):
        return 0


def _clamp_score(value, min_score: int = 300, max_score: int = 850) -> int:
    return int(max(min_score, min(max_score, round(value))))
