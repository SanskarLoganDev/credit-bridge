# CreditBridge

Alternative credit scoring for the unbanked. Upload utility bills, phone bills, or rental receipts — CreditBridge extracts financial signals using AI vision, produces a FICO-style score, writes a plain-English verdict, voices it aloud, and lets you simulate score improvements interactively.

> 1.3 billion adults remain unbanked globally (World Bank Global Findex, 2025). Most have no credit history but do have utility bills, phone bills, and rental receipts. CreditBridge reads those.

---

## Hackathon

**Track:** Business & Finance

### Tools used

**Gemini API**
Used in two ways. First, as the primary document extraction engine — Gemini 2.0 Flash Vision reads uploaded bill and receipt images and extracts structured financial signals (payment consistency, rental tenure, bill regularity, income stability, data completeness) as JSON. It handles real-world document quality: crumpled paper, bad lighting, angled phone photos, documents in any language. Second, we used Google AI Studio with Gemini to generate realistic persona-based test documents — electricity bills, phone bills, rental receipts, and water bills for both Indian and American applicants, with consistent names, addresses, account numbers, and payment histories across each set — used as demo input during the hackathon.

**Antigravity**
Used as the AI-assisted code editor throughout the build. Antigravity accelerated development across the entire codebase — scaffolding FastAPI modules, debugging SSE streaming, building the ML scoring pipeline, iterating on the What If Simulator UI, and reviewing code across different models depending on the task. It was used for both active coding and debugging sessions.

---

## What it does

A loan officer uploads up to 4 document images for an applicant. The system runs a 5-step pipeline streamed live to the dashboard:

1. **Document extraction** — Gemini 2.0 Flash Vision or Claude Vision reads every document and extracts 5 financial signals as structured JSON
2. **Score calculation** — a blended model (rule-based weighted rubric + ML model + Claude calibration) maps signals to a FICO-style score 300–850
3. **Credit narrative** — Claude writes a 3–4 sentence plain-English assessment citing specific evidence from the documents
4. **Voice output** — ElevenLabs TTS voices the narrative aloud (accessibility feature for visually impaired loan officers and applicants)
5. **Save & notify** — result is written to Google Firestore; HTML email sent via SMTP; optional WhatsApp message via Twilio

After scoring, two interactive panels are available:

- **Benchmark view** — compares the applicant's signals against averages from approved and rejected applicants in the training dataset, with score distribution context and similar-applicant profiles
- **What If Simulator** — drag sliders to simulate improved signal scores and see the score change in real time, with Claude-generated guidance on how to actually achieve each improvement

---

## Scoring model

Three layers blended together:

**Layer 1 — Rule-based weighted rubric (60% weight)**

Five signals extracted from documents, each scored 0–100 by the AI vision model:

| Signal | Weight | What it measures |
|---|---|---|
| Payment consistency | 30% | On-time payment history across bills |
| Rental tenure | 25% | Stability — months at current address |
| Bill regularity | 20% | Consistent billing patterns month-to-month |
| Income stability | 15% | Declared or inferable income consistency |
| Data completeness | 10% | Quality and quantity of documents provided |

**Layer 2 — ML risk model (40% weight)**

A trained LightGBM/XGBoost/Logistic Regression ensemble loaded from `backend/model/credit_ml_inference_bundle_v3.joblib`. Converts document signals to engineered features and outputs a probability of default, which is converted to a 300–850 score via a log-odds formula. Falls back to rule-only scoring if the model file is not found.

**Layer 3 — Claude calibration (bounded ±25 points)**

Claude receives the rule score, ML score, and signal evidence and makes a bounded adjustment with a plain-English recommendation. Can be disabled via `SCORER_LLM_ENABLED=false`.

Final score formula: `clamp(blended_score + agent_adjustment, 300, 850)`

Grade bands: Exceptional (800+), Very Good (740+), Good (670+), Fair (580+), Poor (300+)

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, custom CSS |
| Backend | FastAPI (Python), async, Server-Sent Events |
| Document extraction | Gemini 2.0 Flash Vision API (default) or Claude Vision (toggle via env) |
| Credit narrative | Claude claude-sonnet-4-5 |
| What If explanations | Claude claude-sonnet-4-5 |
| Scorer LLM calibration | Claude claude-sonnet-4-5 |
| Voice / accessibility | ElevenLabs TTS — Rachel voice |
| ML scoring model | LightGBM / XGBoost / scikit-learn via joblib |
| Benchmark data | `backend/data/credit_ml_dataset.csv` |
| Real-time sync | Google Cloud Firestore (Native mode) |
| Email notifications | SMTP via Gmail |
| WhatsApp alerts | Twilio WhatsApp sandbox (optional) |

---

## Project structure

```
credit-bridge/
├── .gitignore
├── backend/
│   ├── main.py                              # FastAPI app, all endpoints, SSE pipeline
│   ├── extractor.py                         # Gemini Vision + Claude Vision (togglable)
│   ├── scorer.py                            # Rule + ML + Claude blended scoring
│   ├── benchmark.py                         # Benchmark comparisons from training dataset
│   ├── narrator.py                          # Claude narrative generation
│   ├── voice.py                             # ElevenLabs TTS
│   ├── notifier.py                          # SMTP email + Twilio WhatsApp
│   ├── firestore_client.py                  # GCP Firestore write (lazy init)
│   ├── requirements.txt
│   ├── data/
│   │   └── credit_ml_dataset.csv            # Benchmark dataset
│   └── model/
│       ├── credit_ml_inference_bundle_v3.joblib
│       └── credit_ml_inference_metadata_v3.json
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        └── components/
            ├── UploadPage.jsx               # Drag-drop upload, applicant form
            └── Dashboard.jsx               # SSE stepper, score ring, signal bars,
                                            # audio player, benchmark view, what-if simulator
```

