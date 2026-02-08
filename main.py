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
        if not settings.openai_api_key or settings.openai_api_key == "your_api_key_here":
             mock_data = get_hindi_mock_data()
             mock_data["error"] = "API Key is missing or placeholder. Please update .env file."
             return mock_data

        # 1. Save the temporary audio file
        with open(temp_file_path, "wb") as f:
            content = await audio.read()
            f.write(content)
        
        # 2. Transcribe using OpenAI Whisper (V3 supports Hindi extremely well)
        with open(temp_file_path, "rb") as audio_file:
            transcript_response = client.audio.transcriptions.create(
                model="whisper-1", 
                file=audio_file,
                language="hi" 
            )
        
        transcript_text = transcript_response.text

        # 3. Generate structured clinical notes using GPT-4o-mini
        system_prompt = """
        You are an expert medical scribe. You will receive a transcript of a doctor-patient encounter (potentially in Hindi or Hinglish).
        Your task is to generate a professional medical note in English with these exact sections:
        1. Presenting Complaints: The patient's current symptoms and reasons for visit.
        2. Past History: Any relevant previous medical conditions or treatments mentioned.
        3. Investigations Ordered: Laboratory tests, imaging, or other diagnostics mentioned.
        4. Diagnosis: The doctor's assessment or suspected conditions.
        5. Treatment: Medications prescribed or therapeutic actions planned.
        6. Follow-up: When and why the patient should return.

        Also:
        - List questions/concerns asked by the patient.
        
        Never hallucinate or add information that is not present in the transcript.
        Format the output as a JSON object with the following structure:
        {
          "note": {
            "presenting_complaints": "...",
            "past_history": "...",
            "investigations_ordered": "...",
            "diagnosis": "...",
            "treatment": "...",
            "follow_up": "..."
          },
          "questions": ["...", "..."]
        }
        """

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Transcript: {transcript_text}"}
            ],
            response_format={"type": "json_object"}
        )

        analysis = json.loads(response.choices[0].message.content)
        analysis["transcript"] = transcript_text
        
        return analysis

    except Exception as e:
        error_msg = str(e)
        print(f"Error during analysis: {error_msg}")
        # Fallback to mock data if API fails or key is missing
        mock_data = get_hindi_mock_data()
        mock_data["error"] = error_msg
        return mock_data
    finally:
        # Cleanup temp file
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

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
