// ── Screen Management ─────────────────────────────────────────────────────────

function showScreen(name) {
    document.getElementById('section-hero').classList.toggle('hidden', name !== 'home');
    document.getElementById('patient-search-bar').classList.toggle('hidden', name !== 'home');
    document.getElementById('section-scribe').classList.toggle('hidden', name !== 'home');
    document.getElementById('screen-daily').classList.toggle('hidden', name !== 'daily');
    document.getElementById('screen-history').classList.toggle('hidden', name !== 'history');

    if (name === 'daily') loadDailyList();
}

// ── Patient Lookup ────────────────────────────────────────────────────────────

async function lookupPatient(mrn) {
    try {
        const res = await fetch(`${BASE_URL}/patients/${encodeURIComponent(mrn)}`);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// ── Daily Patient List ────────────────────────────────────────────────────────

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

// ── Patient Search ────────────────────────────────────────────────────────────

async function runSearch() {
    const q = document.getElementById('search-input').value.trim();
    const container = document.getElementById('search-results');
    if (q.length < 2) { container.classList.add('hidden'); return; }
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

// ── Patient History Screen ────────────────────────────────────────────────────

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
