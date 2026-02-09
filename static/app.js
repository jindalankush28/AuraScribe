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
    const noteComplaints = document.getElementById('note-complaints');
    const noteHistory = document.getElementById('note-history');
    const noteInvestigations = document.getElementById('note-investigations');
    const noteDiagnosis = document.getElementById('note-diagnosis');
    const noteTreatment = document.getElementById('note-treatment');
    const noteFollowup = document.getElementById('note-followup');
    const patientQuestions = document.getElementById('patient-questions');
    const editBtn = document.getElementById('edit-note');
    const pdfBtn = document.getElementById('pdf-btn');
    let isEditingNotes = false;

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

            const backendUrl = window.location.port === '3000' ? 'http://localhost:8000/analyze' : '/analyze';

            const response = await fetch(backendUrl, {
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

        // Format helper
        const formatItem = (item) => {
            if (item.complaint) return item.complaint;
            if (item.history_item) return item.history_item;
            if (item.test) return item.test;
            if (item.treatment) return item.treatment;
            if (item.diagnosis) {
                let d = item.diagnosis;
                if (item.type) d += ` (${item.type})`;
                if (item.icd_code) d += ` [ICD: ${item.icd_code}]`;
                return d;
            }
            return JSON.stringify(item);
        };

        const formatList = (list) => {
            if (!list) return "Not mentioned";
            if (typeof list === 'string') return list;
            if (!Array.isArray(list)) {
                // Handle case where LLM might return a single object instead of a list
                return `• ${formatItem(list)}`;
            }
            if (list.length === 0) return "Not mentioned";
            return list.map(item => `• ${formatItem(item)}`).join('\n');
        };

        // Fill Medical Note
        noteComplaints.innerText = formatList(data.note.presenting_complaints);
        noteHistory.innerText = formatList(data.note.past_history);
        noteInvestigations.innerText = formatList(data.note.investigations_ordered);
        noteDiagnosis.innerText = formatList(data.note.diagnosis);
        noteTreatment.innerText = formatList(data.note.treatment);
        noteFollowup.innerText = data.note.follow_up || "Not mentioned";

        // Sync Print Template
        const printBody = document.getElementById('print-note-body');
        const sections = [
            { title: 'Presenting Complaints', content: formatList(data.note.presenting_complaints) },
            { title: 'Past History', content: formatList(data.note.past_history) },
            { title: 'Investigations Ordered', content: formatList(data.note.investigations_ordered) },
            { title: 'Diagnosis', content: formatList(data.note.diagnosis) },
            { title: 'Treatment', content: formatList(data.note.treatment) },
            { title: 'Follow-up', content: data.note.follow_up }
        ];

        printBody.innerHTML = sections.map(s => `
            <div class="print-section">
                <h3>${s.title}</h3>
                <div class="print-section-content">${s.content}</div>
            </div>
        `).join('');

        // Fill Patient Questions
        patientQuestions.innerHTML = '';
        data.questions.forEach(q => {
            const li = document.createElement('li');
            li.innerText = q;
            patientQuestions.appendChild(li);
        });

        // Scroll to results
        outputContainer.scrollIntoView({ behavior: 'smooth' });
    }

    // Edit functionality
    editBtn.addEventListener('click', () => {
        const sections = [
            noteComplaints, noteHistory, noteInvestigations,
            noteDiagnosis, noteTreatment, noteFollowup
        ];

        isEditingNotes = !isEditingNotes;

        if (isEditingNotes) {
            sections.forEach(s => {
                s.contentEditable = "true";
                s.classList.add('editing');
            });
            editBtn.innerText = 'Save Changes';
            editBtn.style.background = 'var(--accent)';
        } else {
            sections.forEach(s => {
                s.contentEditable = "false";
                s.classList.remove('editing');
            });
            editBtn.innerText = 'Edit';
            editBtn.style.background = '';

            // Re-sync print template with edited content
            const printBody = document.getElementById('print-note-body');
            const sectionTitles = [
                'Presenting Complaints', 'Past History', 'Investigations Ordered',
                'Diagnosis', 'Treatment', 'Follow-up'
            ];

            printBody.innerHTML = sections.map((s, i) => `
                <div class="print-section">
                    <h3>${sectionTitles[i]}</h3>
                    <div class="print-section-content">${s.innerText.replace(/\n/g, '<br>')}</div>
                </div>
            `).join('');
        }
    });

    // Save as PDF functionality
    pdfBtn.addEventListener('click', () => {
        const element = document.getElementById('printable-note');

        // Prompt for filename
        let filename = prompt("Enter a name for the PDF file:", "Medical_Note_" + new Date().toLocaleDateString().replace(/\//g, '-'));
        if (filename === null) return; // Cancelled
        if (!filename.trim()) filename = "AuraScribe_Medical_Note";
        if (!filename.endsWith('.pdf')) filename += '.pdf';

        const opt = {
            margin: 15,
            filename: filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                letterRendering: true,
                logging: false,
                backgroundColor: '#ffffff'  // Add explicit white background
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        // Create a temporary container for a clean export
        const cleanContent = document.createElement('div');
        cleanContent.id = 'pdf-export-container';

        // FIXED: Make visible but overlay on page instead of off-screen
        cleanContent.style.position = 'fixed';
        cleanContent.style.left = '0';  // Changed from '-9999px'
        cleanContent.style.top = '0';
        cleanContent.style.width = '180mm';
        cleanContent.style.padding = '20px';
        cleanContent.style.backgroundColor = '#ffffff';  // Explicit white
        cleanContent.style.color = '#000000';  // Explicit black
        cleanContent.style.fontFamily = 'Arial, sans-serif';
        cleanContent.style.zIndex = '9999';  // Changed to overlay on top
        cleanContent.style.opacity = '0';  // Make invisible to user but renderable
        cleanContent.style.pointerEvents = 'none';  // Don't interfere with clicks

        // Add a title header for the PDF
        const header = document.createElement('h1');
        header.innerText = 'Clinical Medical Note';
        header.style.textAlign = 'center';
        header.style.borderBottom = '2px solid #333';
        header.style.paddingBottom = '10px';
        header.style.marginBottom = '20px';
        header.style.color = '#000000';
        header.style.fontSize = '18pt';
        header.style.backgroundColor = 'transparent';
        cleanContent.appendChild(header);

        // Copy sections
        const sections = element.querySelectorAll('.section');
        sections.forEach(sec => {
            const clone = sec.cloneNode(true);
            clone.style.marginBottom = '20px';
            clone.style.pageBreakInside = 'avoid';
            clone.style.display = 'block';
            clone.style.backgroundColor = '#ffffff';  // Explicit white

            // Fix colors for PDF
            const h3 = clone.querySelector('h3');
            if (h3) {
                h3.style.color = '#1a56db';
                h3.style.borderBottom = '1px solid #1a56db';
                h3.style.display = 'block';
                h3.style.margin = '0 0 10px 0';
                h3.style.fontSize = '14pt';
                h3.style.backgroundColor = 'transparent';
            }

            const content = clone.querySelector('.content-placeholder');
            if (content) {
                content.style.color = '#333333';
                content.style.backgroundColor = 'transparent';
                content.style.borderLeft = '2px solid #1a56db';
                content.style.display = 'block';
                content.style.paddingLeft = '15px';
                content.style.fontSize = '11pt';
                content.style.whiteSpace = 'pre-wrap';

                // Sync content from the current state (handles edits)
                content.innerText = sec.querySelector('.content-placeholder').innerText;
            }

            cleanContent.appendChild(clone);
        });

        // Add to DOM
        document.body.appendChild(cleanContent);

        // Wait a moment for rendering before capturing
        setTimeout(() => {
            html2pdf().set(opt).from(cleanContent).save()
                .then(() => {
                    console.log('PDF saved successfully');
                    document.body.removeChild(cleanContent);
                })
                .catch(err => {
                    console.error('PDF library error:', err);
                    alert('Could not generate PDF. Please try again.');
                    if (document.body.contains(cleanContent))
                        document.body.removeChild(cleanContent);
                });
        }, 100);  // Small delay to ensure DOM is fully rendered
    });

    // Copy to clipboard functionality
    document.getElementById('copy-note').addEventListener('click', () => {
        const textToCopy = `
MEDICAL NOTE
------------
PRESENTING COMPLAINTS:
${noteComplaints.innerText}

PAST HISTORY:
${noteHistory.innerText}

INVESTIGATIONS ORDERED:
${noteInvestigations.innerText}

DIAGNOSIS:
${noteDiagnosis.innerText}

TREATMENT:
${noteTreatment.innerText}

FOLLOW-UP:
${noteFollowup.innerText}
        `.trim();

        navigator.clipboard.writeText(textToCopy).then(() => {
            const btn = document.getElementById('copy-note');
            const originalText = btn.innerText;
            btn.innerText = 'Copied!';
            btn.style.background = 'var(--success)';
            setTimeout(() => {
                btn.innerText = originalText;
                btn.style.background = '';
            }, 2000);
        });
    });

    // Print functionality
    document.getElementById('print-btn').addEventListener('click', () => {
        window.print();
    });
});
