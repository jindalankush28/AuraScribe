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

class SOAPNote(BaseModel):
    subjective: str
    objective: str
    assessment: str
    plan: str

class ClinicalDocumentation(BaseModel):
    soap: SOAPNote
    questions: List[str]
    tests: List[str]
    transcript: str
    error: str = None  # To inform user about API issues

@app.post("/analyze", response_model=ClinicalDocumentation)
async def analyze_audio(audio: UploadFile = File(...)):
    """
    Receives audio file, transcribes it using Whisper (excellent for Hindi),
    and generates clinical documentation using GPT-4o.
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
                # Whisper automatically detects Hindi, but we can nudge it
                language="hi" 
            )
        
        transcript_text = transcript_response.text

        # 3. Generate structured clinical notes using GPT-4o
        system_prompt = """
        You are an expert medical scribe. You will receive a transcript of a doctor-patient encounter (potentially in Hindi or Hinglish).
        Your task is to:
        1. Generate a professional SOAP note in English.
        2. List questions asked by the patient during the encounter.
        3. List any tests ordered by the doctor during the encounter.
        
        Never hallucinate or add information that is not present in the transcript.
        Format the output as a JSON object with the following structure:
        {
          "soap": {
            "subjective": "...",
            "objective": "...",
            "assessment": "...",
            "plan": "..."
          },
          "questions": ["...", "..."],
          "tests": ["...", "..."]
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
        "soap": {
            "subjective": "Patient reports severe headache and fever for 2 days. Describes it as 'sir mein bahut dard aur tez bukhaar'. Mentions body ache and fatigue. (Translated from Hindi conversation)",
            "objective": "Temp: 101.5 F. BP: 120/80. No signs of meningitis. Throat appears slightly congested.",
            "assessment": "1. Viral Fever with Myalgia.\n2. Rule out Dengue/Malaria.",
            "plan": "1. Tab. Paracetamol 650mg SOS for fever.\n2. Complete Blood Count (CBC).\n3. Re-evaluate if symptoms persist for 48 hours."
        },
        "questions": [
            "Kya aapko thand lag kar bukhaar aa raha hai? (Do you feel chills with the fever?)",
            "Aapne koi dawai li hai ab tak? (Have you taken any medicine yet?)",
            "Body rash ya vomiting jaisa kuch hai? (Any body rash or vomiting?)"
        ],
        "tests": [
            "CBC (Complete Blood Count)",
            "NS1 Antigen for Dengue",
            "Malaria Parasite test"
        ],
        "transcript": "नमस्ते डॉक्टर साहब, मुझे दो दिन से बहुत तेज़ बुख़ार और सिर में दर्द है। पूरा बदन टूट रहा है।"
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
