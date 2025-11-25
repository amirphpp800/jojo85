// main.js
// Lightweight WireGuard/DNS Telegram Bot for Cloudflare Pages + simple admin web panel
// - KV binding name: DB
// - Env vars: BOT_TOKEN, ADMIN_ID
// - All Telegram interactions use inline keyboard (glass buttons)
// - DNS records stored in KV as: dns:GE -> {"code":"GE","country":"گرجستان","addresses":["46.49.106.143"],"stock":1}
// - Quota keys: quota:dns:{userId}:{YYYYMMDD}, quota:wg:{userId}:{YYYYMMDD}  (max 3 each per day)
// - History: history:{userId}  (last 20 items)
// Related Pages Functions files you already uploaded:
// - /mnt/data/[[path]].js  (catch-all -> app.fetch)
// - /mnt/data/webhook.js   (POST -> handleUpdate)

const MAX_DNS_PER_DAY = 3;
const MAX_WG_PER_DAY = 3;
const HISTORY_LIMIT = 20;
const DATE_YYYYMMDD = () => new Date().toISOString().slice(0,10).replace(/-/g,""); // YYYYMMDD

/* -------------------- Helper utilities -------------------- */

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function telegramApi(token, method, body, isForm = false) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const opts = { method: "POST", headers: {} };
  if (isForm) {
    opts.body = body;
  } else {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { ok: false, raw: txt }; }
}

async function telegramSendMessage(token, chat_id, text, extra = {}) {
  return telegramApi(token, "sendMessage", Object.assign({ chat_id, text, parse_mode: "HTML" }, extra));
}

async function telegramSendDocument(token, chat_id, filename, contents, caption = "") {
  const form = new FormData();
  form.append("chat_id", String(chat_id));
  const blob = new Blob([contents], { type: "text/plain" });
  form.append("document", blob, filename);
  if (caption) form.append("caption", caption);
  return telegramApi(token, "sendDocument", form, true);
}

/* Minimal base64 key generator (not Curve25519-derived public key).
   For production-grade WireGuard keys you should generate real keypairs externally. */
function randBase64(n = 32) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

/* -------------------- KV helpers -------------------- */

/** Get DNS record by country code from KV (DB) */
async function getDNS(env, code) {
  if (!code) return null;
  const key = `dns:${code.toUpperCase()}`;
  const raw = await env.DB.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Put DNS record (admin use) */
async function putDNS(env, code, obj) {
  const key = `dns:${code.toUpperCase()}`;
  await env.DB.put(key, JSON.stringify(obj));
}

/** Delete DNS record (admin use) */
async function delDNS(env, code) {
  const key = `dns:${code.toUpperCase()}`;
  await env.DB.delete(key);
}

/** List all dns:* keys and return parsed objects */
async function listAllDNS(env, limit = 1000) {
  // KV list (Cloudflare KV supports list with prefix)
  const iter = await env.DB.list({ prefix: "dns:", limit });
  const items = [];
  for (const k of iter.keys || []) {
    try {
      const raw = await env.DB.get(k.name);
      if (raw) items.push(JSON.parse(raw));
    } catch (e) { /* ignore parse errors */ }
  }
  return items;
}

/* Users list for broadcast (simple array in KV) */
async function addUserToList(env, userId) {
  const key = "users:list";
  const raw = await env.DB.get(key);
  let arr = raw ? JSON.parse(raw) : [];
  if (!arr.includes(userId)) {
    arr.push(userId);
    await env.DB.put(key, JSON.stringify(arr));
  }
}
async function getAllUsers(env) {
  const raw = await env.DB.get("users:list");
  return raw ? JSON.parse(raw) : [];
}

/* History per user */
async function addUserHistory(env, userId, entry) {
  try {
    const k = `history:${userId}`;
    const raw = await env.DB.get(k);
    let h = raw ? JSON.parse(raw) : [];
    h.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    if (h.length > HISTORY_LIMIT) h = h.slice(0, HISTORY_LIMIT);
    await env.DB.put(k, JSON.stringify(h));
  } catch (e) {
    console.error("addUserHistory error:", e);
  }
}

/* -------------------- Quota system -------------------- */

/** Return remaining quotas: { dnsRemaining, wgRemaining, resetAtISO } */
async function getQuotaStatus(env, userId) {
  const date = DATE_YYYYMMDD();
  const kDns = `quota:dns:${userId}:${date}`;
  const kWg = `quota:wg:${userId}:${date}`;
  const rawDns = await env.DB.get(kDns);
  const rawWg = await env.DB.get(kWg);
  const usedDns = rawDns ? parseInt(rawDns, 10) : 0;
  const usedWg = rawWg ? parseInt(rawWg, 10) : 0;
  // reset at next UTC midnight
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1));
  return {
    dnsRemaining: Math.max(0, MAX_DNS_PER_DAY - usedDns),
    wgRemaining: Math.max(0, MAX_WG_PER_DAY - usedWg),
    resetAtISO: tomorrow.toISOString(),
    usedDns,
    usedWg
  };
}

