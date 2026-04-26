# CreditBridge

CreditBridge is an AI-powered alternative credit scoring system built for the 1.3 billion unbanked adults who are invisible to traditional finance. By turning everyday documents utility bills, phone bills, and rental receipts into actionable financial signals, it replaces missing credit history with real-world behavioral data. Using a hybrid of machine learning, rules, and AI reasoning, CreditBridge delivers an explainable credit score, a human-like decision narrative, and real-time “what-if” insights empowering lenders to make faster, fairer, and more inclusive credit decisions

---

## What it does

A loan officer uploads up to 4 document images for an applicant. A 5-step pipeline streams live to the dashboard:

1. **Document extraction** — Gemini 2.0 Flash Vision (or Claude Vision) reads every document and extracts 5 financial signals as structured JSON
2. **Score calculation** — a three-layer hybrid model (rule-based rubric + exported ML risk model + Claude LLM calibration agent) maps signals to a FICO-style score from 300 to 850
3. **Credit narrative** — Claude writes a 3–4 sentence plain-English assessment citing specific evidence from the documents
4. **Voice output** — ElevenLabs TTS voices the narrative aloud (accessibility feature for visually impaired loan officers)
5. **Save & notify** — result is written to Google Cloud Firestore; an HTML email report and a WhatsApp message are sent to the applicant

After scoring, the loan officer has three interactive panels:

- **Signal breakdown** — per-signal scores with extracted evidence text
- **Benchmark data** — applicant compared against an approved/rejected cohort from a real ML dataset, with score distribution percentiles and a similar-approved-profile summary
- **What If Simulator** — interactive sliders to adjust any signal score and instantly see the simulated score delta, with per-signal Claude explanations of what real-world action achieves the target value

---

## Scoring model

### Signal extraction

Five signals extracted from documents, each scored 0–100 by the AI vision model:

| Signal | Weight | What it measures |
|---|---|---|
| Payment consistency | 30% | On-time payment history across utility and phone bills |
| Rental tenure | 25% | Stability — consecutive months at current address |
| Bill regularity | 20% | Consistent billing patterns and low variance month-to-month |
| Income stability | 15% | Declared or inferable income consistency |
| Data completeness | 10% | Quality and quantity of documents provided |

### Three-layer hybrid score

```
Rule score      (deterministic weighted rubric)   → 300–850
ML score        (LightGBM/XGBoost default risk)   → 300–850
Blended score   = 60% rule + 40% ML

Claude agent    (bounded calibration, ±25 pts)
  - Rule-based adjustments for edge cases
  - LLM reasoning over signals, rule score, and ML default probability

Final score     = clamp(blended + agent adjustment, 300, 850)
```

Grade bands: Exceptional (800+), Very Good (740+), Good (670+), Fair (580+), Poor (300+)

The ML model (`credit_ml_inference_bundle_v3.joblib`) was trained on a 1000-row synthetic micro-lending dataset and exports LightGBM, XGBoost, and Logistic Regression models. The best performer is selected automatically at runtime.

### What If fast path

The `/what-if` endpoint uses `calculate_score_fast()` — rule + ML blend only, no LLM call — so slider recalculation responds in under 100 ms without burning API quota.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, inline CSS (no UI library) |
| Backend | FastAPI (Python 3.11+), async, Server-Sent Events |
| Document extraction | Gemini 2.0 Flash Vision (default) or Claude Vision (env toggle) |
| ML risk model | LightGBM / XGBoost / Logistic Regression (joblib bundle, v3) |
| Credit narrative & agent | Claude claude-sonnet-4-5 — narrative, LLM score calibration, What If explanations |
| Voice / accessibility | ElevenLabs TTS — Rachel voice |
| Real-time persistence | **Google Cloud Firestore** (Native mode, named database) |
| Email notifications | SMTP via Gmail — full HTML report |
| WhatsApp notifications | **Twilio WhatsApp** — score summary sent to applicant's phone on completion |
| Benchmark data | `credit_ml_dataset.csv` — 10k-row cohort for signal and score distribution comparisons |
| AI-assisted development | **Google Antigravity** — used for coding assistance and bug fixes throughout development |
| Deployment | Render (backend web service + static frontend site) |

---

## Project structure

```
credit-bridge/
├── README.md
├── render.yaml
├── backend/
│   ├── main.py               # FastAPI app — all endpoints, SSE pipeline, what-if endpoints
│   ├── extractor.py          # Gemini Vision + Claude Vision extraction (env-togglable)
│   ├── scorer.py             # Hybrid scorer: rule rubric + ML model + Claude agent
│   │                         #   calculate_score()       — full pipeline with LLM calibration
│   │                         #   calculate_score_fast()  — rule + ML only, for real-time what-if
│   ├── benchmark.py          # Benchmark context builder — signal comparison, score distribution,
│   │                         #   similar approved profile (reads credit_ml_dataset.csv)
│   ├── narrator.py           # Claude narrative generation
│   ├── voice.py              # ElevenLabs TTS
│   ├── notifier.py           # SMTP email (HTML report) + Twilio WhatsApp
│   ├── firestore_client.py   # Google Cloud Firestore write (lazy init, named DB support)
│   ├── model/
│   │   ├── credit_ml_inference_bundle_v3.joblib   # exported ML models
│   │   ├── credit_ml_inference_metadata_v3.json   # feature columns, score config, model name
│   │   └── credit_ml_dataset.csv                  # 10k-row benchmark cohort
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        └── components/
            ├── UploadPage.jsx    # Drag-drop upload, applicant form (name, email, WhatsApp)
            └── Dashboard.jsx     # SSE stepper, score ring, signal bars, audio player,
                                  # benchmark panel, What If Simulator
```

