document.addEventListener('DOMContentLoaded', () => {
    let mediaRecorder;
    let audioChunks = [];
    let startTime;
    let timerInterval;
    let isRecording = false;

    // UI Elements
    const recordBtn = document.getElementById('record-btn');
    const recordText = document.getElementById('record-text');
    const recordIcon = document.getElementById('record-icon');
    const timerDisplay = document.getElementById('timer');
    const statusContainer = document.getElementById('recording-status');
    const outputContainer = document.getElementById('output-container');
    const loadingOverlay = document.getElementById('loading-overlay');

    // Output Sections
    const soapSubjective = document.getElementById('soap-subjective');
    const soapObjective = document.getElementById('soap-objective');
    const soapAssessment = document.getElementById('soap-assessment');
    const soapPlan = document.getElementById('soap-plan');
    const patientQuestions = document.getElementById('patient-questions');
    const testsOrdered = document.getElementById('tests-ordered');

    // Recording Logic
    recordBtn.addEventListener('click', async () => {
        if (!isRecording) {
            startRecording();
        } else {
            stopRecording();
        }
    });

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                processRecording(audioBlob);
            };

            mediaRecorder.start();
            isRecording = true;

            // Update UI
            recordBtn.classList.add('recording');
            recordIcon.innerText = '⏹️';
            recordText.innerText = 'Stop Recording';
            timerDisplay.classList.remove('hidden');
            statusContainer.classList.remove('hidden');
            outputContainer.classList.add('hidden');

            startTimer();
        } catch (err) {
            console.error('Error accessing microphone:', err);
            alert('Could not access microphone. Please ensure you have granted permission.');
        }
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
            isRecording = false;

            // Update UI
            recordBtn.classList.remove('recording');
            recordIcon.innerText = '🎤';
            recordText.innerText = 'Start Recording';
            timerDisplay.classList.add('hidden');
            statusContainer.classList.add('hidden');

            stopTimer();
        }
    }

    function startTimer() {
        startTime = Date.now();
        timerInterval = setInterval(() => {
            const elapsedTime = Date.now() - startTime;
            const minutes = Math.floor(elapsedTime / 60000);
            const seconds = Math.floor((elapsedTime % 60000) / 1000);
            timerDisplay.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
    }

    async function processRecording(audioBlob) {
        // Show loading state
        loadingOverlay.classList.remove('hidden');

        console.log('Sending audio to backend for analysis...', audioBlob.size, 'bytes');

        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.wav');

            const response = await fetch('/analyze', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.statusText}`);
            }

            const data = await response.json();
            displayResults(data);
        } catch (error) {
            console.error('Analysis failed:', error);
            alert('Consultation analysis failed. Please ensure the backend is running.');
            loadingOverlay.classList.add('hidden');
        }
    }

    function displayResults(data) {
        loadingOverlay.classList.add('hidden');
        outputContainer.classList.remove('hidden');

        // Fill Transcript if available
        const transcriptContainer = document.getElementById('transcript-container');
        const rawTranscript = document.getElementById('raw-transcript');
        if (data.transcript) {
            transcriptContainer.classList.remove('hidden');
            rawTranscript.innerText = data.transcript;
        } else {
            transcriptContainer.classList.add('hidden');
        }

        if (data.error) {
            alert(`Note: We are showing demo data because of an API issue: ${data.error}`);
        }

        // Fill SOAP Note
        soapSubjective.innerText = data.soap.subjective;
        soapObjective.innerText = data.soap.objective;
        soapAssessment.innerText = data.soap.assessment;
        soapPlan.innerText = data.soap.plan;

        // Fill Patient Questions
        patientQuestions.innerHTML = '';
        data.questions.forEach(q => {
            const li = document.createElement('li');
            li.innerText = q;
            patientQuestions.appendChild(li);
        });

        // Fill Tests Ordered
        testsOrdered.innerHTML = '';
        data.tests.forEach(t => {
            const li = document.createElement('li');
            li.innerText = t;
            testsOrdered.appendChild(li);
        });

        // Scroll to results
        outputContainer.scrollIntoView({ behavior: 'smooth' });
    }

    // Copy to clipboard functionality
    document.getElementById('copy-soap').addEventListener('click', () => {
        const textToCopy = `
SOAP NOTE
----------
SUBJECTIVE:
${soapSubjective.innerText}

OBJECTIVE:
${soapObjective.innerText}

ASSESSMENT:
${soapAssessment.innerText}

PLAN:
${soapPlan.innerText}
        `.trim();

        navigator.clipboard.writeText(textToCopy).then(() => {
            const btn = document.getElementById('copy-soap');
            const originalText = btn.innerText;
            btn.innerText = 'Copied!';
            btn.style.background = 'var(--success)';
            setTimeout(() => {
                btn.innerText = originalText;
                btn.style.background = '';
            }, 2000);
        });
    });
});