async function incQuota(env, userId, type) {
  const date = DATE_YYYYMMDD();
  const k = `quota:${type}:${userId}:${date}`;
  const raw = await env.DB.get(k);
  const now = raw ? parseInt(raw, 10) : 0;
  await env.DB.put(k, String(now + 1));
}

/* -------------------- Telegram UI (inline keyboards) -------------------- */

function kbRow(...buttons) { return buttons; } // helper small wrapper
function buildCountryListKeyboard(countries) {
  // countries: array of { code, country }
  const rows = [];
  for (let i = 0; i < countries.length; i += 2) {
    const left = countries[i];
    const right = countries[i+1];
    const row = [];
    row.push({ text: `${left.flag || ''} ${left.code}`, callback_data: `country:${left.code}` });
    if (right) row.push({ text: `${right.flag || ''} ${right.code}`, callback_data: `country:${right.code}` });
    rows.push(row);
  }
  rows.push([{ text: "🔙 بازگشت", callback_data: "main_menu" }]);
  return { inline_keyboard: rows };
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🌐 دریافت DNS", callback_data: "menu_dns" }],
      [{ text: "🔧 تولید WireGuard", callback_data: "menu_wg" }],
      [{ text: "📊 وضعیت و تاریخچه من", callback_data: "menu_status" }]
    ]
  };
}

function countryActionKeyboard(code) {
  return {
    inline_keyboard: [
      [{ text: "📡 دریافت DNS", callback_data: `do_dns:${code}` }],
      [{ text: "🧾 دریافت WireGuard", callback_data: `do_wg:${code}` }],
      [{ text: "🔙 بازگشت", callback_data: "main_menu" }]
    ]
  };
}

/* -------------------- WG config generator -------------------- */

function buildWGConfig({ privateKey, publicKey, endpoint, mtu = 1420, clientAddress = "10.66.66.2/32", dns = "1.1.1.1" }) {
  return [
    `[Interface]`,
    `PrivateKey = ${privateKey}`,
    `Address = ${clientAddress}`,
    `DNS = ${dns}`,
    `MTU = ${mtu}`,
    ``,
    `[Peer]`,
    `PublicKey = ${publicKey}`,
    `Endpoint = ${endpoint}:51820`,
    `AllowedIPs = 0.0.0.0/0, ::/0`,
    `PersistentKeepalive = 25`,
    ``
  ].join("\n");
}

/* -------------------- Main Telegram update handler -------------------- */

