import os
import json
import base64
import asyncio
from pathlib import Path
import google.generativeai as genai
from PIL import Image
import io

genai.configure(api_key=os.environ["GEMINI_API_KEY"])

SYSTEM_PROMPT = """You are a financial document analyst for micro-lending.
You will receive one or more document images: utility bills, phone bills, rental receipts, or income forms.
Analyze each document and extract the following 5 signals as JSON.

Return ONLY valid JSON, no markdown, no preamble:
{
  "payment_consistency": {
    "score": <0-100>,
    "evidence": "<specific observation from documents>",
    "months_available": <number>
  },
  "bill_regularity": {
    "score": <0-100>,
    "evidence": "<specific observation>",
    "months_available": <number>
  },
  "income_stability": {
    "score": <0-100>,
    "evidence": "<specific observation>",
    "declared_income": <number or null>
  },
  "rental_tenure": {
    "score": <0-100>,
    "evidence": "<specific observation>",
    "months_at_address": <number>
  },
  "data_completeness": {
    "score": <0-100>,
    "evidence": "<what documents were provided and their quality>",
    "docs_provided": <number>
  }
}

Scoring guide:
- 90-100: Very strong evidence, consistent, clear
- 70-89: Good evidence, minor gaps
- 50-69: Moderate evidence, some inconsistencies
- 30-49: Weak evidence, significant gaps
- 0-29: Very poor or no evidence

If the image is low quality, crumpled, or partially obscured, do your best and note it in evidence.
If a signal cannot be determined from the documents, score it 0 and explain why.
Be strict — do not inflate scores. Micro-lenders rely on accuracy."""


async def extract_signals(doc_paths: list[Path]) -> dict:
    """Send all documents to Gemini Vision and extract structured signals"""
    model = genai.GenerativeModel("gemini-2.0-flash")

    # Build content parts: all images + the prompt
    parts = []
    for path in doc_paths:
        img_data = _load_image_as_base64(path)
        parts.append({
            "inline_data": {
                "mime_type": _get_mime_type(path),
                "data": img_data
            }
        })

    parts.append({"text": SYSTEM_PROMPT})

    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(None, lambda: model.generate_content(parts))

    raw = response.text.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    signals = json.loads(raw)
    return signals


def _load_image_as_base64(path: Path) -> str:
    img = Image.open(path)
    # Resize if too large to save tokens
    if max(img.size) > 2048:
        img.thumbnail((2048, 2048))
    buf = io.BytesIO()
    fmt = "JPEG" if img.format != "PNG" else "PNG"
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode()


def _get_mime_type(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".pdf": "application/pdf",
    }.get(ext, "image/jpeg")
