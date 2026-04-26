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


def calculate_score(signals: dict) -> dict:
    """Apply weighted rubric to signals, produce FICO-style 300-850 score"""
    weighted_sum = 0.0
    total_weight = 0.0

    signal_scores = {}
    for key, weight in WEIGHTS.items():
        sig = signals.get(key, {})
        raw = sig.get("score", 0)
        clamped = max(0, min(100, raw))
        signal_scores[key] = clamped
        weighted_sum += clamped * weight
        total_weight += weight

    normalized = weighted_sum / total_weight if total_weight else 0
    # Scale to 300-850
    final_score = int(300 + (normalized / 100) * 550)
    final_score = max(300, min(850, final_score))

    grade, color = "Poor", "#ef4444"
    for threshold, g, c in GRADE_BANDS:
        if final_score >= threshold:
            grade, color = g, c
            break

    return {
        "final_score": final_score,
        "grade": grade,
        "grade_color": color,
        "signal_scores": signal_scores,
        "normalized_pct": round(normalized, 1),
        "recommendation": _recommendation(grade),
    }


def _recommendation(grade: str) -> str:
    return {
        "Exceptional": "Approve with standard terms.",
        "Very Good":   "Approve with standard terms.",
        "Good":        "Approve with minor conditions.",
        "Fair":        "Consider with enhanced review or reduced loan amount.",
        "Poor":        "High risk — recommend decline or additional verification.",
    }.get(grade, "Manual review required.")
