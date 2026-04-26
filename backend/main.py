import os
import json
import asyncio
import uuid
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from extractor import extract_signals
from scorer import calculate_score
from narrator import generate_narrative
from voice import generate_audio
from notifier import send_notifications
from firestore_client import write_to_firestore

load_dotenv()

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


class NotifyRequest(BaseModel):
    applicant_id: str
    email: str
    phone: str
    name: str


@app.get("/health")
async def health():
    return {"status": "ok"}


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
async def score_applicant(applicant_id: str, email: str = "", phone: str = "", name: str = "Applicant"):
    """SSE endpoint — streams pipeline progress to frontend"""
    applicant_dir = UPLOAD_DIR / applicant_id
    if not applicant_dir.exists():
        raise HTTPException(404, "Applicant not found")

    doc_paths = list(applicant_dir.glob("*"))
    if not doc_paths:
        raise HTTPException(400, "No documents found")

    async def pipeline():
        try:
            # Step 1: Gemini extraction
            yield _sse("step", {"step": 1, "label": "Extracting documents with Gemini Vision..."})
            signals = await extract_signals(doc_paths)
            yield _sse("step", {"step": 1, "label": "Documents extracted", "done": True, "signals": signals})

            # Step 2: Score calculation
            yield _sse("step", {"step": 2, "label": "Calculating credit score..."})
            await asyncio.sleep(0.3)
            score_data = calculate_score(signals)
            yield _sse("step", {"step": 2, "label": "Score calculated", "done": True, "score": score_data})

            # Step 3: Claude narrative
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
            }
            await write_to_firestore(applicant_id, result)
            if email:
                await send_notifications(email, phone, name, score_data, narrative)
            yield _sse("step", {"step": 5, "label": "Complete", "done": True})

            # Final result
            yield _sse("result", result)

        except Exception as e:
            yield _sse("error", {"message": str(e)})

    return StreamingResponse(pipeline(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# Serve audio files
from fastapi.staticfiles import StaticFiles
app.mount("/audio", StaticFiles(directory="audio"), name="audio")
