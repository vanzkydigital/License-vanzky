require('dotenv').config();

const express = require('express');
const session = require('express-session');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const app = express();
const DB_PATH = path.join(__dirname, 'data', 'licenses.json');

// ─────────────────────────────────────────────
// Cek konfigurasi wajib
// ─────────────────────────────────────────────
const REQUIRED_ENV = ['ADMIN_SECRET_KEY', 'BOT_API_KEY', 'SESSION_SECRET'];
for (const key of REQUIRED_ENV) {
    if (!process.env[key] || process.env[key].startsWith('ganti-dengan')) {
        console.error(`❌ Env "${key}" belum diisi di file .env! Cek .env.example sebagai contoh.`);
        process.exit(1);
    }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 12 } // 12 jam
}));

// ─────────────────────────────────────────────
// Helper: database JSON sederhana
// ─────────────────────────────────────────────
function loadDb() {
    if (!fs.existsSync(DB_PATH)) return [];
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}
function saveDb(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}
function generateKey() {
    const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    return `VANZ-${part()}-${part()}-${part()}`;
}
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function statusOf(license) {
    if (license.status === 'revoked') return 'revoked';
    if (new Date(license.expiredAt) < new Date()) return 'expired';
    return 'active';
}

// ─────────────────────────────────────────────
// Helper render HTML template (ganti placeholder __XXX__)
// ─────────────────────────────────────────────
function render(viewFile, replacements = {}) {
    let html = fs.readFileSync(path.join(__dirname, 'views', viewFile), 'utf-8');
    for (const [key, value] of Object.entries(replacements)) {
        html = html.split(`__${key}__`).join(value);
    }
    return html;
}

