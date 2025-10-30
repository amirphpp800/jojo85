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
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'Vazirmatn', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 40px 20px;
    position: relative;
  }

  body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: 
      radial-gradient(circle at 20% 50%, rgba(120, 119, 198, 0.3), transparent 50%),
      radial-gradient(circle at 80% 80%, rgba(138, 43, 226, 0.2), transparent 50%);
    pointer-events: none;
  }

  .container {
    max-width: 1000px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }

  header {
    text-align: center;
    margin-bottom: 50px;
    animation: fadeInDown 0.8s ease;
  }

  h1 {
    font-size: 42px;
    font-weight: 700;
    color: #ffffff;
    margin-bottom: 10px;
    text-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }

  .subtitle {
    color: rgba(255, 255, 255, 0.85);
    font-size: 16px;
    font-weight: 300;
  }

  .dns-list {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 20px;
    padding: 30px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    margin-bottom: 40px;
    animation: fadeInUp 0.8s ease 0.2s backwards;
  }

  .section-title {
    font-size: 22px;
    font-weight: 600;
    color: #667eea;
    margin-bottom: 25px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .section-title::before {
    content: '';
    width: 4px;
    height: 24px;
    background: linear-gradient(180deg, #667eea, #764ba2);
    border-radius: 4px;
  }

  ul {
    list-style: none;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 24px;
    margin-bottom: 12px;
    background: linear-gradient(135deg, #f8f9ff 0%, #f0f2ff 100%);
    border-radius: 14px;
    border: 1px solid rgba(102, 126, 234, 0.1);
    transition: all 0.3s ease;
    cursor: pointer;
  }

  .row:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(102, 126, 234, 0.2);
    border-color: rgba(102, 126, 234, 0.3);
  }

  .left {
    color: #667eea;
    font-weight: 600;
    font-size: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .country-flag {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 12px;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 16px;
    color: #64748b;
    font-size: 14px;
  }

  .stock-badge {
    background: linear-gradient(135deg, #10b981, #059669);
    color: white;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
  }

  form {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 20px;
    padding: 35px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: fadeInUp 0.8s ease 0.4s backwards;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 20px;
  }

  .form-group {
    margin-bottom: 20px;
  }

  .form-group.full-width {
    grid-column: 1 / -1;
  }

  label {
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #475569;
  }

  input, textarea {
    width: 100%;
    padding: 14px 18px;
    border: 2px solid #e2e8f0;
    border-radius: 12px;
    background: #ffffff;
    color: #1e293b;
    font-size: 15px;
    font-family: 'Vazirmatn', sans-serif;
    transition: all 0.3s ease;
  }

  input:focus, textarea:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
  }

  textarea {
    resize: vertical;
    min-height: 120px;
    font-family: 'Courier New', monospace;
  }

  button {
    width: 100%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    cursor: pointer;
    font-weight: 600;
    font-size: 16px;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  }

  button:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(102, 126, 234, 0.5);
  }

  button:active {
    transform: translateY(0);
  }

  @keyframes fadeInDown {
    from {
      opacity: 0;
      transform: translateY(-30px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(30px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 768px) {
    h1 {
      font-size: 32px;
    }

    .form-grid {
      grid-template-columns: 1fr;
    }

    .dns-list, form {
      padding: 20px;
    }

    .row {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }

    .right {
      width: 100%;
      justify-content: space-between;
    }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>🌐 مدیریت DNS</h1>
    <p class="subtitle">مدیریت و پیکربندی سرورهای DNS</p>
  </header>

  <div class="dns-list">
    <h2 class="section-title">لیست DNS‌های موجود</h2>
    <ul>
      <li class="row">
        <div class="left">
          <div class="country-flag">IR</div>
          <span>ایران</span>
        </div>
        <div class="right">
          <span class="stock-badge">موجودی: 12</span>
          <span>2 آدرس</span>
        </div>
      </li>
      <li class="row">
        <div class="left">
          <div class="country-flag">US</div>
          <span>آمریکا</span>
        </div>
        <div class="right">
          <span class="stock-badge">موجودی: 25</span>
          <span>4 آدرس</span>
        </div>
      </li>
      <li class="row">
        <div class="left">
          <div class="country-flag">DE</div>
          <span>آلمان</span>
        </div>
        <div class="right">
          <span class="stock-badge">موجودی: 8</span>
          <span>3 آدرس</span>
        </div>
      </li>
    </ul>
  </div>

  <form method="POST" action="/api/admin/add-dns">
    <h2 class="section-title">افزودن یا ویرایش DNS</h2>
    
    <div class="form-grid">
      <div class="form-group">
        <label>نام کشور (فارسی)</label>
        <input name="country" placeholder="مثلاً ایران" required>
      </div>

      <div class="form-group">
        <label>کد کشور (2 حرفی)</label>
        <input name="code" placeholder="IR" maxlength="2" required>
      </div>

      <div class="form-group">
        <label>موجودی</label>
        <input name="stock" type="number" placeholder="12" min="0">
      </div>

      <div class="form-group full-width">
        <label>آدرس‌های DNS (هر خط یک آدرس)</label>
        <textarea name="addresses" placeholder="1.1.1.1&#10;8.8.8.8&#10;8.8.4.4"></textarea>
      </div>
    </div>

    <button type="submit">💾 ذخیره اطلاعات</button>
  </form>
</div>
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
