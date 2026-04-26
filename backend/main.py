import os
import json
import asyncio
import uuid
from pathlib import Path

# load_dotenv MUST run before importing any module that reads env vars at import time
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from extractor import extract_signals
from scorer import calculate_score, calculate_score_fast
from benchmark import build_benchmark_context
from narrator import generate_narrative
from voice import generate_audio
from notifier import send_notifications
from firestore_client import write_to_firestore

app = FastAPI(title="CreditBridge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
AUDIO_DIR = Path("audio")
AUDIO_DIR.mkdir(exist_ok=True)


@app.get("/health")
async def health():
    provider = os.environ.get("AI_PROVIDER", "gemini")
    return {"status": "ok", "ai_provider": provider}


@app.post("/upload")
async def upload_docs(files: list[UploadFile] = File(...)):
    """Save uploaded docs locally, return applicant_id"""
    applicant_id = str(uuid.uuid4())[:8]
    applicant_dir = UPLOAD_DIR / applicant_id
    applicant_dir.mkdir()

    saved = []
    for f in files:
        if not f.content_type.startswith(("image/", "application/pdf")):
            raise HTTPException(400, f"Unsupported file type: {f.content_type}")
        dest = applicant_dir / f.filename
        dest.write_bytes(await f.read())
        saved.append(str(dest))

    return {"applicant_id": applicant_id, "files_saved": len(saved)}


@app.get("/score/{applicant_id}")
async def score_applicant(applicant_id: str, email: str, phone: str = "", name: str = "Applicant"):
    """SSE endpoint — streams pipeline progress to frontend"""
    applicant_dir = UPLOAD_DIR / applicant_id
    if not applicant_dir.exists():
        raise HTTPException(404, "Applicant not found")

    doc_paths = list(applicant_dir.glob("*"))
    if not doc_paths:
        raise HTTPException(400, "No documents found")

    async def pipeline():
        try:
            provider = os.environ.get("AI_PROVIDER", "gemini").upper()

            # Step 1: extraction
            yield _sse("step", {"step": 1, "label": f"Extracting documents with {provider} Vision..."})
            signals = await extract_signals(doc_paths)
            yield _sse("step", {"step": 1, "label": "Documents extracted", "done": True, "signals": signals})

            # Step 2: Score calculation
            yield _sse("step", {"step": 2, "label": "Calculating credit score..."})
            await asyncio.sleep(0.3)
            score_data = calculate_score(signals)
            benchmark_context = build_benchmark_context(signals, score_data)
            yield _sse("step", {"step": 2, "label": "Score calculated", "done": True, "score": score_data})

            # Step 3: Claude narrative (always Claude regardless of AI_PROVIDER)
            yield _sse("step", {"step": 3, "label": "Writing credit narrative with Claude..."})
            narrative = await generate_narrative(score_data, signals, name)
            yield _sse("step", {"step": 3, "label": "Narrative written", "done": True})

            # Step 4: ElevenLabs voice
            yield _sse("step", {"step": 4, "label": "Generating voice with ElevenLabs..."})
            audio_filename = f"{applicant_id}.mp3"
            audio_path = AUDIO_DIR / audio_filename
            await generate_audio(narrative, audio_path)
            audio_url = f"/audio/{audio_filename}"
            yield _sse("step", {"step": 4, "label": "Voice generated", "done": True})

            # Step 5: Firestore + notifications
            yield _sse("step", {"step": 5, "label": "Saving results and sending notifications..."})
            result = {
                "applicant_id": applicant_id,
                "name": name,
                "score": score_data,
                "signals": signals,
                "narrative": narrative,
                "audio_url": audio_url,
                "benchmark_context": benchmark_context,
            }
            await write_to_firestore(applicant_id, result)
            if email:
                await send_notifications(email, phone, name, score_data, narrative)
            yield _sse("step", {"step": 5, "label": "Complete", "done": True})

            yield _sse("result", result)

        except Exception as e:
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(
        pipeline(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ── What If Simulator ─────────────────────────────────────────────────────────

class WhatIfRequest(BaseModel):
    signals: dict
    simulated_overrides: dict  # signal_key -> simulated score 0-100


class WhatIfExplainRequest(BaseModel):
    signal_key: str
    current_value: int
    target_value: int


_SIGNAL_IMPROVE_CONTEXT = {
    "payment_consistency": (
        "evidence of on-time payments for utility bills (electricity, water, gas). "
        "The extractor looks for payment dates, delay patterns, and consistency over months."
    ),
    "rental_tenure": (
        "rental receipts showing continuous tenancy. "
        "The extractor looks for consecutive months at the same address and the rental agreement length."
    ),
    "bill_regularity": (
        "regular monthly bills with low variance in amounts. "
        "The extractor checks whether bills arrive consistently and amounts are stable month to month."
    ),
    "income_stability": (
        "income documentation such as salary slips, bank statements, or gig payment records. "
        "The extractor looks for declared income amounts and the regularity of deposits."
    ),
    "data_completeness": (
        "comprehensive, legible documents covering multiple signals. "
        "The extractor rewards well-scanned, recent documents that clearly show account details."
    ),
}


@app.post("/what-if")
async def what_if_score(req: WhatIfRequest):
    """Recalculate credit score with simulated signal overrides (no LLM, fast path)."""
    simulated_signals = {
        key: (dict(val) if isinstance(val, dict) else val)
        for key, val in req.signals.items()
    }
    for key, sim_score in req.simulated_overrides.items():
        if key not in simulated_signals or not isinstance(simulated_signals[key], dict):
            simulated_signals[key] = {}
        simulated_signals[key]["score"] = int(sim_score)

    original = calculate_score_fast(req.signals)
    simulated = calculate_score_fast(simulated_signals)
    delta = simulated["final_score"] - original["final_score"]

    return {
        "original_score": original["final_score"],
        "simulated_score": simulated["final_score"],
        "grade": simulated["grade"],
        "grade_color": simulated["grade_color"],
        "delta": delta,
        "signal_scores": simulated["signal_scores"],
    }


@app.post("/what-if/explain")
async def what_if_explain(req: WhatIfExplainRequest):
    """Return a plain-language explanation of how to achieve a simulated signal score."""
    explanation = await _generate_what_if_explanation(
        req.signal_key, req.current_value, req.target_value
    )
    return {"explanation": explanation}


async def _generate_what_if_explanation(signal_key: str, current: int, target: int) -> str:
    context = _SIGNAL_IMPROVE_CONTEXT.get(signal_key, "relevant financial documents.")
    label = signal_key.replace("_", " ")

    prompt = (
        f"You are a helpful loan officer giving practical advice to an applicant.\n"
        f"Their {label} score needs to move from {current}/100 to approximately {target}/100.\n"
        f"This signal measures: {context}\n\n"
        f"In exactly 2 sentences, name the specific document or action that would achieve "
        f"a score of about {target}/100 for this signal. "
        f"Do not mention numerical scores. Be concrete and actionable."
    )

    loop = asyncio.get_event_loop()

    def _call() -> str:
        try:
            import anthropic as _anthropic
            c = _anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""), timeout=8.0)
            msg = c.messages.create(
                model=os.environ.get("SCORER_LLM_MODEL", "claude-sonnet-4-5"),
                max_tokens=120,
                messages=[{"role": "user", "content": prompt}],
            )
            return msg.content[0].text.strip()
        except Exception:
            return (
                f"To improve {label.title()}, provide clear and recent documents "
                f"demonstrating consistent {label} over several months."
            )

    return await loop.run_in_executor(None, _call)


app.mount("/audio", StaticFiles(directory="audio"), name="audio")