export async function handleUpdate(update, env, { waitUntil } = {}) {
  const token = env.BOT_TOKEN;
  const adminId = String(env.ADMIN_ID || "");
  try {
    if (!update) return;
    // track user list where possible
    const msg = update.message || update.edited_message || (update.callback_query && update.callback_query.message);
    if (!msg) return;

    const chat = msg.chat;
    const from = (update.callback_query && update.callback_query.from) || msg.from;
    const userId = from && from.id;
    if (userId) {
      const p = addUserToList(env, userId);
      if (waitUntil) waitUntil(p);
    }

    // handle callback_query first (inline keyboard interactions)
    if (update.callback_query) {
      const cq = update.callback_query;
      const data = cq.data || "";
      const chatId = cq.message.chat.id;
      const messageId = cq.message.message_id;

      // acknowledge callback quickly
      telegramApi(token, "answerCallbackQuery", { callback_query_id: cq.id }).catch(()=>{});

      // main menu
      if (data === "main_menu") {
        await telegramSendMessage(token, chatId, "منو اصلی:", { reply_to_message_id: messageId, reply_markup: mainMenuKeyboard() });
        return;
      }

      // show country list for DNS or WG selection
      if (data === "menu_dns" || data === "menu_wg") {
        // list DNS entries from KV
        const list = await listAllDNS(env);
        if (!list || list.length === 0) {
          await telegramSendMessage(token, chatId, "فعلا رکورد DNS‌ای موجود نیست.", { reply_to_message_id: messageId });
          return;
        }
        // map to minimal country objects with flags optional
        const countries = list.map(r => ({ code: (r.code||"").toUpperCase(), country: r.country || r.code, flag: r.flag || "" }));
        await telegramSendMessage(token, chatId, "کشور را انتخاب کنید:", { reply_to_message_id: messageId, reply_markup: buildCountryListKeyboard(countries) });
        return;
      }

      // user requested a specific country (shows actions)
      if (data.startsWith("country:")) {
        const code = data.split(":")[1];
        await telegramSendMessage(token, chatId, `کشور: <b>${code}</b>\nعملیات را انتخاب کنید:`, { reply_to_message_id: messageId, reply_markup: countryActionKeyboard(code) });
        return;
      }

      // do_dns:CODE
      if (data.startsWith("do_dns:")) {
        const code = data.split(":")[1];
        const status = await getQuotaStatus(env, userId);
        if (status.dnsRemaining <= 0) {
          await telegramSendMessage(token, chatId, `محدودیت روزانه DNS شما به پایان رسیده است.\nباقی مانده: ${status.dnsRemaining}\nریست در: ${status.resetAtISO}`, { reply_to_message_id: messageId });
          return;
        }
        const rec = await getDNS(env, code);
        if (!rec) {
          await telegramSendMessage(token, chatId, `رکوردی برای ${code} پیدا نشد.`, { reply_to_message_id: messageId });
          return;
        }
        const addresses = (rec.addresses && rec.addresses.length) ? rec.addresses.join("\n") : "(آدرسی موجود نیست)";
        const text = `🇨🇭 <b>${rec.country || code}</b>\nکد: <code>${rec.code || code}</code>\nآدرس‌ها:\n${addresses}\nموجودی: ${rec.stock ?? "نامشخص"}`;
        await telegramSendMessage(token, chatId, text, { reply_to_message_id: messageId });
        // increment quota and add history
        await incQuota(env, userId, "dns");
        await addUserHistory(env, userId, { type: "dns", country: code });
        return;
      }

      // do_wg:CODE
      if (data.startsWith("do_wg:")) {
        const code = data.split(":")[1];
        const status = await getQuotaStatus(env, userId);
        if (status.wgRemaining <= 0) {
          await telegramSendMessage(token, chatId, `محدودیت روزانه WireGuard شما به پایان رسیده است.\nباقی مانده: ${status.wgRemaining}\nریست در: ${status.resetAtISO}`, { reply_to_message_id: messageId });
          return;
        }
        const rec = await getDNS(env, code);
        if (!rec || !rec.addresses || rec.addresses.length === 0) {
          await telegramSendMessage(token, chatId, `برای ${code} آدرس endpoint موجود نیست.`, { reply_to_message_id: messageId });
          return;
        }
        // generate simple keypair & conf
        const priv = randBase64(32);
        const pub = randBase64(32); // placeholder public key
        const endpoint = rec.addresses[0];
        const conf = buildWGConfig({
          privateKey: priv,
          publicKey: pub,
          endpoint,
          mtu: 1420,
          clientAddress: "10.66.66.2/32",
          dns: (rec.dns && rec.dns[0]) ? rec.dns[0] : "1.1.1.1"
        });
        const filename = `wg-${code}.conf`;
        const caption = `WireGuard config — ${code}`;
        await telegramSendDocument(token, chatId, filename, conf, caption);
        // increment quota and history
        await incQuota(env, userId, "wg");
        await addUserHistory(env, userId, { type: "wg", country: code });
        return;
      }

      return;
    } // end callback_query handling

    // handle plain text commands
    const text = (msg.text || "").trim();
    const parts = text.split(/\s+/).filter(Boolean);
    const cmd = (parts[0] || "").toLowerCase();

    if (cmd === "/start") {
      await telegramSendMessage(token, msg.chat.id, `سلام 👋\nبه ربات WireGuard/DNS خوش آمدی!\nاز دکمه‌ها استفاده کن.`, { reply_markup: mainMenuKeyboard() });
      return;
    }

    if (cmd === "/help") {
      const help = `/start — شروع و منوی اصلی\nدکمه‌ها را بزنید تا DNS یا WireGuard بگیرید.\nبرای ادمین: /broadcast <متن>\n`;
      await telegramSendMessage(token, msg.chat.id, help);
      return;
    }

    // /broadcast <text> (admin only)
    if (cmd === "/broadcast") {
      const fromId = msg.from && msg.from.id;
      if (String(fromId) !== String(adminId)) {
        await telegramSendMessage(token, msg.chat.id, `این دستور فقط برای ادمین مجاز است.`);
        return;
      }
      const content = text.slice("/broadcast".length).trim();
      if (!content) {
        await telegramSendMessage(token, msg.chat.id, `لطفا متن پیام را بعد از /broadcast وارد کنید.`);
        return;
      }
      const users = await getAllUsers(env);
      if (!users || users.length === 0) {
        await telegramSendMessage(token, msg.chat.id, `هیچ کاربری برای ارسال وجود ندارد.`);
        return;
      }
      // fire-and-forget per user
      users.forEach(u => {
        telegramSendMessage(token, u, content).catch(e => console.error("broadcast err", e));
      });
      await telegramSendMessage(token, msg.chat.id, `پیام به ${users.length} کاربر ارسال شد.`);
      return;
    }

    // /status - show user quota and history
    if (cmd === "/status" || cmd === "/me") {
      const uid = msg.from && msg.from.id;
      const q = await getQuotaStatus(env, uid);
      const histRaw = await env.DB.get(`history:${uid}`);
      const hist = histRaw ? JSON.parse(histRaw) : [];
      let s = `وضعیت شما:\nDNS مصرف شده امروز: ${q.usedDns}/${MAX_DNS_PER_DAY}\nWG مصرف شده امروز: ${q.usedWg}/${MAX_WG_PER_DAY}\nریست در: ${q.resetAtISO}\n\nآخرین درخواست‌ها:\n`;
      if (hist.length === 0) s += "(تاریخی موجود نیست)";
      else s += hist.slice(0,10).map(h => `${h.at.slice(0,19).replace("T"," ")} — ${h.type} — ${h.country || ""}`).join("\n");
      await telegramSendMessage(token, msg.chat.id, s);
      return;
    }

    // default: prompt main menu
    await telegramSendMessage(token, msg.chat.id, "لطفا از منو استفاده کنید:", { reply_markup: mainMenuKeyboard() });

  } catch (err) {
    console.error("handleUpdate error:", err);
    try {
      const chat = (update.message && update.message.chat && update.message.chat.id) || (update.callback_query && update.callback_query.message && update.callback_query.message.chat.id);
      if (chat) await telegramSendMessage(env.BOT_TOKEN, chat, `خطایی رخ داد، بعدا امتحان کنید.`);
    } catch (e) { /* swallow */ }
  }
}

