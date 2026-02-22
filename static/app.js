// ── Shared helpers (used by both displayResults and renderNoteHTML) ──────────

function formatItem(item) {
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
}

function formatList(list) {
    if (!list) return 'Not mentioned';
    if (typeof list === 'string') return list;
    if (!Array.isArray(list)) return `• ${formatItem(list)}`;
    if (list.length === 0) return 'Not mentioned';
    return list.map(item => `• ${formatItem(item)}`).join('\n');
}

function formatTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
        + ' — ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Backend base URL ─────────────────────────────────────────────────────────

const BASE_URL = window.location.port === '3000' ? 'http://localhost:8000' : '';

// ── Screen Management ────────────────────────────────────────────────────────

function showScreen(name) {
    document.getElementById('section-hero').classList.toggle('hidden', name !== 'home');
    document.getElementById('patient-search-bar').classList.toggle('hidden', name !== 'home');
    document.getElementById('section-scribe').classList.toggle('hidden', name !== 'home');
    document.getElementById('screen-daily').classList.toggle('hidden', name !== 'daily');
    document.getElementById('screen-history').classList.toggle('hidden', name !== 'history');

    if (name === 'daily') loadDailyList();
}

// ── Patient Lookup & Intake ──────────────────────────────────────────────────

async function lookupPatient(mrn) {
    try {
        const res = await fetch(`${BASE_URL}/patients/${encodeURIComponent(mrn)}`);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// ── Daily Patient List ───────────────────────────────────────────────────────

async function loadDailyList() {
    const picker = document.getElementById('daily-date-picker');
    const date = picker.value || new Date().toISOString().split('T')[0];
    if (!picker.value) picker.value = date;

    const container = document.getElementById('daily-list-container');
    const empty = document.getElementById('daily-empty-state');
    container.innerHTML = '<p class="empty-state-inline">Loading...</p>';
    empty.classList.add('hidden');

    try {
        const res = await fetch(`${BASE_URL}/daily?date=${date}`);
        if (!res.ok) throw new Error('Failed to load daily list');
        const entries = await res.json();

        if (entries.length === 0) {
            container.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        container.innerHTML = entries.map(e => {
            const initials = (e.patient.full_name || e.patient.mrn).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
            const sexLabel = e.patient.sex === 'M' ? 'M' : e.patient.sex === 'F' ? 'F' : e.patient.sex || '—';
            return `
            <div class="patient-row" onclick="showPatientHistory('${escAttr(e.patient.mrn)}')" style="cursor:pointer">
                <div class="patient-row-left">
                    <div class="patient-avatar-sm">${escHtml(initials)}</div>
                    <div class="patient-row-main">
                        <span class="patient-name">${escHtml(e.patient.full_name || '—')}</span>
                        <span class="patient-mrn">${escHtml(e.patient.mrn)} &nbsp;·&nbsp; ${escHtml(sexLabel)}${e.patient.age ? ' &nbsp;·&nbsp; ' + e.patient.age + ' yrs' : ''}</span>
                    </div>
                </div>
                <div class="patient-row-meta">
                    <span class="enc-count-badge">${e.encounter_count}</span>
                    <span class="last-seen">Last seen ${formatTime(e.last_encounter_at)}</span>
                    <button class="copy-btn" onclick="event.stopPropagation(); showPatientHistory('${escAttr(e.patient.mrn)}')">View History</button>
                </div>
            </div>
        `}).join('');
    } catch (err) {
        container.innerHTML = `<p class="empty-state-inline" style="color:var(--error, #f87171)">Failed to load patients: ${escHtml(err.message)}</p>`;
    }
}

// ── Patient Encounter History ────────────────────────────────────────────────

// Tracks which encounter is currently being edited
const _editingEncounters = new Set();

async function showPatientHistory(mrn) {
    showScreen('history');
    document.getElementById('history-patient-name').textContent = 'Loading...';
    document.getElementById('history-patient-demo').innerHTML = '';
    document.getElementById('history-encounter-list').innerHTML = '<p class="empty-state-inline">Loading...</p>';
    document.getElementById('history-empty-state').classList.add('hidden');

    try {
        const [patRes, encRes] = await Promise.all([
            fetch(`${BASE_URL}/patients/${encodeURIComponent(mrn)}`),
            fetch(`${BASE_URL}/patients/${encodeURIComponent(mrn)}/encounters`)
        ]);

        if (!patRes.ok) throw new Error('Patient not found');
        const patData = await patRes.json();
        const encounters = encRes.ok ? await encRes.json() : [];

        const p = patData.patient;

        // Patient avatar initials
        const initials = (p.full_name || mrn).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const sexLabel = p.sex === 'M' ? 'Male' : p.sex === 'F' ? 'Female' : p.sex || '—';

        document.getElementById('history-patient-name').textContent = p.full_name || mrn;
        document.getElementById('history-patient-demo').innerHTML = `
            <div class="patient-avatar">${escHtml(initials)}</div>
            <div class="patient-demo-details">
                <div class="demo-chip"><span class="demo-label">MRN</span><span class="demo-value">${escHtml(p.mrn)}</span></div>
                <div class="demo-chip"><span class="demo-label">Sex</span><span class="demo-value">${escHtml(sexLabel)}</span></div>
                <div class="demo-chip"><span class="demo-label">Age</span><span class="demo-value">${p.age ? p.age + ' yrs' : '—'}</span></div>
                <div class="demo-chip"><span class="demo-label">Encounters</span><span class="demo-value enc-count-badge">${patData.encounter_count}</span></div>
            </div>
            <button class="copy-btn new-enc-btn" onclick="showScreen('home'); document.getElementById('intake-mrn').value='${escAttr(p.mrn)}'; document.getElementById('intake-name').value='${escAttr(p.full_name || '')}'; document.getElementById('intake-sex').value='${escAttr(p.sex || '')}'; document.getElementById('intake-age').value='${escAttr(p.age ? String(p.age) : '')}'; document.getElementById('prior-encounter-banner').textContent='${escAttr(patData.encounter_count + ' prior encounter' + (patData.encounter_count !== 1 ? 's' : '') + ' found')}'; document.getElementById('prior-encounter-banner').classList.remove('hidden'); document.getElementById('view-history-btn').classList.remove('hidden');">+ New Encounter</button>
        `;

        const list = document.getElementById('history-encounter-list');
        const empty = document.getElementById('history-empty-state');

        if (encounters.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        list.innerHTML = encounters.map((enc, idx) => `
            <div class="encounter-entry"
                 data-id="${enc.id}"
                 data-mrn="${escAttr(p.mrn)}"
                 data-patient-name="${escAttr(p.full_name || p.mrn)}"
                 data-recorded-at="${escAttr(enc.recorded_at)}">
                <div class="encounter-header" onclick="toggleEncounter(${enc.id})">
                    <div class="encounter-index">#${idx + 1}</div>
                    <div class="encounter-header-main">
                        <span class="encounter-date">${formatDateTime(enc.recorded_at)}</span>
                        <span class="encounter-preview" id="enc-preview-${enc.id}">${escHtml(enc.note_preview || 'No preview available')}</span>
                    </div>
                    <span class="encounter-toggle" id="toggle-icon-${enc.id}">▸</span>
                </div>
                <div class="encounter-body hidden" id="encounter-body-${enc.id}"></div>
            </div>
        `).join('');
    } catch (err) {
        document.getElementById('history-encounter-list').innerHTML =
            `<p class="empty-state-inline" style="color:var(--error, #f87171)">Error: ${escHtml(err.message)}</p>`;
    }
}

async function toggleEncounter(id) {
    const body = document.getElementById(`encounter-body-${id}`);
    const icon = document.getElementById(`toggle-icon-${id}`);

    if (!body.classList.contains('hidden')) {
        body.classList.add('hidden');
        icon.textContent = '▸';
        return;
    }

    if (!body.dataset.loaded) {
        body.innerHTML = '<p class="empty-state-inline">Loading...</p>';
        body.classList.remove('hidden');
        try {
            const res = await fetch(`${BASE_URL}/encounters/${id}`);
            if (!res.ok) throw new Error('Failed to load encounter');
            const enc = await res.json();
            // Read patient metadata stored on the entry element
            const entry = body.closest('.encounter-entry');
            const meta = {
                mrn: entry?.dataset.mrn || '',
                patientName: entry?.dataset.patientName || '',
                recordedAt: entry?.dataset.recordedAt || enc.recorded_at,
            };
            body.innerHTML = renderEncounterBody(id, enc, meta);
            body.dataset.loaded = 'true';
        } catch (err) {
            body.innerHTML = `<p class="empty-state-inline" style="color:var(--error, #f87171)">Error: ${escHtml(err.message)}</p>`;
            return;
        }
    } else {
        body.classList.remove('hidden');
    }

    icon.textContent = '▾';
}

// _encMeta stores {mrn, patientName, recordedAt} keyed by encounter id
const _encMeta = {};

function renderEncounterBody(id, enc, meta = {}) {
    // Store metadata for PDF/print access
    _encMeta[id] = {
        mrn: meta.mrn || '',
        patientName: meta.patientName || '',
        recordedAt: meta.recordedAt || enc.recorded_at,
    };

    const sectionDefs = [
        { key: 'complaints',     title: 'Presenting Complaints',  content: formatList(enc.note.presenting_complaints) },
        { key: 'history',        title: 'Past History',           content: formatList(enc.note.past_history) },
        { key: 'investigations', title: 'Investigations Ordered', content: formatList(enc.note.investigations_ordered) },
        { key: 'diagnosis',      title: 'Diagnosis',              content: formatList(enc.note.diagnosis) },
        { key: 'treatment',      title: 'Treatment',              content: formatList(enc.note.treatment) },
        { key: 'followup',       title: 'Follow-up',              content: enc.note.follow_up || 'Not mentioned' },
    ];

    const sectionsHTML = sectionDefs.map(s => `
        <div class="section">
            <h3>${escHtml(s.title)}</h3>
            <div class="content-placeholder enc-editable-field" id="enc-${id}-${s.key}">${escHtml(s.content)}</div>
        </div>
    `).join('');

    return `
        <div class="encounter-note-toolbar" id="enc-toolbar-${id}">
            <button class="enc-action-btn" onclick="toggleEncounterEdit(${id})" id="enc-edit-btn-${id}">Edit</button>
            <button class="enc-action-btn" onclick="downloadEncounterPDF(${id})">Download PDF</button>
            <button class="enc-action-btn" onclick="printEncounter(${id})">Print</button>
        </div>
        <div class="encounter-note-sections" id="enc-sections-${id}">
            ${sectionsHTML}
        </div>
    `;
}

async function toggleEncounterEdit(id) {
    const btn = document.getElementById(`enc-edit-btn-${id}`);
    const fields = document.querySelectorAll(`#encounter-body-${id} .enc-editable-field`);
    const isEditing = _editingEncounters.has(id);

    if (!isEditing) {
        // Enter edit mode
        fields.forEach(f => {
            f.contentEditable = 'true';
            f.classList.add('editing');
        });
        btn.textContent = 'Save Changes';
        btn.classList.add('enc-action-btn-active');
        _editingEncounters.add(id);
    } else {
        // Save mode — read current text and build updated note payload
        btn.textContent = 'Saving...';
        btn.disabled = true;

        const getValue = key => {
            const el = document.getElementById(`enc-${id}-${key}`);
            return el ? el.innerText.trim() : '';
        };

        // Convert bullet text back to structured arrays
        const parseList = (text, builder) => {
            if (!text || text === 'Not mentioned') return [];
            return text.split('\n')
                .map(l => l.replace(/^•\s*/, '').trim())
                .filter(Boolean)
                .map(builder);
        };

        const updatedNote = {
            presenting_complaints: parseList(getValue('complaints'), t => ({ complaint: t })),
            past_history:          parseList(getValue('history'),    t => ({ history_item: t })),
            investigations_ordered:parseList(getValue('investigations'), t => ({ test: t })),
            diagnosis:             parseList(getValue('diagnosis'),  t => ({ diagnosis: t, type: 'primary' })),
            treatment:             parseList(getValue('treatment'),  t => ({ treatment: t })),
            follow_up:             getValue('followup') || 'Not mentioned',
        };

        try {
            const res = await fetch(`${BASE_URL}/encounters/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: updatedNote }),
            });
            if (!res.ok) throw new Error('Save failed');

            // Exit edit mode
            fields.forEach(f => {
                f.contentEditable = 'false';
                f.classList.remove('editing');
            });
            btn.textContent = 'Edit';
            btn.classList.remove('enc-action-btn-active');
            btn.disabled = false;
            _editingEncounters.delete(id);

            // Update the preview snippet in the encounter header
            const firstComplaint = updatedNote.presenting_complaints[0]?.complaint || '';
            const previewEl = document.getElementById(`enc-preview-${id}`);
            if (previewEl && firstComplaint) previewEl.textContent = firstComplaint.slice(0, 120);

            // Brief "Saved" flash
            const toolbar = document.getElementById(`enc-toolbar-${id}`);
            const flash = document.createElement('span');
            flash.className = 'save-flash';
            flash.textContent = 'Saved';
            toolbar.appendChild(flash);
            setTimeout(() => flash.remove(), 2000);

            // Invalidate lazy cache so next open re-fetches
            document.getElementById(`encounter-body-${id}`).dataset.loaded = '';
        } catch (err) {
            btn.textContent = 'Save Changes';
            btn.disabled = false;
            alert('Could not save changes: ' + err.message);
        }
    }
}

// Shared section definitions for PDF/print
const _encSections = [
    { title: 'Presenting Complaints',  key: 'complaints' },
    { title: 'Past History',           key: 'history' },
    { title: 'Investigations Ordered', key: 'investigations' },
    { title: 'Diagnosis',              key: 'diagnosis' },
    { title: 'Treatment',              key: 'treatment' },
    { title: 'Follow-up',              key: 'followup' },
];

function _encFilename(id, ext) {
    const meta = _encMeta[id] || {};
    const namePart = (meta.patientName || meta.mrn || `Encounter_${id}`)
        .replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
    const datePart = meta.recordedAt
        ? new Date(meta.recordedAt).toLocaleDateString('en-CA') // YYYY-MM-DD
        : new Date().toLocaleDateString('en-CA');
    return `${namePart}_${datePart}.${ext}`;
}

function downloadEncounterPDF(id) {
    const meta = _encMeta[id] || {};
    const encDate = meta.recordedAt
        ? new Date(meta.recordedAt).toLocaleDateString([], { dateStyle: 'long' })
        : new Date().toLocaleDateString([], { dateStyle: 'long' });
    const filename = _encFilename(id, 'pdf');

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const margin = 20, pageWidth = 210, contentWidth = pageWidth - 2 * margin;
    let y = 20;

    // Title
    doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.setTextColor(30);
    doc.text('Clinical Medical Note', pageWidth / 2, y, { align: 'center' });
    y += 7;

    // Patient info header
    doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(80);
    if (meta.patientName) {
        doc.text(`Patient: ${meta.patientName}`, margin, y);
        doc.text(`MRN: ${meta.mrn}`, pageWidth / 2, y, { align: 'center' });
    }
    doc.text(`Date: ${encDate}`, pageWidth - margin, y, { align: 'right' });
    y += 5;

    doc.setLineWidth(0.4); doc.setDrawColor(150); doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    _encSections.forEach(s => {
        const el = document.getElementById(`enc-${id}-${s.key}`);
        const content = el ? el.innerText.trim() : 'Not mentioned';

        // Section heading
        doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 86, 219);
        if (y > 265) { doc.addPage(); y = 20; }
        doc.text(s.title, margin, y); y += 2;
        doc.setDrawColor(26, 86, 219); doc.setLineWidth(0.25);
        doc.line(margin, y, pageWidth - margin, y); y += 5;

        // Content
        doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(50);
        doc.splitTextToSize(content || 'Not mentioned', contentWidth - 8).forEach(line => {
            if (y > 272) { doc.addPage(); y = 20; }
            doc.text(line, margin + 4, y); y += 5.5;
        });
        y += 5;
    });

    doc.save(filename);
}

function printEncounter(id) {
    const meta = _encMeta[id] || {};
    const encDate = meta.recordedAt
        ? new Date(meta.recordedAt).toLocaleDateString([], { dateStyle: 'long' })
        : new Date().toLocaleDateString([], { dateStyle: 'long' });

    // Patient info row — matches PDF header layout exactly
    let patientInfoRow = `<span>Date: <strong>${escHtml(encDate)}</strong></span>`;
    if (meta.patientName) {
        patientInfoRow =
            `<span>Patient: <strong>${escHtml(meta.patientName)}</strong></span>` +
            `<span>MRN: <strong>${escHtml(meta.mrn)}</strong></span>` +
            `<span>Date: <strong>${escHtml(encDate)}</strong></span>`;
    }

    const sections = _encSections.map(s => {
        const el = document.getElementById(`enc-${id}-${s.key}`);
        const content = (el ? el.innerText.trim() : 'Not mentioned').replace(/\n/g, '<br>');
        return `<div class="print-section"><h3>${escHtml(s.title)}</h3><div class="print-section-content">${content}</div></div>`;
    }).join('');

    document.getElementById('print-note-body').innerHTML =
        `<div class="print-patient-header">${patientInfoRow}</div>` +
        `<hr class="print-header-rule">` +
        sections;

    window.print();
}

// ── Patient Search ───────────────────────────────────────────────────────────

async function runSearch() {
    const q = document.getElementById('search-input').value.trim();
    const container = document.getElementById('search-results');
    if (q.length < 2) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = '<p class="empty-state-inline">Searching...</p>';

    try {
        const res = await fetch(`${BASE_URL}/patients/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error('Search failed');
        const results = await res.json();

        if (results.length === 0) {
            container.innerHTML = '<p class="empty-state-inline">No patients found.</p>';
            return;
        }

        container.innerHTML = results.map(r => `
            <div class="search-result-row">
                <span class="patient-mrn">${escHtml(r.patient.mrn)}</span>
                <span class="patient-name">${escHtml(r.patient.full_name || '—')}</span>
                <span style="color:var(--text-secondary);font-size:0.85rem">${escHtml(r.patient.sex || '—')} / ${r.patient.age ? r.patient.age + ' yrs' : '—'}</span>
                <button class="copy-btn" onclick="showPatientHistory('${escAttr(r.patient.mrn)}')">View</button>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<p class="empty-state-inline" style="color:var(--error, #f87171)">Error: ${escHtml(err.message)}</p>`;
    }
}

// ── XSS-safe escaping helpers ────────────────────────────────────────────────

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escAttr(str) {
    return String(str ?? '').replace(/'/g, "\\'");
}

// ── Main DOMContentLoaded ────────────────────────────────────────────────────

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

    // ── Patient Intake Handlers ──────────────────────────────────────────────

    document.getElementById('intake-mrn').addEventListener('blur', async () => {
        const mrn = document.getElementById('intake-mrn').value.trim();
        const banner = document.getElementById('prior-encounter-banner');
        const viewBtn = document.getElementById('view-history-btn');

        if (!mrn) {
            banner.classList.add('hidden');
            viewBtn.classList.add('hidden');
            return;
        }

        const data = await lookupPatient(mrn);
        if (data && data.exists) {
            document.getElementById('intake-name').value = data.patient.full_name || '';
            document.getElementById('intake-sex').value = data.patient.sex || '';
            document.getElementById('intake-age').value = data.patient.age || '';
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

    document.getElementById('history-back-btn').addEventListener('click', () => {
        showScreen('daily');
    });

    // ── Daily List Controls ──────────────────────────────────────────────────

    document.getElementById('daily-date-picker').addEventListener('change', loadDailyList);
    document.getElementById('daily-refresh-btn').addEventListener('click', loadDailyList);

    // ── Search Controls ──────────────────────────────────────────────────────

    document.getElementById('search-btn').addEventListener('click', runSearch);
    document.getElementById('search-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') runSearch();
    });

    // ── Recording Logic ──────────────────────────────────────────────────────

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
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                           : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
                           : '';
            mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const actualMime = mediaRecorder.mimeType || 'audio/webm';
                const ext = actualMime.includes('webm') ? 'webm' : actualMime.includes('ogg') ? 'ogg' : 'wav';
                const audioBlob = new Blob(audioChunks, { type: actualMime });
                processRecording(audioBlob, ext);
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

    async function processRecording(audioBlob, ext = 'webm') {
        loadingOverlay.classList.remove('hidden');
        console.log('Sending audio to backend for analysis...', audioBlob.size, 'bytes', 'type:', audioBlob.type);

        try {
            const formData = new FormData();
            formData.append('audio', audioBlob, `recording.${ext}`);

            // Attach patient info if provided
            const mrn = document.getElementById('intake-mrn').value.trim();
            if (mrn) {
                formData.append('mrn', mrn);
                formData.append('full_name', document.getElementById('intake-name').value.trim());
                formData.append('sex', document.getElementById('intake-sex').value);
                const age = document.getElementById('intake-age').value;
                if (age) formData.append('age', age);
            }

            const response = await fetch(`${BASE_URL}/analyze`, {
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

        // Fill Medical Note
        noteComplaints.innerText = formatList(data.note.presenting_complaints);
        noteHistory.innerText = formatList(data.note.past_history);
        noteInvestigations.innerText = formatList(data.note.investigations_ordered);
        noteDiagnosis.innerText = formatList(data.note.diagnosis);
        noteTreatment.innerText = formatList(data.note.treatment);
        noteFollowup.innerText = data.note.follow_up || 'Not mentioned';

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
                <h3>${escHtml(s.title)}</h3>
                <div class="print-section-content">${escHtml(s.content)}</div>
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

    // ── Edit functionality ───────────────────────────────────────────────────

    editBtn.addEventListener('click', () => {
        const sections = [
            noteComplaints, noteHistory, noteInvestigations,
            noteDiagnosis, noteTreatment, noteFollowup
        ];

        isEditingNotes = !isEditingNotes;

        if (isEditingNotes) {
            sections.forEach(s => {
                s.contentEditable = 'true';
                s.classList.add('editing');
            });
            editBtn.innerText = 'Save Changes';
            editBtn.style.background = 'var(--accent)';
        } else {
            sections.forEach(s => {
                s.contentEditable = 'false';
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
                    <h3>${escHtml(sectionTitles[i])}</h3>
                    <div class="print-section-content">${s.innerText.replace(/\n/g, '<br>')}</div>
                </div>
            `).join('');
        }
    });

    // ── PDF generation ───────────────────────────────────────────────────────

    pdfBtn.addEventListener('click', async () => {
        let filename = prompt('Enter a name for the PDF file:', 'Medical_Note_' + new Date().toLocaleDateString().replace(/\//g, '-'));
        if (filename === null) return;
        if (!filename.trim()) filename = 'AuraScribe_Medical_Note';
        if (!filename.endsWith('.pdf')) filename += '.pdf';

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            let yPosition = 20;
            const pageWidth = 210;
            const margin = 20;
            const contentWidth = pageWidth - (2 * margin);

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

            sections.forEach((section) => {
                doc.setFontSize(14);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(26, 86, 219);
                doc.text(section.title, margin, yPosition);
                yPosition += 2;

                doc.setDrawColor(26, 86, 219);
                doc.setLineWidth(0.3);
                doc.line(margin, yPosition, pageWidth - margin, yPosition);
                yPosition += 6;

                doc.setFontSize(11);
                doc.setFont(undefined, 'normal');
                doc.setTextColor(50);

                const content = section.element.innerText || 'Not mentioned';
                const lines = doc.splitTextToSize(content, contentWidth - 10);

                lines.forEach(line => {
                    if (yPosition > 270) {
                        doc.addPage();
                        yPosition = 20;
                    }
                    doc.text(line, margin + 5, yPosition);
                    yPosition += 6;
                });

                yPosition += 5;
            });

            doc.save(filename);
        } catch (error) {
            console.error('PDF generation failed:', error);
            alert('Could not generate PDF: ' + error.message);
        }
    });

    // ── Copy to clipboard ────────────────────────────────────────────────────

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

    // ── Print ────────────────────────────────────────────────────────────────

    document.getElementById('print-btn').addEventListener('click', () => {
        window.print();
    });
});