---

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check — returns active AI provider |
| POST | `/upload` | Upload document files, returns `applicant_id` |
| GET | `/score/{applicant_id}` | SSE stream — runs full 5-step pipeline, emits step events + final result |
| GET | `/audio/{filename}` | Serve generated ElevenLabs MP3 |
| POST | `/what-if` | Recalculate score with simulated signal overrides (fast, no LLM) |
| POST | `/what-if/explain` | Claude explanation of how to achieve a simulated signal score |

### SSE event types from `/score/{applicant_id}`

```
event: step   — { step, label, done?, signals?, score? }
event: result — { applicant_id, name, score, signals, narrative, audio_url, benchmark_context }
event: error  — { message }
```

### `/what-if` request / response

```json
// POST /what-if
{
  "signals": { ...original extracted signals... },
  "simulated_overrides": { "income_stability": 70, "data_completeness": 80 }
}

// Response
{
  "original_score": 643,
  "simulated_score": 671,
  "grade": "Good",
  "grade_color": "#eab308",
  "delta": 28,
  "signal_scores": { "income_stability": 70, ... }
}
```

### `/what-if/explain` request / response

```json
// POST /what-if/explain
{ "signal_key": "income_stability", "current_value": 0, "target_value": 70 }

// Response
{ "explanation": "Upload a salary slip or 3 months of bank statements showing regular deposits..." }
```

---

## Environment variables

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
# AI provider for document extraction: "gemini" (default) or "claude"
AI_PROVIDER=gemini

# API keys
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=

# Google Cloud Firestore
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
FIRESTORE_DATABASE=credit-bridge          # your Firestore database ID (not "(default)")

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=                                # Gmail App Password

# Twilio WhatsApp
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Scorer options (optional)
SCORER_LLM_ENABLED=true                   # set to "false" to skip Claude agent calibration
SCORER_LLM_MODEL=claude-sonnet-4-5
BENCHMARK_DATA_PATH=                      # override path to benchmark CSV (optional)
```

Frontend `.env`:
```env
VITE_API_URL=http://localhost:8000
```

---

## Running locally

**Backend**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # macOS / Linux
.venv\Scripts\activate          # Windows
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

## Google Cloud setup

### Firestore

CreditBridge uses **Google Cloud Firestore** (Native mode) to persist every scored applicant in the `applicants` collection. Each document stores the full result payload signals, score breakdown, narrative, benchmark context keyed by `applicant_id`.

1. Create a GCP project and enable **Cloud Firestore** in **Native mode**
2. In IAM & Admin → Service Accounts, create a service account with the **Cloud Datastore User** role
3. Download the JSON key, rename it `firebase-service-account.json`, place it in `backend/`
4. Set `FIRESTORE_DATABASE` in `.env` to your Firestore database ID

If Firestore is not configured, results fall back silently to `backend/results/{applicant_id}.json`.

### Google Antigravity

Development of CreditBridge used **Google Antigravity** for AI-assisted coding and bug fixing including building out the ML model training pipeline, the hybrid scorer architecture, benchmark data analysis, and frontend component iteration.

---

## WhatsApp notifications

When a phone number is provided at upload time, CreditBridge sends the applicant a WhatsApp message via **Twilio** on scoring completion:

```
*CreditBridge Assessment*

Applicant: James Howlett
Score: *671/850* (Good)
Verdict: Approve with minor conditions.

Full report has been sent to your email.
```

The message is sent in parallel with the email using `asyncio.gather`. If Twilio credentials are not configured, this step is silently skipped and it does not block scoring.

---

## AI provider toggle

Switch between Gemini and Claude for document extraction via a single env var:

```env
AI_PROVIDER=gemini   # Gemini 2.0 Flash Vision (default, faster)
AI_PROVIDER=claude   # Claude claude-sonnet-4-5 Vision
```

The credit narrative, Claude agent calibration, and What If explanations always use Claude regardless of this setting.

---

## Feature availability by API key

| Feature | Required keys | Graceful fallback |
|---|---|---|
| Document extraction (Gemini) | `GEMINI_API_KEY` | Switch to Claude |
| Document extraction (Claude) | `ANTHROPIC_API_KEY` | Switch to Gemini |
| Credit narrative | `ANTHROPIC_API_KEY` | None — core feature |
| ML score layer | bundled `.joblib` file | Falls back to rule score only |
| Claude agent calibration | `ANTHROPIC_API_KEY` + `SCORER_LLM_ENABLED=true` | Skipped, rule+ML blend used |
| What If Simulator | None (uses fast scorer) | Always available post-scoring |
| What If explanations | `ANTHROPIC_API_KEY` | Returns a static fallback message |
| Voice output | `ELEVENLABS_API_KEY` | Skipped silently, no audio button shown |
| Email report | `SMTP_USER` + `SMTP_PASS` | Skipped silently |
| WhatsApp alert | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | Skipped silently |
| Firestore sync | `FIREBASE_SERVICE_ACCOUNT_PATH` | Falls back to `results/*.json` |
| Benchmark panel | `credit_ml_dataset.csv` in `model/` | Panel hidden automatically |

---

## Accepted document types

- Utility bills (electricity, water, gas)
- Phone bills (mobile or landline)
- Rental receipts or lease agreements
- Income forms (self-reported)

Formats: JPG, PNG, WebP, PDF up to 4 files per submission. Phone photos of crumpled or low-light documents are handled gracefully; Gemini Vision notes quality issues in the evidence field.
