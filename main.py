from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from typing import List
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

class MedicalNote(BaseModel):
    presenting_complaints: str
    past_history: str
    investigations_ordered: str
    diagnosis: str
    treatment: str
    follow_up: str

class ClinicalDocumentation(BaseModel):
    note: MedicalNote
    questions: List[str]
    transcript: str
    error: str = None  # To inform user about API issues

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
    "presenting_complaints": "<string>",
    "past_history": "<string>",
    "investigations_ordered": "<string>",
    "diagnosis": "<string>",
    "treatment": "<string>",
    "follow_up": "<string>"
  },
  "questions": ["<string>", "<string>"]
}

SECTION GUIDELINES:

1. PRESENTING COMPLAINTS:
   - Chief complaint(s) and reason for visit
   - Current symptoms with duration, severity, and characteristics
   - Use format: "[Symptom] for [duration], described as [characteristics]"
   - Example: "Fever for 3 days, reaching 102°F, with chills and body aches. Dry cough for 2 days."

2. PAST HISTORY:
   - Previous medical conditions, surgeries, or chronic illnesses
   - Relevant family history if mentioned
   - Previous similar episodes
   - Allergies (if mentioned)
   - Use format: "Past Medical History: [conditions]. Surgical History: [surgeries]. Family History: [relevant]. Allergies: [allergies]."
   - Example: "Past Medical History: Type 2 Diabetes (5 years), Hypertension. Surgical History: Appendectomy (2018). Family History: Father had heart disease. Allergies: None known."

3. INVESTIGATIONS ORDERED:
   - Laboratory tests (blood work, urine tests, etc.)
   - Imaging studies (X-ray, CT, MRI, ultrasound)
   - Other diagnostic procedures
   - List each investigation on a new line with "- " prefix
   - Example: "- Complete Blood Count (CBC)\n- Chest X-ray\n- Rapid antigen test for influenza"

4. DIAGNOSIS:
   - Primary diagnosis or working diagnosis, you must always suspect the most probable diagnosis based on the symptoms and history if diagnosis is not mentioned.
   - Differential diagnoses if mentioned
   - Use format: "Primary: [main diagnosis]. Differential: [alternative diagnoses if any]."
   - Include ICD codes if mentioned
   - Example: "Primary: Acute Upper Respiratory Tract Infection (likely viral). Differential: Early pneumonia, allergic rhinitis. Suspected: Common Cold."

5. TREATMENT:
   - Medications prescribed with dosage, frequency, and duration
   - Non-pharmacological interventions
   - Lifestyle modifications recommended
   - Format medications as: "[Drug name] [dose] [route] [frequency] for [duration]"
   - Example: "Medications:\n- Paracetamol 500mg oral every 6 hours for 5 days (for fever)\n- Cetirizine 10mg oral once daily for 7 days (for allergic symptoms)\n\nNon-pharmacological:\n- Adequate rest and hydration\n- Steam inhalation twice daily\n- Avoid cold foods and drinks"

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

        # Try to get valid JSON response with retry
        analysis = None
        last_error = None
        
        for attempt in range(2):
            try:
                response = call_with_retries(
                    client.chat.completions.create,
                    model="gpt-4o-mini",
                    temperature=0.2,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"Transcript: {transcript_text}"}
                    ],
                    response_format={"type": "json_object"}
                )
                
                # Parse the JSON response
                analysis = json.loads(response.choices[0].message.content)
                
                # Validate required structure
                if "note" not in analysis:
                    raise ValueError("Response missing 'note' field")
                
                required_fields = ["presenting_complaints", "past_history", "investigations_ordered", 
                                 "diagnosis", "treatment", "follow_up"]
                missing_fields = [f for f in required_fields if f not in analysis["note"]]
                
                if missing_fields:
                    raise ValueError(f"Note missing required fields: {', '.join(missing_fields)}")
                
                if "questions" not in analysis:
                    analysis["questions"] = []
                
                # Success - break out of retry loop
                break
                
            except json.JSONDecodeError as je:
                last_error = f"Invalid JSON from LLM: {str(je)}"
                if attempt == 0:
                    print(f"JSON Parse Error (attempt {attempt + 1}): {je}. Retrying...")
                    continue
                else:
                    raise HTTPException(status_code=500, detail=last_error)
                    
            except ValueError as ve:
                last_error = f"Invalid response structure: {str(ve)}"
                if attempt == 0:
                    print(f"Structure validation error (attempt {attempt + 1}): {ve}. Retrying...")
                    continue
                else:
                    raise HTTPException(status_code=500, detail=last_error)
                    
            except Exception as e:
                last_error = f"LLM call failed: {str(e)}"
                raise HTTPException(status_code=500, detail=last_error)

        if not analysis:
            raise HTTPException(status_code=500, detail=f"Failed to generate valid analysis: {last_error}")

        analysis["transcript"] = transcript_text
        return analysis
        
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
            "presenting_complaints": "Severe headache and fever for 2 days. Describes it as 'sir mein bahut dard aur tez bukhaar'.",
            "past_history": "Patient mentions mild hypertension in the past, no regular medication.",
            "investigations_ordered": "Complete Blood Count (CBC), Dengue NS1 Antigen.",
            "diagnosis": "Viral Fever, suspected Dengue.",
            "treatment": "Tab. Paracetamol 650mg SOS for fever, plenty of oral fluids.",
            "follow_up": "Return in 48 hours for review or earlier if abdominal pain develops."
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
