import os
import asyncio
import json
from pathlib import Path

_db = None


def _get_db():
    """Lazy init — supports both file path (local) and JSON string (Render) credentials."""
    global _db
    if _db is not None:
        return _db

    import firebase_admin
    from firebase_admin import credentials, firestore

    cred = None

    # Option 1 — Render / production: full JSON string in env var
    json_str = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    if json_str:
        try:
            service_account_info = json.loads(json_str)
            cred = credentials.Certificate(service_account_info)
            print("[Firestore] Loaded credentials from FIREBASE_SERVICE_ACCOUNT_JSON")
        except Exception as e:
            print(f"[Firestore] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON: {e}")

    # Option 2 — Local dev: file path
    if cred is None:
        creds_path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH", "")
        if creds_path and Path(creds_path).exists():
            cred = credentials.Certificate(creds_path)
            print(f"[Firestore] Loaded credentials from file: {creds_path}")

    if cred is None:
        print("[Firestore] No credentials found — falling back to local JSON storage")
        return None

    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)

    db_name = os.environ.get("FIRESTORE_DATABASE", "(default)")
    _db = firestore.Client(
        project=firebase_admin.get_app().project_id,
        database=db_name,
    )
    print(f"[Firestore] Connected to database: {db_name}")
    return _db


async def write_to_firestore(applicant_id: str, data: dict):
    """Write score result to Firestore. Falls back to local JSON if not configured."""
    db = _get_db()

    if db is None:
        results_dir = Path("results")
        results_dir.mkdir(exist_ok=True)
        (results_dir / f"{applicant_id}.json").write_text(json.dumps(data, indent=2))
        print(f"[Firestore] Saved locally to results/{applicant_id}.json")
        return

    payload = {k: v for k, v in data.items() if k != "audio_url"}
    payload["status"] = "complete"

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        lambda: db.collection("applicants").document(applicant_id).set(payload)
    )
    print(f"[Firestore] Written applicant {applicant_id}")
