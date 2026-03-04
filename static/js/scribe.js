// ── Scribe: Recording, Results, Edit, PDF, Copy, Print ───────────────────────

document.addEventListener('DOMContentLoaded', () => {
    let mediaRecorder;
    let audioChunks = [];
    let startTime;
    let timerInterval;
    let isRecording = false;

    const recordBtn       = document.getElementById('record-btn');
    const recordText      = document.getElementById('record-text');
    const recordIcon      = document.getElementById('record-icon');
    const timerDisplay    = document.getElementById('timer');
    const statusContainer = document.getElementById('recording-status');
    const outputContainer = document.getElementById('output-container');
    const loadingOverlay  = document.getElementById('loading-overlay');

    const noteComplaints    = document.getElementById('note-complaints');
    const noteHistory       = document.getElementById('note-history');
    const noteInvestigations= document.getElementById('note-investigations');
    const noteDiagnosis     = document.getElementById('note-diagnosis');
    const noteTreatment     = document.getElementById('note-treatment');
    const noteFollowup      = document.getElementById('note-followup');
    const patientQuestions  = document.getElementById('patient-questions');
    const editBtn           = document.getElementById('edit-note');
    const pdfBtn            = document.getElementById('pdf-btn');
    let isEditingNotes = false;

    // ── Patient Intake ────────────────────────────────────────────────────────

    document.getElementById('intake-mrn').addEventListener('blur', async () => {
        const mrn = document.getElementById('intake-mrn').value.trim();
        const banner = document.getElementById('prior-encounter-banner');
        const viewBtn = document.getElementById('view-history-btn');

        if (!mrn) { banner.classList.add('hidden'); viewBtn.classList.add('hidden'); return; }

        const data = await lookupPatient(mrn);
        if (data && data.exists) {
            document.getElementById('intake-name').value = data.patient.full_name || '';
            document.getElementById('intake-sex').value  = data.patient.sex || '';
            document.getElementById('intake-age').value  = data.patient.age || '';
            banner.textContent = `${data.encounter_count} prior encounter${data.encounter_count !== 1 ? 's' : ''} found`;
            banner.classList.remove('hidden');
            viewBtn.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
            viewBtn.classList.add('hidden');
        }
    });

    document.getElementById('view-history-btn').addEventListener('click', () => {
        const mrn = document.getElementById('intake-mrn').value.trim();
        if (mrn) showPatientHistory(mrn);
    });

    document.getElementById('history-back-btn').addEventListener('click', () => showScreen('daily'));

    document.getElementById('nav-signout').addEventListener('click', async () => {
        await fetch(`${BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
        showLoginScreen();
    });

    // ── Daily List & Search ───────────────────────────────────────────────────

    document.getElementById('daily-date-picker').addEventListener('change', loadDailyList);
    document.getElementById('daily-refresh-btn').addEventListener('click', loadDailyList);
    document.getElementById('search-btn').addEventListener('click', runSearch);
    document.getElementById('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });

    // ── Recording ─────────────────────────────────────────────────────────────

    recordBtn.addEventListener('click', () => isRecording ? stopRecording() : startRecording());

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                           : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
            mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const actualMime = mediaRecorder.mimeType || 'audio/webm';
                const ext = actualMime.includes('webm') ? 'webm' : actualMime.includes('ogg') ? 'ogg' : 'wav';
                processRecording(new Blob(audioChunks, { type: actualMime }), ext);
            };

            mediaRecorder.start();
            isRecording = true;

            recordBtn.classList.add('recording');
            recordIcon.innerText = '⏹️';
            recordText.innerText = 'Stop Recording';
            timerDisplay.classList.remove('hidden');
            statusContainer.classList.remove('hidden');
            outputContainer.classList.add('hidden');
            startTimer();
        } catch (err) {
            console.error('Microphone error:', err);
            alert('Could not access microphone. Please ensure you have granted permission.');
        }
    }

    function stopRecording() {
        if (!mediaRecorder || !isRecording) return;
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        isRecording = false;

        recordBtn.classList.remove('recording');
        recordIcon.innerText = '🎤';
        recordText.innerText = 'Start Recording';
        timerDisplay.classList.add('hidden');
        statusContainer.classList.add('hidden');
        stopTimer();
    }

    function startTimer() {
        startTime = Date.now();
        timerInterval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const m = Math.floor(elapsed / 60000);
            const s = Math.floor((elapsed % 60000) / 1000);
            timerDisplay.innerText = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }, 1000);
    }

    function stopTimer() { clearInterval(timerInterval); }

    async function processRecording(audioBlob, ext = 'webm') {
        loadingOverlay.classList.remove('hidden');

        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, `recording.${ext}`);

            const mrn = document.getElementById('intake-mrn').value.trim();
            if (mrn) {
                formData.append('mrn', mrn);
                formData.append('full_name', document.getElementById('intake-name').value.trim());
                formData.append('sex', document.getElementById('intake-sex').value);
                const age = document.getElementById('intake-age').value;
                if (age) formData.append('age', age);
            }

            const response = await fetch(`${BASE_URL}/analyze`, { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            displayResults(await response.json());
        } catch (error) {
            console.error('Analysis failed:', error);
            alert('Consultation analysis failed. Please ensure the backend is running.');
            loadingOverlay.classList.add('hidden');
        }
    }

    // ── Display Results ───────────────────────────────────────────────────────

    function displayResults(data) {
        loadingOverlay.classList.add('hidden');
        outputContainer.classList.remove('hidden');

        const transcriptContainer = document.getElementById('transcript-container');
        const rawTranscript = document.getElementById('raw-transcript');
        if (data.transcript) {
            transcriptContainer.classList.remove('hidden');
            rawTranscript.innerText = data.transcript;
        } else {
            transcriptContainer.classList.add('hidden');
        }

        if (data.error) alert(`Note: We are showing demo data because of an API issue: ${data.error}`);

        noteComplaints.innerText    = formatList(data.note.presenting_complaints);
        noteHistory.innerText       = formatList(data.note.past_history);
        noteInvestigations.innerText= formatList(data.note.investigations_ordered);
        noteDiagnosis.innerText     = formatList(data.note.diagnosis);
        noteTreatment.innerText     = formatList(data.note.treatment);
        noteFollowup.innerText      = data.note.follow_up || 'Not mentioned';

        syncPrintTemplate([
            { title: 'Presenting Complaints',  content: formatList(data.note.presenting_complaints) },
            { title: 'Past History',           content: formatList(data.note.past_history) },
            { title: 'Investigations Ordered', content: formatList(data.note.investigations_ordered) },
            { title: 'Diagnosis',              content: formatList(data.note.diagnosis) },
            { title: 'Treatment',              content: formatList(data.note.treatment) },
            { title: 'Follow-up',              content: data.note.follow_up },
        ]);

        patientQuestions.innerHTML = '';
        data.questions.forEach(q => {
            const li = document.createElement('li');
            li.innerText = q;
            patientQuestions.appendChild(li);
        });

        outputContainer.scrollIntoView({ behavior: 'smooth' });
    }

    function syncPrintTemplate(sections) {
        const patientName = document.getElementById('intake-name').value.trim();
        const patientMrn  = document.getElementById('intake-mrn').value.trim();
        const encDate     = new Date().toLocaleDateString([], { dateStyle: 'long' });

        let patientInfoRow = `<span>Date: <strong>${escHtml(encDate)}</strong></span>`;
        if (patientName) {
            patientInfoRow =
                `<span>Patient: <strong>${escHtml(patientName)}</strong></span>` +
                `<span>MRN: <strong>${escHtml(patientMrn)}</strong></span>` +
                `<span>Date: <strong>${escHtml(encDate)}</strong></span>`;
        }

        document.getElementById('print-note-body').innerHTML =
            `<div class="print-patient-header">${patientInfoRow}</div>` +
            `<hr class="print-header-rule">` +
            sections.map(s => `
                <div class="print-section">
                    <h3>${escHtml(s.title)}</h3>
                    <div class="print-section-content">${escHtml(s.content || 'Not mentioned')}</div>
                </div>
            `).join('');
    }

    // ── Edit ──────────────────────────────────────────────────────────────────

    const noteSections = [noteComplaints, noteHistory, noteInvestigations, noteDiagnosis, noteTreatment, noteFollowup];
    const sectionTitles = ['Presenting Complaints', 'Past History', 'Investigations Ordered', 'Diagnosis', 'Treatment', 'Follow-up'];

    editBtn.addEventListener('click', () => {
        isEditingNotes = !isEditingNotes;

        if (isEditingNotes) {
            noteSections.forEach(s => { s.contentEditable = 'true'; s.classList.add('editing'); });
            editBtn.innerText = 'Save Changes';
            editBtn.style.background = 'var(--accent)';
        } else {
            noteSections.forEach(s => { s.contentEditable = 'false'; s.classList.remove('editing'); });
            editBtn.innerText = 'Edit';
            editBtn.style.background = '';
            syncPrintTemplate(noteSections.map((s, i) => ({ title: sectionTitles[i], content: s.innerText })));
        }
    });

    // ── PDF ───────────────────────────────────────────────────────────────────

    pdfBtn.addEventListener('click', async () => {
        let filename = prompt('Enter a name for the PDF file:', 'Medical_Note_' + new Date().toLocaleDateString().replace(/\//g, '-'));
        if (filename === null) return;
        if (!filename.trim()) filename = 'AuraScribe_Medical_Note';
        if (!filename.endsWith('.pdf')) filename += '.pdf';

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const margin = 20, pageWidth = 210, contentWidth = pageWidth - 2 * margin;
            let y = 20;

            // Title — 18pt bold centered (matches print CSS .print-title)
            doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.setTextColor(30);
            doc.text('Clinical Medical Note', pageWidth / 2, y, { align: 'center' });
            y += 7;

            // Patient info row — 10pt gray (matches print CSS .print-patient-header)
            const patientName = document.getElementById('intake-name').value.trim();
            const patientMrn  = document.getElementById('intake-mrn').value.trim();
            const encDate     = new Date().toLocaleDateString([], { dateStyle: 'long' });
            doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(80);
            if (patientName) {
                doc.text(`Patient: ${patientName}`, margin, y);
                doc.text(`MRN: ${patientMrn}`, pageWidth / 2, y, { align: 'center' });
            }
            doc.text(`Date: ${encDate}`, pageWidth - margin, y, { align: 'right' });
            y += 5;

            // Separator — 0.4pt gray (matches .print-header-rule)
            doc.setLineWidth(0.4); doc.setDrawColor(150);
            doc.line(margin, y, pageWidth - margin, y);
            y += 8;

            // Sections — matches print CSS exactly
            noteSections.forEach((el, i) => {
                // Heading: 12pt bold blue + 0.25pt underline
                doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 86, 219);
                if (y > 265) { doc.addPage(); y = 20; }
                doc.text(sectionTitles[i], margin, y); y += 2;
                doc.setDrawColor(26, 86, 219); doc.setLineWidth(0.25);
                doc.line(margin, y, pageWidth - margin, y); y += 5;

                // Content: 10pt gray, 4mm indent
                doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(50);
                doc.splitTextToSize(el.innerText || 'Not mentioned', contentWidth - 8).forEach(line => {
                    if (y > 272) { doc.addPage(); y = 20; }
                    doc.text(line, margin + 4, y); y += 5.5;
                });
                y += 5;
            });

            doc.save(filename);
        } catch (error) {
            console.error('PDF generation failed:', error);
            alert('Could not generate PDF: ' + error.message);
        }
    });

    // ── Copy ──────────────────────────────────────────────────────────────────

    document.getElementById('copy-note').addEventListener('click', () => {
        const text = [
            'MEDICAL NOTE', '------------',
            'PRESENTING COMPLAINTS:', noteComplaints.innerText, '',
            'PAST HISTORY:', noteHistory.innerText, '',
            'INVESTIGATIONS ORDERED:', noteInvestigations.innerText, '',
            'DIAGNOSIS:', noteDiagnosis.innerText, '',
            'TREATMENT:', noteTreatment.innerText, '',
            'FOLLOW-UP:', noteFollowup.innerText,
        ].join('\n');

        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copy-note');
            const orig = btn.innerText;
            btn.innerText = 'Copied!';
            btn.style.background = 'var(--success)';
            setTimeout(() => { btn.innerText = orig; btn.style.background = ''; }, 2000);
        });
    });

    // ── Print ─────────────────────────────────────────────────────────────────

    document.getElementById('print-btn').addEventListener('click', () => window.print());
});
