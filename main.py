from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from typing import List, Optional
import os
import json
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class Settings(BaseSettings):
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")

settings = Settings()
client = OpenAI(api_key=settings.openai_api_key)

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI(title="AuraScribe API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files from the 'static' directory
app.mount("/static", StaticFiles(directory="static"), name="static")

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

class ClinicalDocumentation(BaseModel):
    """Full response including metadata"""
    note: MedicalNote
    questions: List[str]
    transcript: str
    error: Optional[str] = None

import time
import random

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

@app.post("/analyze", response_model=ClinicalDocumentation)
async def analyze_audio(audio: UploadFile = File(...)):
    """
    Receives audio file, transcribes it using Whisper (excellent for Hindi),
    and generates clinical documentation using GPT-4o-mini.
    """
    temp_file_path = f"temp_{audio.filename}"
    if not temp_file_path.endswith(".wav"):
        temp_file_path += ".wav"

    try:
        # Validate API key
        if not settings.openai_api_key or settings.openai_api_key == "your_api_key_here":
            mock_data = get_hindi_mock_data()
            mock_data["error"] = "API Key is missing or placeholder. Please update .env file."
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
            with open(temp_file_path, "rb") as audio_file:
                transcript_response = call_with_retries(
                    client.audio.transcriptions.create,
                    model="whisper-1", 
                    file=audio_file,
                    language="hi" 
                )
            transcript_text = transcript_response.text
            
            if not transcript_text or not transcript_text.strip():
                raise HTTPException(status_code=400, detail="Transcription returned empty text")
                
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

        # 3. Generate structured clinical notes using GPT-4o-mini
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
                    model="gpt-4o-mini",
                    temperature=0,
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
                if attempt == 0:
                    print(f"Extraction Error (attempt {attempt + 1}): {e}. Retrying...")
                    continue
                else:
                    raise HTTPException(status_code=500, detail=f"LLM extraction failed: {last_error}")

        if not analysis_data:
            raise HTTPException(status_code=500, detail=f"Failed to generate valid analysis: {last_error}")

        analysis_data["transcript"] = transcript_text
        return analysis_data
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        # Catch any unexpected errors
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")
    finally:
        # Always cleanup temp file
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e:
                print(f"Warning: Failed to delete temp file {temp_file_path}: {e}")

def get_hindi_mock_data(error_msg=None):
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
