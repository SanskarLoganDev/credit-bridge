import os
import json
import base64
import asyncio
from pathlib import Path
from PIL import Image
import io

EXTRACTION_PROMPT = """You are a financial document analyst for micro-lending.
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
    """Route to Gemini or Claude based on AI_PROVIDER env var"""
    provider = os.environ.get("AI_PROVIDER", "gemini").lower()
    if provider == "claude":
        return await _extract_with_claude(doc_paths)
    return await _extract_with_gemini(doc_paths)


async def _extract_with_gemini(doc_paths: list[Path]) -> dict:
    """Extract signals using Gemini Vision"""
    import google.generativeai as genai
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    model = genai.GenerativeModel("gemini-2.0-flash")

    parts = []
    for path in doc_paths:
        img_data = _load_image_as_base64(path)
        parts.append({
            "inline_data": {
                "mime_type": _get_mime_type(path),
                "data": img_data
            }
        })
    parts.append({"text": EXTRACTION_PROMPT})

    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(None, lambda: model.generate_content(parts))
    return _parse_json(response.text)


async def _extract_with_claude(doc_paths: list[Path]) -> dict:
    """Extract signals using Claude Vision"""
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    content = []
    for path in doc_paths:
        img_data = _load_image_as_base64(path)
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": _get_mime_type(path),
                "data": img_data,
            }
        })
    content.append({"type": "text", "text": EXTRACTION_PROMPT})

    loop = asyncio.get_event_loop()

    def _call():
        msg = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1000,
            messages=[{"role": "user", "content": content}]
        )
        return msg.content[0].text

    response = await loop.run_in_executor(None, _call)
    return _parse_json(response)


def _parse_json(raw: str) -> dict:
    """Strip markdown fences if present and parse JSON"""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())


def _load_image_as_base64(path: Path) -> str:
    img = Image.open(path)
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
