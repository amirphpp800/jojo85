// main.js - Cloudflare Pages function + Telegram webhook handler
// Exports:
//  - default: { fetch(request, env, ctx) }  -> handles web UI and admin API
//  - handleUpdate(update, env, ctx) -> used by webhook.js to process Telegram updates

// Environment expectations (set in wrangler.toml or Cloudflare dashboard):
//  - DB         (KV namespace binding)
//  - BOT_TOKEN  (secret)
//  - ADMIN_ID   (secret or var used for admin auth)

const TELEGRAM_BASE = (token) => `https://api.telegram.org/bot${token}`;

// Utilities
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const html = (s) => new Response(s, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

// Convert 2-letter country code to regional indicator emoji (e.g. "IR" -> 🇮🇷)
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '';
  const A = 0x1F1E6;
  return Array.from(code.toUpperCase()).map(c => String.fromCodePoint(A + c.charCodeAt(0) - 65)).join('');
}

// --- KV helpers ---
// DNS entries are stored in KV under keys: `dns:<countryCode>`
// value: JSON string { country: "Iran", code: "IR", stock: 12, addresses: ["1.1.1.1","8.8.8.8"] }

async function listDnsEntries(kv) {
  // KV list may return up to 1000 keys; we assume reasonable size.
  const res = await kv.list({ prefix: 'dns:' });
  const keys = res.keys || [];
  const out = [];
  for (const k of keys) {
    const v = await kv.get(k.name);
    try {
      out.push(JSON.parse(v));
    } catch (e) {
      // ignore invalid
    }
  }
  // sort by country name
  out.sort((a,b) => (a.country || '').localeCompare(b.country || ''));
  return out;
}

