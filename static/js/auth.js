// ── Auth ──────────────────────────────────────────────────────────────────────

async function initAuth() {
    try {
        const res = await fetch(`${BASE_URL}/auth/me`, { credentials: 'include' });
        if (!res.ok) { showLoginScreen(); return; }
        const user = await res.json();
        showApp(user);
    } catch {
        showLoginScreen();
    }
}

function showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.querySelector('nav').classList.add('hidden');
    document.querySelector('main').classList.add('hidden');
    document.querySelector('footer').classList.add('hidden');
}

function showApp(user) {
    document.getElementById('login-screen').classList.add('hidden');
    document.querySelector('nav').classList.remove('hidden');
    document.querySelector('main').classList.remove('hidden');
    document.querySelector('footer').classList.remove('hidden');

    const navUser = document.getElementById('nav-user');
    navUser.classList.remove('hidden');
    document.getElementById('nav-avatar').src = user.picture || '';
    document.getElementById('nav-user-name').textContent = user.name || user.email;
}

initAuth();
