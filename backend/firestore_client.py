import os
import asyncio
import json
from pathlib import Path

FIREBASE_CREDS = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", "")
USE_FIRESTORE = bool(FIREBASE_CREDS and Path(FIREBASE_CREDS).exists())

if USE_FIRESTORE:
    import firebase_admin
    from firebase_admin import credentials, firestore
    if not firebase_admin._apps:
        cred = credentials.Certificate(FIREBASE_CREDS)
        firebase_admin.initialize_app(cred)
    db = firestore.client()
else:
    db = None


async def write_to_firestore(applicant_id: str, data: dict):
    """Write score result to Firestore. Falls back to local JSON if not configured."""
    if db is None:
        # Local fallback — save to results/ folder
        results_dir = Path("results")
        results_dir.mkdir(exist_ok=True)
        (results_dir / f"{applicant_id}.json").write_text(json.dumps(data, indent=2))
        return

    # Firestore write — strip audio_url from Firestore (it's a local path)
    payload = {k: v for k, v in data.items() if k != "audio_url"}
    payload["status"] = "complete"

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: db.collection("applicants").document(applicant_id).set(payload))
