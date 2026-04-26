import os
import asyncio
from pathlib import Path
import httpx

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
# "Rachel" — warm, professional voice
VOICE_ID = "21m00Tcm4TlvDq8ikWAM"
MODEL_ID = "eleven_monolingual_v1"


async def generate_audio(text: str, output_path: Path) -> None:
    """Convert narrative text to speech using ElevenLabs and save to file"""
    if not ELEVENLABS_API_KEY:
        # Create a dummy empty file so the rest of the pipeline doesn't break
        output_path.write_bytes(b"")
        return

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "text": text,
        "model_id": MODEL_ID,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
        },
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        output_path.write_bytes(response.content)
