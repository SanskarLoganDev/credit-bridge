# CreditBridge

Alternative credit scoring for the unbanked. Upload utility bills, phone bills, or rental receipts — CreditBridge extracts financial signals using AI vision, produces a FICO-style score, writes a plain-English verdict, and voices it aloud.

> 1.3 billion adults remain unbanked globally (World Bank Global Findex 2025). Most have no credit history but do have utility bills, phone bills, and rental receipts. CreditBridge reads those.

---

## What it does

A loan officer uploads up to 4 document images for an applicant. The system runs a 5-step pipeline streamed live to the dashboard:

1. **Document extraction** — Gemini 2.0 Flash Vision (or Claude) reads every document and extracts 5 financial signals as structured JSON
2. **Score calculation** — a weighted rubric maps the signals to a FICO-style score from 300 to 850
3. **Credit narrative** — Claude writes a 3–4 sentence plain-English assessment citing specific evidence from the documents
4. **Voice output** — ElevenLabs TTS voices the narrative aloud (accessibility feature for visually impaired loan officers)
5. **Save & notify** — result is written to Google Firestore; an HTML email report is sent to the applicant

---

## Scoring model

Five signals extracted from documents, each scored 0–100 by the AI vision model:

| Signal | Weight | What it measures |
|---|---|---|
| Payment consistency | 30% | On-time payment history across bills |
| Rental tenure | 25% | Stability — months at current address |
| Bill regularity | 20% | Consistent billing patterns month-to-month |
| Income stability | 15% | Declared or inferable income consistency |
| Data completeness | 10% | Quality and quantity of documents provided |

Final score formula: `300 + (weighted_average / 100) × 550`

Grade bands: Exceptional (800+), Very Good (740+), Good (670+), Fair (580+), Poor (300+)

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, custom CSS (no UI library) |
| Backend | FastAPI (Python), async, Server-Sent Events |
| Document extraction | Gemini 2.0 Flash Vision API (default) or Claude Vision (toggle via env) |
| Credit narrative | Claude claude-sonnet-4-5 (always used for narrative regardless of extraction provider) |
| Voice / accessibility | ElevenLabs TTS — Rachel voice |
| Real-time sync | Google Cloud Firestore (Native mode) |
| Email notifications | SMTP via Gmail |
| WhatsApp alerts | Twilio WhatsApp sandbox (optional) |
| Deployment | Render (backend web service + static frontend site) |

---

## Project structure

```
credit-bridge/
├── .gitignore
├── render.yaml
├── backend/
│   ├── main.py               # FastAPI app, all endpoints, SSE pipeline
│   ├── extractor.py          # Gemini Vision + Claude Vision extraction (togglable)
│   ├── scorer.py             # Weighted rubric, 300-850 score calculation
│   ├── narrator.py           # Claude narrative generation
│   ├── voice.py              # ElevenLabs TTS
│   ├── notifier.py           # SMTP email + Twilio WhatsApp
│   ├── firestore_client.py   # GCP Firestore write (lazy init, named DB support)
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
            ├── UploadPage.jsx    # Drag-drop upload, applicant form
            └── Dashboard.jsx     # SSE stepper, score ring, signal bars, audio player
```

---

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check, returns active AI provider |
| POST | `/upload` | Upload document files, returns `applicant_id` |
| GET | `/score/{applicant_id}` | SSE stream — runs full pipeline, emits step events + final result |
| GET | `/audio/{filename}` | Serve generated ElevenLabs audio file |

### SSE event types emitted by `/score`

```
event: step   — pipeline progress { step, label, done?, signals?, score? }
event: result — final payload { applicant_id, name, score, signals, narrative, audio_url }
event: error  — { message }
```

---

## Environment variables

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
# AI provider for document extraction: "gemini" or "claude"
AI_PROVIDER=gemini

# API keys
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
ELEVENLABS_API_KEY=

# Firestore
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
FIRESTORE_DATABASE=credit-bridge        # your Firestore database ID

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=                              # Gmail App Password

# WhatsApp (optional)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
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

1. Create a GCP project and enable Firestore in **Native mode**
2. In IAM & Admin → Service Accounts, create a service account with the **Cloud Datastore User** role
3. Download the JSON key, rename to `firebase-service-account.json`, place in `backend/`
4. Set `FIRESTORE_DATABASE` in `.env` to match your Firestore database ID

Firestore is used to persist scored applicants in the `applicants` collection. If not configured, results fall back to `backend/results/{applicant_id}.json` automatically.

---

## AI provider toggle

Switch between Gemini and Claude for document extraction by changing one line in `.env`:

```env
AI_PROVIDER=gemini   # uses Gemini 2.0 Flash Vision
AI_PROVIDER=claude   # uses Claude claude-sonnet-4-5 Vision
```

The credit narrative step always uses Claude regardless of this setting.

---

## Feature availability by API key

| Feature | Required | Graceful fallback |
|---|---|---|
| Document extraction | `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | None — core feature |
| Credit narrative | `ANTHROPIC_API_KEY` | None — core feature |
| Voice output | `ELEVENLABS_API_KEY` | Skipped silently, no audio button shown |
| Email report | `SMTP_USER` + `SMTP_PASS` | Skipped silently |
| WhatsApp alert | `TWILIO_*` | Skipped silently |
| Firestore sync | `FIREBASE_SERVICE_ACCOUNT_PATH` | Falls back to local JSON in `results/` |

---

## Accepted document types

- Utility bills (electricity, water, gas)
- Phone bills (mobile or landline)
- Rental receipts or lease agreements
- Income forms (self-reported)

Formats: JPG, PNG, WebP, PDF. Phone photos of crumpled or low-light documents are handled — Gemini Vision notes quality issues in the evidence field.
