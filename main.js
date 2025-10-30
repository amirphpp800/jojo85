// main.js - Cloudflare Pages + Telegram Bot (DNS manager)
// Persian UI, prettier web panel, and nicer Telegram responses

const TELEGRAM_BASE = (token) => `https://api.telegram.org/bot${token}`;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const html = (s) => new Response(s, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

function countryCodeToFlag(code) {
    if (!code || code.length !== 2) return '';
    const A = 0x1F1E6;
    return Array.from(code.toUpperCase()).map(c => String.fromCodePoint(A + c.charCodeAt(0) - 65)).join('');
}

// === KV Helpers ===
async function listDnsEntries(kv) {
    const res = await kv.list({ prefix: 'dns:' });
    const out = [];
    for (const k of res.keys) {
        const v = await kv.get(k.name);
        try { out.push(JSON.parse(v)); } catch { }
    }
    out.sort((a, b) => (a.country || '').localeCompare(b.country || ''));
    return out;
}

async function getDnsEntry(kv, code) {
    const raw = await kv.get(`dns:${code.toUpperCase()}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

async function putDnsEntry(kv, entry) {
    await kv.put(`dns:${entry.code.toUpperCase()}`, JSON.stringify(entry));
}

// === Web UI ===
function renderMainPage(entries) {
    const rows = entries.map(e => {
        const flag = countryCodeToFlag(e.code);
        return `
    <li class="row">
      <div class="left">${e.stock ?? '—'}</div>
      <div class="right">${flag} <b>${escapeHtml(e.country)}</b></div>
    </li>`;
    }).join('\n');

    return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>مدیریت DNS</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600&display=swap" rel="stylesheet">
<style>
  body{font-family:'Vazirmatn',sans-serif;background:radial-gradient(circle at 30% 30%,#1e293b,#0f172a);color:#f8fafc;margin:0;padding:24px;text-align:right}
  h1{font-size:24px;margin-bottom:12px;color:#93c5fd}
  ul{list-style:none;padding:0;margin:0;max-width:700px}
  .row{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;margin:6px 0;background:rgba(255,255,255,0.05);border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,0.2);backdrop-filter:blur(6px)}
  .left{color:#bae6fd;font-weight:600}
  .right{display:flex;align-items:center;gap:8px}
  form{margin-top:30px;max-width:700px;padding:16px;background:rgba(255,255,255,0.04);border-radius:12px;backdrop-filter:blur(8px)}
  label{display:block;margin-top:8px;font-size:14px;color:#a5b4fc}
  input,textarea{width:100%;padding:8px;border:none;border-radius:8px;background:rgba(255,255,255,0.1);color:white;margin-top:4px}
  button{margin-top:14px;background:linear-gradient(90deg,#2563eb,#0ea5e9);border:none;color:white;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600}
</style>
</head>
<body>
<h1>لیست DNS‌ها</h1>
<ul>${rows}</ul>
<form method="POST" action="/api/admin/add-dns">
  <h3>افزودن یا ویرایش DNS</h3>
  <label>نام کشور (فارسی)</label>
  <input name="country" placeholder="مثلاً ایران" required>
  <label>کد کشور (2 حرفی)</label>
  <input name="code" placeholder="IR" required>
  <label>موجودی</label>
  <input name="stock" placeholder="12">
  <label>آدرس‌ها (هر خط یک آدرس)</label>
  <textarea name="addresses" rows="3" placeholder="1.1.1.1\n8.8.8.8"></textarea>
  <button type="submit">ذخیره</button>
</form>
</body>
</html>`;
}

function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": "&#39;" }[c])); }

// === Telegram Bot ===
async function telegramApi(env, path, body) {
    const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return res.json().catch(() => ({}));
}

function buildKeyboard(entries) {
    const rows = entries.map(e => {
        const flag = countryCodeToFlag(e.code);
        const txt = `${flag} ${e.country} — ${e.stock ?? '—'}`;
        return [{ text: txt, callback_data: `dns:${e.code.toUpperCase()}` }];
    });
    rows.unshift([{ text: '🛰️ وایرگارد (غیرفعال)', callback_data: 'wg:off' }]);
    rows.unshift([{ text: '🌐 انتخاب کشور برای DNS', callback_data: 'head' }]);
    return { inline_keyboard: rows };
}

async function handleDnsSelection(chat, code, env) {
    const entry = await getDnsEntry(env.DB, code);
    if (!entry) return telegramApi(env, '/sendMessage', { chat_id: chat, text: 'هیچ DNSی برای این کشور یافت نشد.' });
    let msg = `🌐 DNSهای کشور ${entry.country}\n\n`;
    if (Array.isArray(entry.addresses) && entry.addresses.length) {
        msg += entry.addresses.map(a => `▫️ ${a}`).join('\n');
    } else msg += '(خالی)';
    return telegramApi(env, '/sendMessage', { chat_id: chat, text: msg });
}

export async function handleUpdate(update, env) {
    try {
        if (update.message) {
            const msg = update.message; const chat = msg.chat.id; const text = msg.text || '';
            if (text.startsWith('/start')) {
                const list = await listDnsEntries(env.DB);
                const kb = buildKeyboard(list);
                await telegramApi(env, '/sendMessage', { chat_id: chat, text: '👋 خوش آمدی!\nاز لیست زیر کشور موردنظر را انتخاب کن. بخش وایرگارد فعلاً غیرفعال است.', reply_markup: kb });
            } else {
                await telegramApi(env, '/sendMessage', { chat_id: chat, text: 'دستور نامعتبر است. /start را ارسال کنید.' });
            }
        }
        if (update.callback_query) {
            const cb = update.callback_query;
            const data = cb.data || ''; const chat = cb.message.chat.id;
            await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id });
            if (data.startsWith('dns:')) { await handleDnsSelection(chat, data.split(':')[1], env); }
            else if (data.startsWith('wg:')) {
                await telegramApi(env, '/sendMessage', { chat_id: chat, text: '🛰️ بخش وایرگارد فعلاً غیرفعال است.' });
            }
        }
    } catch (e) { console.error(e) }
}

// === Fetch ===
export default {
    async fetch(req, env) {
        const url = new URL(req.url);
        if (url.pathname === '/' && req.method === 'GET') {
            const entries = await listDnsEntries(env.DB);
            return html(renderMainPage(entries));
        }
        if (url.pathname === '/api/dns' && req.method === 'GET') {
            const entries = await listDnsEntries(env.DB);
            return json(entries);
        }
        if (url.pathname === '/api/admin/add-dns' && req.method === 'POST') {
            const form = await req.formData();
            const entry = {
                country: form.get('country'),
                code: form.get('code').toUpperCase(),
                stock: Number(form.get('stock')) || 0,
                addresses: form.get('addresses').split(/\r?\n/).filter(Boolean)
            };
            await putDnsEntry(env.DB, entry);
            return html('<meta http-equiv="refresh" content="0;url=/">ذخیره شد');
        }
        return new Response('Not Found', { status: 404 });
    }
};
