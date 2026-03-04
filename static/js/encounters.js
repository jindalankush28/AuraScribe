// ── Encounter History & Editing ───────────────────────────────────────────────

const _editingEncounters = new Set();
const _encMeta = {}; // { [id]: { mrn, patientName, recordedAt } }

const _encSections = [
    { title: 'Presenting Complaints',  key: 'complaints' },
    { title: 'Past History',           key: 'history' },
    { title: 'Investigations Ordered', key: 'investigations' },
    { title: 'Diagnosis',              key: 'diagnosis' },
    { title: 'Treatment',              key: 'treatment' },
    { title: 'Follow-up',              key: 'followup' },
];

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

function renderEncounterBody(id, enc, meta = {}) {
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
        fields.forEach(f => { f.contentEditable = 'true'; f.classList.add('editing'); });
        btn.textContent = 'Save Changes';
        btn.classList.add('enc-action-btn-active');
        _editingEncounters.add(id);
        return;
    }

    btn.textContent = 'Saving...';
    btn.disabled = true;

    const getValue = key => {
        const el = document.getElementById(`enc-${id}-${key}`);
        return el ? el.innerText.trim() : '';
    };
    const parseList = (text, builder) => {
        if (!text || text === 'Not mentioned') return [];
        return text.split('\n').map(l => l.replace(/^•\s*/, '').trim()).filter(Boolean).map(builder);
    };

    const updatedNote = {
        presenting_complaints:  parseList(getValue('complaints'),     t => ({ complaint: t })),
        past_history:           parseList(getValue('history'),        t => ({ history_item: t })),
        investigations_ordered: parseList(getValue('investigations'), t => ({ test: t })),
        diagnosis:              parseList(getValue('diagnosis'),      t => ({ diagnosis: t, type: 'primary' })),
        treatment:              parseList(getValue('treatment'),      t => ({ treatment: t })),
        follow_up:              getValue('followup') || 'Not mentioned',
    };

    try {
        const res = await fetch(`${BASE_URL}/encounters/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: updatedNote }),
        });
        if (!res.ok) throw new Error('Save failed');

        fields.forEach(f => { f.contentEditable = 'false'; f.classList.remove('editing'); });
        btn.textContent = 'Edit';
        btn.classList.remove('enc-action-btn-active');
        btn.disabled = false;
        _editingEncounters.delete(id);

        const firstComplaint = updatedNote.presenting_complaints[0]?.complaint || '';
        const previewEl = document.getElementById(`enc-preview-${id}`);
        if (previewEl && firstComplaint) previewEl.textContent = firstComplaint.slice(0, 120);

        const flash = document.createElement('span');
        flash.className = 'save-flash';
        flash.textContent = 'Saved';
        document.getElementById(`enc-toolbar-${id}`).appendChild(flash);
        setTimeout(() => flash.remove(), 2000);

        document.getElementById(`encounter-body-${id}`).dataset.loaded = '';
    } catch (err) {
        btn.textContent = 'Save Changes';
        btn.disabled = false;
        alert('Could not save changes: ' + err.message);
    }
}

// ── Encounter PDF & Print ─────────────────────────────────────────────────────

function _encFilename(id, ext) {
    const meta = _encMeta[id] || {};
    const namePart = (meta.patientName || meta.mrn || `Encounter_${id}`)
        .replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_');
    const datePart = meta.recordedAt
        ? new Date(meta.recordedAt).toLocaleDateString('en-CA')
        : new Date().toLocaleDateString('en-CA');
    return `${namePart}_${datePart}.${ext}`;
}

function downloadEncounterPDF(id) {
    const meta = _encMeta[id] || {};
    const encDate = meta.recordedAt
        ? new Date(meta.recordedAt).toLocaleDateString([], { dateStyle: 'long' })
        : new Date().toLocaleDateString([], { dateStyle: 'long' });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const margin = 20, pageWidth = 210, contentWidth = pageWidth - 2 * margin;
    let y = 20;

    doc.setFontSize(18); doc.setFont(undefined, 'bold'); doc.setTextColor(30);
    doc.text('Clinical Medical Note', pageWidth / 2, y, { align: 'center' });
    y += 7;

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

        doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(26, 86, 219);
        if (y > 265) { doc.addPage(); y = 20; }
        doc.text(s.title, margin, y); y += 2;
        doc.setDrawColor(26, 86, 219); doc.setLineWidth(0.25);
        doc.line(margin, y, pageWidth - margin, y); y += 5;

        doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(50);
        doc.splitTextToSize(content || 'Not mentioned', contentWidth - 8).forEach(line => {
            if (y > 272) { doc.addPage(); y = 20; }
            doc.text(line, margin + 4, y); y += 5.5;
        });
        y += 5;
    });

    doc.save(_encFilename(id, 'pdf'));
}

function printEncounter(id) {
    const meta = _encMeta[id] || {};
    const encDate = meta.recordedAt
        ? new Date(meta.recordedAt).toLocaleDateString([], { dateStyle: 'long' })
        : new Date().toLocaleDateString([], { dateStyle: 'long' });

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
