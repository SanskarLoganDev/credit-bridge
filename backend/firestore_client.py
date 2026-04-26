import os
import asyncio
import json
from pathlib import Path

_db = None


def _get_db():
    """Lazy init — only runs after load_dotenv() has populated env vars"""
    global _db
    if _db is not None:
        return _db

    creds_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", "")
    if not creds_path or not Path(creds_path).exists():
        return None

    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        cred = credentials.Certificate(creds_path)
        firebase_admin.initialize_app(cred)

    # Pass the database name explicitly — required when db is not named "(default)"
    db_name = os.environ.get("FIRESTORE_DATABASE", "(default)")
    _db = firestore.Client(
        project=firebase_admin.get_app().project_id,
        database=db_name,
    )
    return _db


async def write_to_firestore(applicant_id: str, data: dict):
    """Write score result to Firestore. Falls back to local JSON if Firestore not configured."""
    db = _get_db()

    if db is None:
        results_dir = Path("results")
        results_dir.mkdir(exist_ok=True)
        (results_dir / f"{applicant_id}.json").write_text(json.dumps(data, indent=2))
        print(f"[Firestore] Not configured — saved locally to results/{applicant_id}.json")
        return

    payload = {k: v for k, v in data.items() if k != "audio_url"}
    payload["status"] = "complete"

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: db.collection("applicants").document(applicant_id).set(payload)
    )
    print(f"[Firestore] Written applicant {applicant_id}")