function buildTableHtml(licenses) {
    if (!licenses.length) {
        return `<div class="empty-state">Belum ada license yang dibuat.</div>`;
    }
    const rows = licenses
        .slice()
        .reverse()
        .map((l) => {
            const st = statusOf(l);
            const badge = st === 'active' ? '<span class="badge active">Aktif</span>'
                        : st === 'expired' ? '<span class="badge expired">Expired</span>'
                        : '<span class="badge revoked">Direvoke</span>';
            const revokeBtn = st !== 'revoked'
                ? `<form method="POST" action="/dashboard/revoke" style="display:inline">
                       <input type="hidden" name="key" value="${escapeHtml(l.key)}">
                       <button class="btn btn-danger btn-sm" type="submit">Revoke</button>
                   </form>`
                : '-';
            return `<tr>
                <td><span class="key-code">${escapeHtml(l.key)}</span></td>
                <td>${escapeHtml(l.buyer)}</td>
                <td>${escapeHtml(l.product)}</td>
                <td>${new Date(l.expiredAt).toLocaleDateString('id-ID')}</td>
                <td>${badge}</td>
                <td>${revokeBtn}</td>
            </tr>`;
        })
        .join('');

    return `<table>
        <thead><tr><th>Key</th><th>Buyer</th><th>Produk</th><th>Expired</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

// ─────────────────────────────────────────────
// Middleware auth dashboard (session)
// ─────────────────────────────────────────────
function requireLogin(req, res, next) {
    if (req.session && req.session.authed) return next();
    return res.redirect('/login');
}

// ─────────────────────────────────────────────
// Middleware auth API bot (header X-Bot-Key)
// ─────────────────────────────────────────────
function requireBotKey(req, res, next) {
    const key = req.headers['x-bot-key'];
    if (!key || !safeEqual(key, process.env.BOT_API_KEY)) {
        return res.status(401).json({ ok: false, message: 'Unauthorized: X-Bot-Key salah/tidak ada.' });
    }
    next();
}

// ─────────────────────────────────────────────
// ROUTES — Halaman Login
// ─────────────────────────────────────────────
app.get('/', (req, res) => res.redirect(req.session?.authed ? '/dashboard' : '/login'));

app.get('/login', (req, res) => {
    if (req.session && req.session.authed) return res.redirect('/dashboard');
    const err = req.query.err ? `<div class="error-msg">❌ Kunci rahasia salah. Coba lagi.</div>` : '';
    res.send(render('login.html', { ERROR_BLOCK: err }));
});

app.post('/login', (req, res) => {
    const { secret } = req.body;
    if (secret && safeEqual(secret, process.env.ADMIN_SECRET_KEY)) {
        req.session.authed = true;
        return res.redirect('/dashboard');
    }
    return res.redirect('/login?err=1');
});

app.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ─────────────────────────────────────────────
// ROUTES — Dashboard (butuh login)
// ─────────────────────────────────────────────
app.get('/dashboard', requireLogin, (req, res) => {
    const licenses = loadDb();
    const total   = licenses.length;
    const active  = licenses.filter((l) => statusOf(l) === 'active').length;
    const expired = licenses.filter((l) => statusOf(l) === 'expired').length;
    const revoked = licenses.filter((l) => statusOf(l) === 'revoked').length;

    let flash = '';
    if (req.query.generated) flash = `<div class="success-msg">✅ License <b>${escapeHtml(req.query.generated)}</b> berhasil dibuat.</div>`;
    if (req.query.revoked)   flash = `<div class="success-msg">🗑️ License <b>${escapeHtml(req.query.revoked)}</b> berhasil direvoke.</div>`;

    res.send(render('dashboard.html', {
        FLASH_BLOCK: flash,
        STAT_TOTAL: total,
        STAT_ACTIVE: active,
        STAT_EXPIRED: expired,
        STAT_REVOKED: revoked,
        TABLE_BLOCK: buildTableHtml(licenses)
    }));
});

app.post('/dashboard/generate', requireLogin, (req, res) => {
    const { buyer, product, durationDays } = req.body;
    const db  = loadDb();
    const key = generateKey();
    const now = new Date();
    const expiredAt = new Date(now.getTime() + parseInt(durationDays || '30', 10) * 86400000);

    db.push({ key, buyer, product, createdAt: now.toISOString(), expiredAt: expiredAt.toISOString(), hwid: null, status: 'active' });
    saveDb(db);
    res.redirect(`/dashboard?generated=${encodeURIComponent(key)}`);
});

app.post('/dashboard/revoke', requireLogin, (req, res) => {
    const { key } = req.body;
    const db = loadDb();
    const license = db.find((l) => l.key === key);
    if (license) { license.status = 'revoked'; saveDb(db); }
    res.redirect(`/dashboard?revoked=${encodeURIComponent(key)}`);
});

// ─────────────────────────────────────────────
// ROUTES — API untuk BOT (auth via header X-Bot-Key)
// ─────────────────────────────────────────────

// Dipanggil bot DEVELOPER setiap owner meng-ACC order script.
app.post('/api/generate', requireBotKey, (req, res) => {
    const { buyer, product, durationDays } = req.body;
    if (!buyer || !product) {
        return res.status(400).json({ ok: false, message: 'buyer & product wajib diisi.' });
    }
    const db  = loadDb();
    const key = generateKey();
    const now = new Date();
    const expiredAt = new Date(now.getTime() + parseInt(durationDays || '30', 10) * 86400000);

    const license = { key, buyer, product, createdAt: now.toISOString(), expiredAt: expiredAt.toISOString(), hwid: null, status: 'active' };
    db.push(license);
    saveDb(db);

    res.json({ ok: true, key, expiredAt: license.expiredAt });
});

// Dipanggil bot BUYER setiap kali script dijalankan (vanzky-guard).
app.post('/api/validate', requireBotKey, (req, res) => {
    const { key, hwid } = req.body;
    if (!key || !hwid) return res.status(400).json({ ok: false, message: 'key & hwid wajib diisi.' });

    const db = loadDb();
    const license = db.find((l) => l.key === key);

    if (!license) return res.json({ ok: false, message: 'License key tidak ditemukan.' });
    if (statusOf(license) === 'revoked') return res.json({ ok: false, message: 'License sudah dinonaktifkan owner.' });
    if (statusOf(license) === 'expired') return res.json({ ok: false, message: 'License sudah expired.' });

    if (!license.hwid) {
        license.hwid = hwid;
        saveDb(db);
    } else if (license.hwid !== hwid) {
        return res.json({ ok: false, message: 'License ini sudah dipakai di server/device lain.' });
    }

    res.json({ ok: true, message: `License valid. Selamat datang, ${license.buyer}!`, expiredAt: license.expiredAt });
});

// Opsional: revoke lewat API (misal mau diotomasi dari bot developer kalau ada refund)
app.post('/api/revoke', requireBotKey, (req, res) => {
    const { key } = req.body;
    const db = loadDb();
    const license = db.find((l) => l.key === key);
    if (!license) return res.status(404).json({ ok: false, message: 'Key tidak ditemukan.' });
    license.status = 'revoked';
    saveDb(db);
    res.json({ ok: true, message: 'License berhasil direvoke.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Vanz License berjalan di port ${PORT}`));
