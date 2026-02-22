from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from typing import List, Optional
import os
import json
import logging
import time
import random
import sqlite3
from datetime import datetime, timezone
from contextlib import contextmanager, asynccontextmanager
from openai import OpenAI
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class Settings(BaseSettings):
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")

settings = Settings()
client = OpenAI(api_key=settings.openai_api_key)

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# ── Database ────────────────────────────────────────────────────────────────

DB_PATH = "aurascribe.db"

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS patients (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                mrn        TEXT    NOT NULL UNIQUE,
                full_name  TEXT    NOT NULL DEFAULT '',
                sex        TEXT    NOT NULL DEFAULT '',
                age        INTEGER NOT NULL DEFAULT 0,
                created_at TEXT    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_patients_mrn  ON patients(mrn);
            CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(full_name COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS encounters (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                recorded_at TEXT    NOT NULL,
                note_json   TEXT    NOT NULL,
                transcript  TEXT    NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_enc_patient ON encounters(patient_id);
            CREATE INDEX IF NOT EXISTS idx_enc_date    ON encounters(recorded_at);
        """)
        conn.commit()

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
    finally:
        conn.close()

# ── Pydantic Models ──────────────────────────────────────────────────────────

class Complaint(BaseModel):
    complaint: str

class PastHistoryItem(BaseModel):
    history_item: str

class InvestigationItem(BaseModel):
    test: str

class DiagnosisItem(BaseModel):
    diagnosis: str
    type: str  # primary, suspect, DD
    icd_code: Optional[str] = None

class TreatmentItem(BaseModel):
    treatment: str

class MedicalNote(BaseModel):
    presenting_complaints: List[Complaint]
    past_history: List[PastHistoryItem]
    investigations_ordered: List[InvestigationItem]
    diagnosis: List[DiagnosisItem]
    treatment: List[TreatmentItem]
    follow_up: str

class ClinicalDocumentationResponse(BaseModel):
    """Structured response from LLM"""
    note: MedicalNote
    questions: List[str]

class PatientResponse(BaseModel):
    id: int
    mrn: str
    full_name: str
    sex: str
    age: int
    created_at: str

class PatientLookupResponse(BaseModel):
    patient: Optional[PatientResponse] = None
    exists: bool
    encounter_count: int = 0
    last_encounter_at: Optional[str] = None

class EncounterSummary(BaseModel):
    id: int
    patient_id: int
    recorded_at: str
    note_preview: str
    transcript_preview: str

class EncounterDetail(BaseModel):
    id: int
    patient_id: int
    recorded_at: str
    note: MedicalNote
    transcript: str
    questions: List[str]

class DailyPatientEntry(BaseModel):
    patient: PatientResponse
    encounter_count: int
    last_encounter_at: str

class ClinicalDocumentation(BaseModel):
    """Full response including metadata"""
    note: MedicalNote
    questions: List[str]
    transcript: str
    error: Optional[str] = None
    encounter_id: Optional[int] = None
    patient: Optional[PatientResponse] = None

# ── App Setup ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    logger.info("Database initialized.")
    yield

app = FastAPI(title="AuraScribe API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files from the 'static' directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# ── Patient Routes ───────────────────────────────────────────────────────────

@app.post("/patients", response_model=PatientResponse)
async def create_or_get_patient(
    mrn: str = Form(...),
    full_name: str = Form(""),
    sex: str = Form(""),
    age: int = Form(0),
):
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM patients WHERE mrn = ?", (mrn,)).fetchone()
        if existing:
            return PatientResponse(**dict(existing))
        conn.execute(
            "INSERT INTO patients (mrn, full_name, sex, age, created_at) VALUES (?, ?, ?, ?, ?)",
            (mrn, full_name, sex, age, now)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM patients WHERE mrn = ?", (mrn,)).fetchone()
        return PatientResponse(**dict(row))

# NOTE: /patients/search must be declared before /patients/{mrn}
@app.get("/patients/search", response_model=List[PatientLookupResponse])
async def search_patients(q: str):
    if len(q) < 2:
        return []
    pattern = f"%{q}%"
    with get_db() as conn:
        rows = conn.execute(
            """SELECT p.*,
                      COUNT(e.id)    AS encounter_count,
                      MAX(e.recorded_at) AS last_encounter_at
               FROM patients p
               LEFT JOIN encounters e ON e.patient_id = p.id
               WHERE p.mrn LIKE ? COLLATE NOCASE OR p.full_name LIKE ? COLLATE NOCASE
               GROUP BY p.id
               ORDER BY p.full_name COLLATE NOCASE
               LIMIT 20""",
            (pattern, pattern)
        ).fetchall()
    results = []
    for row in rows:
        d = dict(row)
        results.append(PatientLookupResponse(
            patient=PatientResponse(
                id=d["id"], mrn=d["mrn"], full_name=d["full_name"],
                sex=d["sex"], age=d["age"], created_at=d["created_at"]
            ),
            exists=True,
            encounter_count=d["encounter_count"] or 0,
            last_encounter_at=d["last_encounter_at"],
        ))
    return results

@app.get("/patients/{mrn}", response_model=PatientLookupResponse)
async def get_patient_by_mrn(mrn: str):
    with get_db() as conn:
        row = conn.execute(
            """SELECT p.*,
                      COUNT(e.id)        AS encounter_count,
                      MAX(e.recorded_at) AS last_encounter_at
               FROM patients p
               LEFT JOIN encounters e ON e.patient_id = p.id
               WHERE p.mrn = ?
               GROUP BY p.id""",
            (mrn,)
        ).fetchone()
    if not row:
        return PatientLookupResponse(exists=False)
    d = dict(row)
    return PatientLookupResponse(
        patient=PatientResponse(
            id=d["id"], mrn=d["mrn"], full_name=d["full_name"],
            sex=d["sex"], age=d["age"], created_at=d["created_at"]
        ),
        exists=True,
        encounter_count=d["encounter_count"] or 0,
        last_encounter_at=d["last_encounter_at"],
    )

@app.get("/patients/{mrn}/encounters", response_model=List[EncounterSummary])
async def get_patient_encounters(mrn: str):
    with get_db() as conn:
        patient = conn.execute("SELECT id FROM patients WHERE mrn = ?", (mrn,)).fetchone()
        if not patient:
            raise HTTPException(status_code=404, detail="Patient not found")
        rows = conn.execute(
            "SELECT * FROM encounters WHERE patient_id = ? ORDER BY recorded_at DESC",
            (patient["id"],)
        ).fetchall()
    summaries = []
    for row in rows:
        d = dict(row)
        note_preview = ""
        transcript_preview = (d["transcript"] or "")[:80]
        try:
            note_data = json.loads(d["note_json"])
            complaints = note_data.get("note", {}).get("presenting_complaints", [])
            if complaints:
                first = complaints[0].get("complaint", "")
                note_preview = first[:120]
        except Exception:
            pass
        summaries.append(EncounterSummary(
            id=d["id"],
            patient_id=d["patient_id"],
            recorded_at=d["recorded_at"],
            note_preview=note_preview,
            transcript_preview=transcript_preview,
        ))
    return summaries

class EncounterUpdateRequest(BaseModel):
    note: MedicalNote

@app.put("/encounters/{encounter_id}", response_model=EncounterDetail)
async def update_encounter(encounter_id: int, body: EncounterUpdateRequest):
    """Save an edited note back to the encounter."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM encounters WHERE id = ?", (encounter_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Encounter not found")
        d = dict(row)
        # Merge the updated note into the stored JSON (preserve transcript + questions)
        try:
            stored = json.loads(d["note_json"])
        except Exception:
            stored = {}
        stored["note"] = body.note.model_dump()
        conn.execute(
            "UPDATE encounters SET note_json = ? WHERE id = ?",
            (json.dumps(stored), encounter_id)
        )
        conn.commit()
        updated_row = conn.execute("SELECT * FROM encounters WHERE id = ?", (encounter_id,)).fetchone()

    d2 = dict(updated_row)
    note_data2 = json.loads(d2["note_json"])
    return EncounterDetail(
        id=d2["id"],
        patient_id=d2["patient_id"],
        recorded_at=d2["recorded_at"],
        note=MedicalNote(**note_data2["note"]),
        transcript=d2["transcript"],
        questions=note_data2.get("questions", []),
    )

@app.get("/encounters/{encounter_id}", response_model=EncounterDetail)
async def get_encounter(encounter_id: int):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM encounters WHERE id = ?", (encounter_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Encounter not found")
    d = dict(row)
    try:
        note_data = json.loads(d["note_json"])
        note = MedicalNote(**note_data["note"])
        questions = note_data.get("questions", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse stored note: {e}")
    return EncounterDetail(
        id=d["id"],
        patient_id=d["patient_id"],
        recorded_at=d["recorded_at"],
        note=note,
        transcript=d["transcript"],
        questions=questions,
    )

@app.get("/daily", response_model=List[DailyPatientEntry])
async def get_daily_list(date: Optional[str] = None):
    if not date:
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Match encounters whose recorded_at starts with the given date (ISO prefix)
    date_prefix = f"{date}%"
    with get_db() as conn:
        rows = conn.execute(
            """SELECT p.*,
                      COUNT(e.id)        AS encounter_count,
                      MAX(e.recorded_at) AS last_encounter_at
               FROM encounters e
               JOIN patients p ON p.id = e.patient_id
               WHERE e.recorded_at LIKE ?
               GROUP BY p.id
               ORDER BY last_encounter_at DESC""",
            (date_prefix,)
        ).fetchall()
    entries = []
    for row in rows:
        d = dict(row)
        entries.append(DailyPatientEntry(
            patient=PatientResponse(
                id=d["id"], mrn=d["mrn"], full_name=d["full_name"],
                sex=d["sex"], age=d["age"], created_at=d["created_at"]
            ),
            encounter_count=d["encounter_count"],
            last_encounter_at=d["last_encounter_at"],
        ))
    return entries

# ── Static Routes ────────────────────────────────────────────────────────────

@app.get("/")
async def read_index():
    return FileResponse("static/index.html")

# Keep existing index.html links working by serving them from root if needed
@app.get("/{file_path:path}")
async def serve_static_fallback(file_path: str):
    file_full_path = os.path.join("static", file_path)
    if os.path.isfile(file_full_path):
        return FileResponse(file_full_path)
    return FileResponse("static/index.html")

# ── Helpers ──────────────────────────────────────────────────────────────────

def call_with_retries(func, *args, **kwargs):
    max_retries = 3
    base_delay = 1
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            if attempt == max_retries - 1:
                raise e
            # Only retry on potentially transient errors (rate limit, server error)
            error_str = str(e).lower()
            if "rate limit" in error_str or "quota" in error_str or "server error" in error_str or "connection" in error_str or "timeout" in error_str:
                # Exponential backoff with jitter
                delay = (base_delay * (2 ** attempt)) + (random.random() * 0.5)
                print(f"API Error: {e}. Retrying {attempt + 1}/{max_retries} in {delay:.2f}s...")
                time.sleep(delay)
            else:
                raise e

# ── Analyze Route ────────────────────────────────────────────────────────────

@app.post("/analyze", response_model=ClinicalDocumentation)
async def analyze_audio(
    audio: UploadFile = File(...),
    mrn: Optional[str] = Form(None),
    full_name: Optional[str] = Form(None),
    sex: Optional[str] = Form(None),
    age: Optional[int] = Form(None),
):
    """
    Receives audio file, transcribes it using Whisper (excellent for Hindi),
    and generates clinical documentation using GPT-5-nano.
    Optionally associates the encounter with a patient if mrn is provided.
    """
    logger.info(f"Received audio analysis request for file: {audio.filename}")
    temp_file_path = f"temp_{audio.filename}"

    try:
        # Validate API key
        if not settings.openai_api_key or settings.openai_api_key == "your_api_key_here":
            mock_data = get_hindi_mock_data()
            mock_data["error"] = "API Key is missing or placeholder. Please update .env file."
            # Still persist encounter if patient info provided
            if mrn:
                patient_resp, encounter_id = _persist_encounter(mrn, full_name or "", sex or "", age or 0, mock_data)
                mock_data["encounter_id"] = encounter_id
                mock_data["patient"] = patient_resp.model_dump() if patient_resp else None
            return mock_data

        # 1. Save the temporary audio file
        try:
            with open(temp_file_path, "wb") as f:
                content = await audio.read()
                f.write(content)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save audio file: {str(e)}")

        # 2. Transcribe using OpenAI Whisper
        try:
            logger.info("Starting transcription...")
            with open(temp_file_path, "rb") as audio_file:
                logger.info("Audio file opened")
                transcript_response = call_with_retries(
                    client.audio.transcriptions.create,
                    model="gpt-4o-mini-transcribe",
                    file=audio_file,
                    language="hi",
                    response_format="json"
                )
            logger.info("transciption complete")
            transcript_text = transcript_response.text
            logger.info(f"Transcription complete. Length: {len(transcript_text)} characters")

            if not transcript_text or not transcript_text.strip():
                logger.warning("Transcription returned empty text")
                raise HTTPException(status_code=400, detail="Transcription returned empty text")

        except Exception as e:
            logger.error(f"Transcription failed: {str(e)}")
            mock_data = get_hindi_mock_data()
            mock_data["error"] = f"Transcription failed: {str(e)}. Using mock data."
            if mrn:
                patient_resp, encounter_id = _persist_encounter(mrn, full_name or "", sex or "", age or 0, mock_data)
                mock_data["encounter_id"] = encounter_id
                mock_data["patient"] = patient_resp.model_dump() if patient_resp else None
            return mock_data

        # 3. Generate structured clinical notes using GPT-5-nano
        system_prompt = """
You are an expert medical scribe generating structured clinical documentation from doctor-patient encounter transcripts (potentially in Hindi or Hinglish).

INSTRUCTIONS:
- Generate professional medical notes in English
- Extract information ONLY from the transcript - never add information not present
- Use clear, concise medical terminology
- If a section has no relevant information, write "Not mentioned" or "None documented"

OUTPUT FORMAT:
Return a JSON object with the following exact structure:

{
  "note": {
    "presenting_complaints": [{"complaint": "<string>"}],
    "past_history": [{"history_item": "<string>"}],
    "investigations_ordered": [{"test": "<string>"}],
    "diagnosis": [{"diagnosis": "<string>", "type": "primary|suspect|DD", "icd_code": "<string>"}],
    "treatment": [{"treatment": "<string>"}],
    "follow_up": "<string>"
  },
  "questions": ["<string>"]
}

SECTION GUIDELINES:

1. PRESENTING COMPLAINTS:
   - Provide a list of complaint objects
   - Each object should have a "complaint" field containing the symptom and its characteristics
   - Example: [{"complaint": "Fever for 3 days, reaching 102°F, with chills"}]

2. PAST HISTORY:
   - Provide a list of history objects
   - Each object should have a "history_item" field
   - Example: [{"history_item": "Type 2 Diabetes (5 years)"}, {"history_item": "Appendectomy (2018)"}]

3. INVESTIGATIONS ORDERED:
   - Provide a list of investigation objects
   - Each object should have a "test" field
   - Example: [{"test": "Complete Blood Count (CBC)"}, {"test": "Chest X-ray"}]

4. DIAGNOSIS:
   - Provide a list of diagnosis objects
   - Each object must have "diagnosis" (name), "type" (one of: 'primary', 'suspect', or 'DD'), and optional "icd_code".
   - You must always suspect the most probable diagnosis if not explicitly stated.
   - Example: [{"diagnosis": "Acute URI", "type": "primary", "icd_code": "J06.9"}, {"diagnosis": "Pneumonia", "type": "DD"}]

5. TREATMENT:
   - Provide a list of treatment objects
   - Each object should have a "treatment" field
   - Example: [{"treatment": "Paracetamol 500mg oral every 6 hours for 5 days"}, {"treatment": "Adequate rest and hydration"}]

6. FOLLOW-UP:
   - When to return (specific timeframe)
   - Conditions requiring earlier return
   - What will be reassessed
   - Format: "Return in [timeframe] for [reason]. Return earlier if [warning signs]."
   - Example: "Return in 5 days for reassessment. Return earlier if fever persists beyond 3 days, breathing difficulty develops, or symptoms worsen."

QUESTIONS ARRAY:
- List all questions or concerns explicitly asked by the patient
- Use direct quotes when possible, translated to English if needed
- Each question should be a separate string in the array
- Example: ["How long will the fever last?", "Can I continue going to work?", "Is this contagious?"]

IMPORTANT REMINDERS:
- Maintain patient confidentiality - do not include identifying information unless necessary
- Use standard medical abbreviations appropriately
- Be objective and factual
- If information is ambiguous or unclear, note this in the relevant section
"""

        # Use structured output parsing
        analysis_data = None
        last_error = None

        for attempt in range(2):
            try:
                # Use beta.chat.completions.parse for Pydantic integration
                response = call_with_retries(
                    client.beta.chat.completions.parse,
                    model="gpt-5-nano",
                    reasoning_effort="low",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"Transcript: {transcript_text}"}
                    ],
                    response_format=ClinicalDocumentationResponse
                )

                # Get the parsed object
                parsed_response = response.choices[0].message.parsed
                if not parsed_response:
                    raise ValueError("Failed to parse response into model")

                analysis_data = parsed_response.model_dump()
                break

            except Exception as e:
                last_error = str(e)
                logger.error(f"Extraction Error (attempt {attempt + 1}): {e}")
                if attempt == 0:
                    logger.info("Retrying extraction...")
                    continue
                else:
                    logger.critical(f"LLM extraction failed after retries: {last_error}")
                    raise HTTPException(status_code=500, detail=f"LLM extraction failed: {last_error}")

        if not analysis_data:
            raise HTTPException(status_code=500, detail=f"Failed to generate valid analysis: {last_error}")

        analysis_data["transcript"] = transcript_text

        # 4. Persist encounter if patient info was provided
        if mrn:
            patient_resp, encounter_id = _persist_encounter(mrn, full_name or "", sex or "", age or 0, analysis_data)
            analysis_data["encounter_id"] = encounter_id
            analysis_data["patient"] = patient_resp.model_dump() if patient_resp else None

        return analysis_data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")
    finally:
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e:
                print(f"Warning: Failed to delete temp file {temp_file_path}: {e}")

def _persist_encounter(mrn: str, full_name: str, sex: str, age: int, analysis_data: dict):
    """Upsert patient and insert encounter row. Returns (PatientResponse, encounter_id)."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        with get_db() as conn:
            # Upsert patient
            existing = conn.execute("SELECT * FROM patients WHERE mrn = ?", (mrn,)).fetchone()
            if existing:
                patient_row = dict(existing)
            else:
                conn.execute(
                    "INSERT INTO patients (mrn, full_name, sex, age, created_at) VALUES (?, ?, ?, ?, ?)",
                    (mrn, full_name, sex, age, now)
                )
                conn.commit()
                patient_row = dict(conn.execute("SELECT * FROM patients WHERE mrn = ?", (mrn,)).fetchone())

            patient_resp = PatientResponse(**patient_row)

            # Insert encounter
            note_json = json.dumps(analysis_data)
            transcript = analysis_data.get("transcript", "")
            conn.execute(
                "INSERT INTO encounters (patient_id, recorded_at, note_json, transcript) VALUES (?, ?, ?, ?)",
                (patient_row["id"], now, note_json, transcript)
            )
            conn.commit()
            encounter_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        return patient_resp, encounter_id
    except Exception as e:
        logger.error(f"Failed to persist encounter: {e}")
        return None, None

def get_hindi_mock_data():
    """Fallback mock data for Hindi encounters."""
    return {
        "note": {
            "presenting_complaints": [{"complaint": "Severe headache for 2 days"}, {"complaint": "High fever"}],
            "past_history": [{"history_item": "Mild hypertension"}],
            "investigations_ordered": [{"test": "CBC"}, {"test": "Dengue NS1"}],
            "diagnosis": [{"diagnosis": "Viral Fever", "type": "primary"}, {"diagnosis": "Dengue", "type": "suspect"}],
            "treatment": [{"treatment": "Tab. Paracetamol 650mg SOS"}, {"treatment": "Oral fluids"}],
            "follow_up": "Return in 48 hours for review."
        },
        "questions": [
            "Kya aapko thand lag kar bukhaar aa raha hai?",
            "Body rash ya vomiting jaisa kuch hai?"
        ],
        "transcript": "नमस्ते डॉक्टर साहब, मुझे दो दिन से बहुत तेज़ बुख़ar और सिर में दर्द है। पूरा बदन टूट रहा है।"
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
