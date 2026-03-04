// ── Shared helpers ────────────────────────────────────────────────────────────

const BASE_URL = window.location.port === '3000' ? 'http://localhost:8000' : '';

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
