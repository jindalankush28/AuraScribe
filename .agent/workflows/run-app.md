---
description: how to run the AuraScribe application
---

To run the AuraScribe AI Medical Scribe:

1. **Start the Backend**:
   // turbo
   Run `uv run python main.py` in your terminal. This will start the FastAPI server at `http://localhost:8000`.

2. **Start the Frontend**:
   // turbo
   In a separate terminal or background, run `npx -y serve -l 3000 .` to serve the web interface.

3. **Access the App**:
   Open your browser and navigate to `http://localhost:3000`.

4. **Record**:
   Click the "Start Recording" button to begin your clinical encounter. 
   Click "Stop Recording" to analyze the transcript and generate SOAP notes, questions, and tests.
