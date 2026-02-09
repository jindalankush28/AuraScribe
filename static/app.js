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

    // Save as PDF functionality - Direct jsPDF approach (most reliable)
    pdfBtn.addEventListener('click', async () => {
        // Prompt for filename
        let filename = prompt("Enter a name for the PDF file:", "Medical_Note_" + new Date().toLocaleDateString().replace(/\//g, '-'));
        if (filename === null) return;
        if (!filename.trim()) filename = "AuraScribe_Medical_Note";
        if (!filename.endsWith('.pdf')) filename += '.pdf';

        try {
            // Import jsPDF
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            let yPosition = 20;
            const pageWidth = 210;
            const margin = 20;
            const contentWidth = pageWidth - (2 * margin);

            // Title
            doc.setFontSize(20);
            doc.setFont(undefined, 'bold');
            doc.text('Clinical Medical Note', pageWidth / 2, yPosition, { align: 'center' });

            yPosition += 5;
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(100);
            doc.text(new Date().toLocaleDateString(), pageWidth / 2, yPosition, { align: 'center' });

            yPosition += 10;
            doc.setLineWidth(0.5);
            doc.line(margin, yPosition, pageWidth - margin, yPosition);
            yPosition += 10;

            const sections = [
                { title: 'Presenting Complaints', element: noteComplaints },
                { title: 'Past History', element: noteHistory },
                { title: 'Investigations Ordered', element: noteInvestigations },
                { title: 'Diagnosis', element: noteDiagnosis },
                { title: 'Treatment', element: noteTreatment },
                { title: 'Follow-up', element: noteFollowup }
            ];

            sections.forEach((section, index) => {
                // Section title
                doc.setFontSize(14);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(26, 86, 219); // Blue color
                doc.text(section.title, margin, yPosition);
                yPosition += 2;

                // Underline
                doc.setDrawColor(26, 86, 219);
                doc.setLineWidth(0.3);
                doc.line(margin, yPosition, pageWidth - margin, yPosition);
                yPosition += 6;

                // Section content
                doc.setFontSize(11);
                doc.setFont(undefined, 'normal');
                doc.setTextColor(50);

                const content = section.element.innerText || 'Not mentioned';
                const lines = doc.splitTextToSize(content, contentWidth - 10);

                lines.forEach(line => {
                    if (yPosition > 270) { // Check if we need a new page
                        doc.addPage();
                        yPosition = 20;
                    }
                    doc.text(line, margin + 5, yPosition);
                    yPosition += 6;
                });

                yPosition += 5; // Space between sections
            });

            // Save the PDF
            doc.save(filename);
            console.log('PDF saved successfully');

        } catch (error) {
            console.error('PDF generation failed:', error);
            alert('Could not generate PDF: ' + error.message);
        }
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