/* -------------------- Web (app.fetch) - simple admin panel + API -------------------- */

const app = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // Root: simple panel
    if (path === "/" && method === "GET") {
      // Minimal yet neat admin panel HTML + client-side JS
      const html = `<!doctype html>
<html lang="fa">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WireGuard Bot - Panel</title>
<style>
  :root{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial;}
  body{background:#0f172a;color:#e6eef8;margin:0;padding:24px}
  .card{background:#0b1220;border-radius:12px;padding:18px;margin:12px 0;box-shadow:0 6px 18px rgba(2,6,23,.6)}
  h1{margin:0 0 8px;font-size:20px}
  .row{display:flex;gap:8px;flex-wrap:wrap}
  input,textarea,select{background:#071226;border:1px solid #18324a;color:#dff0ff;padding:8px;border-radius:8px;min-width:220px}
  button{background:#0ea5a5;border:0;color:#042026;padding:8px 12px;border-radius:8px;cursor:pointer}
  small{color:#9fb6c6}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;text-align:left;border-bottom:1px solid #102532}
</style>
</head>
<body>
  <div class="card">
    <h1>WireGuard Bot — پنل مدیریت (سبک)</h1>
    <p class="muted">برای عملیات ادمین، پارامتر <code>?admin=ADMIN_ID</code> را در URL اضافه کنید.</p>
    <div class="row">
      <div style="flex:1;">
        <h3>DNS‌ها</h3>
        <div id="dns-list">در حال بارگذاری…</div>
        <hr/>
        <h4>افزودن / ویرایش</h4>
        <form id="dns-form">
          <label>کد کشور (مثال: GE)</label><br/>
          <input id="code" required/><br/><br/>
          <label>نام کشور</label><br/>
          <input id="country"/><br/><br/>
          <label>آدرس‌ها (هر خط یک آدرس)</label><br/>
          <textarea id="addresses" rows="4"></textarea><br/><br/>
          <label>stock</label><br/>
          <input id="stock" type="number" value="1"/><br/><br/>
          <button type="submit">ثبت</button>
        </form>
      </div>
      <div style="width:320px">
        <h3>کاربران</h3>
        <div id="users">در حال بارگذاری…</div>
        <hr/>
        <h4>ارسال پیام همگانی</h4>
        <textarea id="broadcast" rows="4"></textarea><br/><br/>
        <button id="send-bc">ارسال همگانی</button>
      </div>
    </div>
  </div>

<script>
const ADMIN = new URL(location).searchParams.get('admin') || '';
if(!ADMIN){ document.getElementById('dns-list').innerText = 'برای استفاده، ?admin=ADMIN_ID اضافه کنید.'; document.getElementById('users').innerText='برای استفاده، ?admin=ADMIN_ID اضافه کنید.'; }

async function fetchJson(path, opts={}) {
  const h = opts.headers || {};
  if(ADMIN) h['x-admin-id'] = ADMIN;
  opts.headers = h;
  const res = await fetch(path, opts);
  if(!res.ok) throw new Error('خطا');
  return res.json();
}

async function loadDNS(){
  try{
    const list = await fetchJson('/api/dns');
    if(list.length===0) document.getElementById('dns-list').innerText='خالی';
    else{
      const rows = list.map(r=>\`<tr><td>\${r.code}</td><td>\${r.country||''}</td><td>\${(r.addresses||[]).join('<br/>')}</td><td>\${r.stock||0}</td><td><button data-code="\${r.code}" class="del">حذف</button></td></tr>\`).join('');
      document.getElementById('dns-list').innerHTML = '<table><tr><th>کد</th><th>کشور</th><th>آدرس‌ها</th><th>stock</th><th></th></tr>'+rows+'</table>';
      document.querySelectorAll('.del').forEach(b=>b.onclick=async e=>{
        const code = e.target.dataset.code;
        if(!confirm('حذف شود؟')) return;
        await fetch('/api/dns/'+code, { method:'DELETE', headers:{ 'x-admin-id': ADMIN }});
        loadDNS();
      });
    }
  }catch(e){ console.error(e); document.getElementById('dns-list').innerText='خطا در بارگذاری'; }
}

async function loadUsers(){
  try{
    const j = await fetchJson('/api/users');
    document.getElementById('users').innerHTML = '<small>کاربران ثبت‌شده: '+ (j.users||[]).length +'</small><pre>'+JSON.stringify(j.users, null, 2) +'</pre>';
  }catch(e){ document.getElementById('users').innerText='خطا'; }
}

document.getElementById('dns-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const code = document.getElementById('code').value.trim().toUpperCase();
  const country = document.getElementById('country').value.trim();
  const addresses = document.getElementById('addresses').value.split(/\\n+/).map(s=>s.trim()).filter(Boolean);
  const stock = parseInt(document.getElementById('stock').value,10) || 1;
  const body = { code, country, addresses, stock };
  await fetch('/api/dns/'+code, { method:'PUT', headers:{'Content-Type':'application/json','x-admin-id':ADMIN}, body: JSON.stringify(body) });
  loadDNS();
};

document.getElementById('send-bc').onclick = async () => {
  const text = document.getElementById('broadcast').value.trim();
  if(!text) return alert('متن وارد کنید');
  await fetch('/api/broadcast', { method:'POST', headers:{'Content-Type':'application/json','x-admin-id':ADMIN}, body: JSON.stringify({ text }) });
  alert('در حال ارسال…');
};

if(ADMIN){
  loadDNS();
  loadUsers();
}
</script>
</body>
</html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    /* ---------------- Admin API endpoints ----------------
       - GET  /api/dns           -> list all dns records (admin)
       - GET  /api/dns/:CODE     -> get a record
       - PUT  /api/dns/:CODE     -> create/update (admin)
       - DELETE /api/dns/:CODE   -> delete (admin)
       - GET  /api/users         -> list users (admin)
       - POST /api/broadcast     -> broadcast message (admin) { text }
    ------------------------------------------------------------------*/

    if (path === "/api/dns" && method === "GET") {
      if (!isAdminReq(request, env)) return new Response("forbidden", { status: 403 });
      const list = await listAllDNS(env);
      return jsonResponse(list);
    }

    if (path.startsWith("/api/dns/")) {
      if (!isAdminReq(request, env)) return new Response("forbidden", { status: 403 });
      const code = path.split("/")[3] || path.split("/")[2];
      if (!code) return new Response("bad request", { status: 400 });

      if (method === "GET") {
        const rec = await getDNS(env, code);
        if (!rec) return new Response("not found", { status: 404 });
        return jsonResponse(rec);
      }
      if (method === "PUT") {
        try {
          const body = await request.json();
          body.code = code.toUpperCase();
          await putDNS(env, code, body);
          return jsonResponse({ ok: true });
        } catch (e) {
          return jsonResponse({ error: "invalid json" }, 400);
        }
      }
      if (method === "DELETE") {
        await delDNS(env, code);
        return jsonResponse({ ok: true });
      }
    }

    if (path === "/api/users" && method === "GET") {
      if (!isAdminReq(request, env)) return new Response("forbidden", { status: 403 });
      const users = await getAllUsers(env);
      return jsonResponse({ users });
    }

    if (path === "/api/broadcast" && method === "POST") {
      if (!isAdminReq(request, env)) return new Response("forbidden", { status: 403 });
      try {
        const body = await request.json();
        const text = body.text || "";
        if (!text) return jsonResponse({ error: "missing text" }, 400);
        const users = await getAllUsers(env);
        for (const u of users) {
          telegramSendMessage(env.BOT_TOKEN, u, text).catch(e=>console.error("broadcast err", e));
        }
        return jsonResponse({ ok: true, sent: users.length });
      } catch (e) { return jsonResponse({ error: "invalid json" }, 400); }
    }

    // GET /dns/:CODE public endpoint to fetch a DNS record (optional)
    if (path.startsWith("/dns/") && method === "GET") {
      const code = path.split("/")[2];
      if (!code) return new Response("bad request", { status: 400 });
      const rec = await getDNS(env, code);
      if (!rec) return new Response("not found", { status: 404 });
      return jsonResponse(rec);
    }

    return new Response("Not found", { status: 404 });
  }
};

/* -------------------- Helper: admin auth for web API -------------------- */
function isAdminReq(request, env) {
  const url = new URL(request.url);
  const q = url.searchParams.get("admin");
  const header = request.headers.get("x-admin-id");
  const adminId = String(env.ADMIN_ID || "");
  return String(q) === adminId || String(header) === adminId;
}

/* -------------------- Export default app for Pages catch-all -------------------- */
export default app;