---

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check, returns active AI provider |
| POST | `/upload` | Upload document files, returns `applicant_id` |
| GET | `/score/{applicant_id}` | SSE stream — runs full pipeline, emits step events + final result |
| GET | `/audio/{filename}` | Serve generated ElevenLabs audio file |
| POST | `/what-if` | Recalculate score with simulated signal overrides (fast, no LLM) |
| POST | `/what-if/explain` | Claude explanation for how to improve a specific signal |

### SSE event types from `/score`

```
event: step    — pipeline progress { step, label, done?, signals?, score? }
event: result  — full payload { applicant_id, name, score, signals, narrative, audio_url, benchmark_context }
event: error   — { message }
```

---

## Environment variables

Create `backend/.env` from the table below:

```env
# ── AI Provider toggle ────────────────────
# Options: "gemini" or "claude"
AI_PROVIDER=gemini

# ── AI APIs ──────────────────────────────
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=

# ── Google Cloud / Firestore ──────────────
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
FIRESTORE_DATABASE=credit-bridge

# ── Scorer options ────────────────────────
SCORER_LLM_ENABLED=true        # set to "false" to skip Claude calibration
SCORER_LLM_MODEL=claude-sonnet-4-5

# ── Benchmark data ────────────────────────
# Optional override — defaults to backend/data/credit_ml_dataset.csv
BENCHMARK_DATA_PATH=

# ── Email (Gmail) ─────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=your_16_char_app_password   # Gmail App Password from myaccount.google.com/apppasswords

# ── Twilio WhatsApp (optional) ────────────
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

Frontend `frontend/.env`:

```env
VITE_API_URL=http://localhost:8000
```

---

## Running locally

**Backend**
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Verify: `http://localhost:8000/health` → `{"status":"ok","ai_provider":"gemini"}`

**Frontend**
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

---

## Firestore setup

1. Create a GCP project, enable Firestore in **Native mode**
2. IAM & Admin → Service Accounts → create account with **Cloud Datastore User** role
3. Download JSON key → rename to `firebase-service-account.json` → place in `backend/`
4. Set `FIRESTORE_DATABASE` in `.env` to match your Firestore database ID

If Firestore is not configured, results fall back to `backend/results/{applicant_id}.json` automatically.

---

## AI provider toggle

Switch between Gemini and Claude for document extraction:

```env
AI_PROVIDER=gemini   # Gemini 2.0 Flash Vision
AI_PROVIDER=claude   # Claude claude-sonnet-4-5 Vision
```

The narrative, What If explanations, and scorer calibration always use Claude regardless of this setting.

---

## Feature availability by API key

| Feature | Required keys | Graceful fallback |
|---|---|---|
| Document extraction (Gemini) | `GEMINI_API_KEY` | Switch to `AI_PROVIDER=claude` |
| Document extraction (Claude) | `ANTHROPIC_API_KEY` | Switch to `AI_PROVIDER=gemini` |
| Credit narrative | `ANTHROPIC_API_KEY` | None — core feature |
| ML scoring | None — model file in repo | Falls back to rule-only scoring |
| Claude score calibration | `ANTHROPIC_API_KEY` | Skipped, rule score used |
| What If Simulator | None | Always available (rule-only fast path) |
| What If explanations | `ANTHROPIC_API_KEY` | Generic fallback message shown |
| Benchmark view | `data/credit_ml_dataset.csv` | Button hidden if data not found |
| Voice output | `ELEVENLABS_API_KEY` | Skipped silently, no audio button shown |
| Email report | `SMTP_USER` + `SMTP_PASS` | Skipped silently |
| WhatsApp alert | `TWILIO_*` | Skipped silently |
| Firestore sync | `firebase-service-account.json` | Falls back to local JSON in `results/` |

---

## Accepted document types

- Utility bills (electricity, water, gas)
- Phone bills (mobile or landline)
- Rental receipts or lease agreements
- Income forms (self-reported)

Formats: JPG, PNG, WebP, PDF. Phone photos of crumpled or low-light documents are handled — the vision model notes quality issues in the evidence field.

---

## Terminal logging

All pipeline steps print prefixed logs to the backend terminal for debugging:

```
[Scorer]    Rule score: 642 (Good)
[Scorer]    ML model: lightgbm_tuned | P(default)=0.3821 | ML score=589
[Scorer]    Blended score: 621
[Scorer]    LLM calibration: adjustment=+5
[Scorer]    Agent adjustment: +15 → final score: 636
[Benchmark] Loaded dataset from: ...backend\data\credit_ml_dataset.csv
[Firestore] Loaded credentials from file: ...firebase-service-account.json
[Firestore] Connected — project: credit-bridge-494514, db: credit-bridge
[Email]     Sent to applicant@email.com
[WhatsApp]  Sent — SID: SMxxxx, Status: queued
```
