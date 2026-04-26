import csv
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional


SIGNAL_LABELS = {
    "payment_consistency": "Payment consistency",
    "rental_tenure": "Rental tenure",
    "bill_regularity": "Bill regularity",
    "income_stability": "Income stability",
    "data_completeness": "Data completeness",
}

DEFAULT_BENCHMARK_PATHS = [
    Path(__file__).resolve().parent / "model" / "credit_ml_dataset.csv",
    Path("/Users/kritishahi/Documents/credit_score_ml/credit_ml_dataset.csv"),
]

SCORE_BANDS = [
    {"label": "750-850", "name": "Excellent", "min": 750, "max": 850},
    {"label": "670-749", "name": "Good", "min": 670, "max": 749},
    {"label": "580-669", "name": "Fair", "min": 580, "max": 669},
    {"label": "300-579", "name": "Poor", "min": 300, "max": 579},
]


def build_benchmark_context(signals: dict, score_data: dict) -> dict:
    """Build dashboard comparison data from the benchmark CSV."""
    rows = _load_rows()
    if not rows:
        return {}

    applicant_score = int(score_data.get("final_score", 0))
    approved_rows = [row for row in rows if _boolish(row.get("loan_approved"))]
    rejected_rows = [row for row in rows if not _boolish(row.get("loan_approved"))]
    similar_rows = _similar_approved_rows(approved_rows, applicant_score)

    return {
        "source": "credit_ml_dataset.csv",
        "signal_comparison": _signal_comparison(signals, approved_rows, rejected_rows),
        "score_distribution": _score_distribution(rows, applicant_score, score_data.get("grade", "")),
        "similar_approved_profile": _similar_approved_profile(similar_rows),
    }


@lru_cache(maxsize=1)
def _load_rows() -> tuple:
    configured_path = os.environ.get("BENCHMARK_DATA_PATH", "").strip()
    benchmark_paths = ([Path(configured_path)] if configured_path else []) + DEFAULT_BENCHMARK_PATHS
    data_path = next((path for path in benchmark_paths if path.exists() and path.is_file()), None)
    if not data_path:
        return tuple()

    try:
        with data_path.open(newline="") as f:
            return tuple(csv.DictReader(f))
    except Exception:
        return tuple()


def _signal_comparison(signals: dict, approved_rows: list, rejected_rows: list) -> list:
    rows = []
    for key, label in SIGNAL_LABELS.items():
        applicant_value = _clamp_score(signals.get(key, {}).get("score", 0))
        approved_avg = _avg([_benchmark_signal_score(row, key) for row in approved_rows])
        rejected_avg = _avg([_benchmark_signal_score(row, key) for row in rejected_rows])
        rows.append({
            "key": key,
            "label": label,
            "applicant": applicant_value,
            "approved_avg": approved_avg,
            "rejected_avg": rejected_avg,
        })
    return rows


def _score_distribution(rows: tuple, applicant_score: int, grade: str) -> dict:
    total = len(rows)
    bands = []
    for band in SCORE_BANDS:
        count = sum(
            1 for row in rows
            if band["min"] <= _num(row.get("credit_score"), 0) <= band["max"]
        )
        bands.append({
            "label": f"{band['label']} ({band['name']})",
            "percent": round((count / total) * 100) if total else 0,
            "is_current": band["min"] <= applicant_score <= band["max"],
        })

    percentile = _percentile_rank([_num(row.get("credit_score"), 0) for row in rows], applicant_score)
    return {
        "bands": bands,
        "current_tier": grade or _band_name(applicant_score),
        "percentile": percentile,
    }


def _similar_approved_profile(rows: list) -> dict:
    if not rows:
        return {}

    avg_loan_amount = _avg([_num(row.get("loan_amount_eligible_inr")) for row in rows])
    avg_credit_score = _avg([_num(row.get("credit_score")) for row in rows])
    default_rate = _avg([_num(row.get("default_label")) for row in rows])
    median_income = _median([_num(row.get("declared_monthly_income_inr")) for row in rows])

    return {
        "sample_size": len(rows),
        "avg_loan_amount": round(avg_loan_amount),
        "avg_credit_score": round(avg_credit_score),
        "default_rate": round(default_rate * 100, 1),
        "median_declared_income": round(median_income),
    }


def _similar_approved_rows(approved_rows: list, applicant_score: int) -> list:
    similar = [
        row for row in approved_rows
        if abs(_num(row.get("credit_score"), 0) - applicant_score) <= 40
    ]
    return similar if len(similar) >= 10 else approved_rows


def _benchmark_signal_score(row: dict, key: str) -> int:
    if key == "payment_consistency":
        delay_scores = [
            _delay_to_score(row.get("elec_payment_delay_days")),
            _delay_to_score(row.get("water_gas_payment_delay_days")),
        ]
        return round(_avg([score for score in delay_scores if score is not None]))

    if key == "rental_tenure":
        tenure = max(
            _num(row.get("rent_receipt_streak_months"), 0),
            _num(row.get("rental_agreement_tenure_months"), 0),
        )
        return _clamp_score((tenure / 24) * 100)

    if key == "bill_regularity":
        variance = _num(row.get("elec_bill_variance_pct"))
        variance_score = _clamp_score(100 - (variance * 180))
        sms_score = _clamp_score(_num(row.get("sms_credit_regularity_score")) * 100)
        return round((variance_score + sms_score) / 2)

    if key == "income_stability":
        return _clamp_score(row.get("income_score_0_100"))

    if key == "data_completeness":
        return _clamp_score(row.get("document_score_0_100"))

    return 0


def _delay_to_score(value) -> Optional[int]:
    if value in ("", None):
        return None
    delay = max(0, _num(value))
    return _clamp_score(100 - ((min(delay, 30) / 30) * 100))


def _avg(values: list) -> float:
    clean = [value for value in values if value is not None]
    return sum(clean) / len(clean) if clean else 0


def _median(values: list) -> float:
    clean = sorted(value for value in values if value is not None)
    if not clean:
        return 0
    mid = len(clean) // 2
    if len(clean) % 2:
        return clean[mid]
    return (clean[mid - 1] + clean[mid]) / 2


def _percentile_rank(scores: list, applicant_score: int) -> int:
    clean = [score for score in scores if score]
    if not clean:
        return 0
    below_or_equal = sum(1 for score in clean if score <= applicant_score)
    return round((below_or_equal / len(clean)) * 100)


def _band_name(score: int) -> str:
    for band in SCORE_BANDS:
        if band["min"] <= score <= band["max"]:
            return band["name"]
    return "Manual review"


def _boolish(value) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "approved"}


def _num(value, default=None):
    try:
        if value in ("", None):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _clamp_score(value) -> int:
    try:
        return int(max(0, min(100, round(float(value)))))
    except (TypeError, ValueError):
        return 0