async function getDnsEntry(kv, code) {
  const raw = await kv.get(`dns:${code.toUpperCase()}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e){ return null; }
}

async function putDnsEntry(kv, entry) {
  if (!entry || !entry.code) throw new Error('invalid entry');
  await kv.put(`dns:${entry.code.toUpperCase()}`, JSON.stringify(entry));
}

// --- Web UI ---
function renderMainPage(entries) {
  // Glassy buttons, right-left list: right = country (flag + name), left = stock
  const rows = entries.map(e => {
    const flag = countryCodeToFlag(e.code || '') || '';
    return `
    <li class="row">
      <div class="left">${e.stock == null ? '—' : String(e.stock)}</div>
      <div class="right"><span class="flag">${flag}</span> <strong>${escapeHtml(e.country)}</strong> <code class="code">${(e.code||'').toUpperCase()}</code></div>
    </li>`;
  }).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WireGuard / DNS Bot - DNS list</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,'Helvetica Neue',Arial;margin:24px;background:linear-gradient(180deg,#0f172a,#071129);color:#e6eef8}
  h1{font-size:20px;margin:0 0 12px}
  ul{list-style:none;padding:0;margin:0;max-width:900px}
  li.row{display:flex;justify-content:space-between;align-items:center;padding:12px;margin:8px 0;border-radius:12px;background:rgba(255,255,255,0.04);backdrop-filter: blur(6px);box-shadow:0 1px 0 rgba(255,255,255,0.02) inset}
  li.row .left{min-width:70px;text-align:left;font-weight:600}
  li.row .right{display:flex;gap:8px;align-items:center}
  .flag{font-size:20px}
  .code{opacity:0.7;font-size:12px;padding:4px 6px;border-radius:6px;background:rgba(255,255,255,0.02)}
  .controls{margin-top:18px}
  .glass-btn{display:inline-block;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);background:linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01));backdrop-filter: blur(4px);cursor:pointer;color:inherit;text-decoration:none}
  form.card{margin-top:20px;padding:12px;border-radius:12px;background:rgba(255,255,255,0.03);max-width:650px}
  label{display:block;margin-top:8px;font-size:13px}
  input, textarea{width:100%;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,0.06);background:transparent;color:inherit}
  small{opacity:0.7}
</style>
</head>
<body>
<h1>DNS entries</h1>
<p>لیست DNSهایی که از طریق پنل اضافه می‌شوند. بخش وایرگارد در ربات فعلاً غیرفعال است.</p>
<ul>
${rows}
</ul>

<div class="controls">
  <a class="glass-btn" href="/api/dns">API: Download JSON</a>
</div>

<!-- Admin helper: a small form to post new DNS entries. Requires ADMIN_ID token in "admin" field. -->
<form method="POST" action="/api/admin/add-dns" class="card">
  <h3>افزودن/بروزرسانی DNS (Admin)</h3>
  <label>ADMIN_ID (توکن ادمین)</label>
  <input name="admin" placeholder="ADMIN_ID here" />
  <label>Country name</label>
  <input name="country" placeholder="e.g. Iran" />
  <label>Country code (2 letters)</label>
  <input name="code" placeholder="e.g. IR" />
  <label>Stock (موجودی)</label>
  <input name="stock" placeholder="12" />
  <label>Addresses (هر سطر یک آدرس)</label>
  <textarea name="addresses" placeholder="1.1.1.1\n8.8.8.8"></textarea>
  <small>اگر می‌خواهید از API استفاده کنید، درخواست POST به /api/admin/add-dns با فیلدهای مشابه بفرستید (JSON یا form-encoded).</small>
  <div style="margin-top:10px"><button class="glass-btn" type="submit">ذخیره</button></div>
</form>

</body>
</html>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
}

// --- Telegram helpers ---
async function telegramApi(env, path, body) {
  const token = env.BOT_TOKEN;
  if (!token) throw new Error('BOT_TOKEN not set');
  const url = TELEGRAM_BASE(token) + path;
  const opts = { method: 'POST', headers: {} };
  if (body instanceof FormData) opts.body = body;
  else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  try { return await res.json(); } catch(e){ return null; }
}

// Build inline keyboard for list of countries
function buildCountriesKeyboard(entries) {
  // We'll make one button per row: text shows "country — stock" and callback_data: dns:CODE
  const rows = entries.map(e => {
    const flag = countryCodeToFlag(e.code || '');
    const text = `${flag} ${e.country} — ${e.stock == null ? '—' : e.stock}`;
    return [{ text, callback_data: `dns:${(e.code||'').toUpperCase()}` }];
  });

  // Add a disabled WireGuard button (we can't disable on Telegram, so indicate via text and no callback)
  rows.unshift([{ text: '🛰️ WireGuard (غیرفعال)', callback_data: 'wg:disabled' }]);
  // Add a top DNS header button (non-actionable)
  rows.unshift([{ text: '🌐 DNS — انتخاب کشور', callback_data: 'dns:header' }]);
  return { inline_keyboard: rows };
}

// When user selects a country, send the DNS addresses as text (or as list with copy-able content)
async function handleDnsSelection(chat_id, code, env) {
  const entry = await getDnsEntry(env.DB, code);
  if (!entry) {
    return telegramApi(env, '/sendMessage', { chat_id, text: 'آدرس برای این کشور پیدا نشد.' });
  }
  const lines = [ `DNS addresses for ${entry.country} (${(entry.code||'').toUpperCase()}):`, ''];
  if (Array.isArray(entry.addresses) && entry.addresses.length) {
    for (const a of entry.addresses) lines.push(a);
  } else lines.push('هیچ آدرسی ثبت نشده است.');
  lines.push('');
  lines.push('اگر می‌خواهید آدرس جدید اضافه کنید از پنل وب استفاده کنید.');
  return telegramApi(env, '/sendMessage', { chat_id, text: lines.join('\n') });
}

// Main update handler (Telegram)
export async function handleUpdate(update, env, ctx = {}) {
  try {
    // Message -> /start or /menu
    if (update.message) {
      const msg = update.message;
      const chat_id = msg.chat && msg.chat.id;
      const text = msg.text || '';
      if (text && text.startsWith('/start')) {
        const entries = await listDnsEntries(env.DB);
        const keyboard = buildCountriesKeyboard(entries);
        const welcome = 'سلام — ربات DNS. از منوی زیر استفاده کنید. بخش WireGuard فعلا غیرفعال است.';
        await telegramApi(env, '/sendMessage', { chat_id, text: welcome, reply_markup: keyboard });
      } else if (text && text.startsWith('/dns')) {
        const entries = await listDnsEntries(env.DB);
        const keyboard = buildCountriesKeyboard(entries);
        await telegramApi(env, '/sendMessage', { chat_id: msg.chat.id, text: 'لیست کشورها:', reply_markup: keyboard });
      } else {
        // default reply
        if (chat_id) await telegramApi(env, '/sendMessage', { chat_id, text: 'لطفا /start را بفرستید تا منو را ببینید.' });
      }
    }

    // Callback query - user pressed an inline button
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || '';
      const fromId = cb.from && cb.from.id;
      const message = cb.message;
      const chat_id = message && message.chat && message.chat.id;

      // Acknowledge callback to remove loading spinner
      await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id });

      if (data.startsWith('dns:')) {
        const code = data.split(':')[1];
        if (!code || code === 'header') {
          // ignore header
          return;
        }
        await handleDnsSelection(chat_id, code, env);
      } else if (data.startsWith('wg:')) {
        // WireGuard is disabled
        await telegramApi(env, '/sendMessage', { chat_id, text: 'بخش WireGuard فعلاً غیرفعال است.' });
      }
    }

  } catch (err) {
    // swallow errors but log (Cloudflare will capture console)
    console.error('handleUpdate error', err);
  }
}

// --- Fetch handler for Pages (web UI + API) ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname || '/';

    // Simple routing
    if (pathname === '/' && request.method === 'GET') {
      const entries = await listDnsEntries(env.DB);
      return html(renderMainPage(entries));
    }

    if (pathname === '/api/dns' && request.method === 'GET') {
      const entries = await listDnsEntries(env.DB);
      return json(entries);
    }

    // Admin: add/update dns
    if (pathname === '/api/admin/add-dns' && request.method === 'POST') {
      // accept JSON or form data
      let body = {};
      const ctype = request.headers.get('content-type') || '';
      if (ctype.includes('application/json')) body = await request.json();
      else if (ctype.includes('application/x-www-form-urlencoded') || ctype.includes('multipart/form-data')) {
        const form = await request.formData();
        for (const [k,v] of form.entries()) body[k] = v;
      } else {
        // try to parse JSON fallback
        try{ body = await request.json(); }catch(e){
          // parse text key=value lines
          const txt = await request.text();
          // naive
          body = {};
        }
      }

      // admin auth
      const ADMIN = env.ADMIN_ID || '';
      const provided = body.admin || (new URL(request.url)).searchParams.get('admin');
      if (!ADMIN || !provided || String(provided) !== String(ADMIN)) {
        return new Response('unauthorized', { status: 401 });
      }

      const country = (body.country || '').trim();
      const code = (body.code || '').trim().toUpperCase();
      const stock = body.stock != null ? Number(body.stock) : null;
      let addresses = body.addresses || body.address || [];
      if (typeof addresses === 'string') {
        addresses = addresses.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      }

      if (!country || !code || code.length !== 2) {
        return new Response('invalid payload: need country and 2-letter code', { status: 400 });
      }

      const entry = { country, code, stock, addresses };
      await putDnsEntry(env.DB, entry);
      return json({ ok: true, entry });
    }

    // Fallback
    return new Response('Not found', { status: 404 });
  }
};
