// main.js — Telegram WireGuard/DNS Bot + Responsive Web Panel for Cloudflare Pages
// ---------------------------------------------------------------
// - KV binding name: DB
// - Required env vars: BOT_TOKEN, ADMIN_ID
// - Features: Inline keyboard UX, dynamic country list from KV, unique IP assignment,
//   per-user daily quotas (3 DNS / 3 WG), responsive admin panel, admin broadcast.
// ---------------------------------------------------------------

/* ---------------------- Config ---------------------- */
const MAX_DNS_PER_DAY = 3;
const MAX_WG_PER_DAY = 3;
const DATE_YYYYMMDD = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

// Random MTU selection list
const WG_MTUS = [1280, 1320, 1360, 1380, 1400, 1420, 1440, 1480, 1500];

// User-selectable DNS options
const WG_FIXED_DNS = [
  "1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "9.9.9.9",
  "10.202.10.10", "78.157.42.100", "208.67.222.222", "208.67.220.220",
  "185.55.226.26", "185.55.225.25", "185.51.200.2"
];

// User-selectable operators
const OPERATORS = {
  irancell: { title: "ایرانسل" },
  mci: { title: "همراه اول" },
  tci: { title: "مخابرات" },
  rightel: { title: "رایتل" },
  shatel: { title: "شاتل موبایل" }
};

/* ---------------------- Utility Helpers ---------------------- */
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function tg(token, method, body, isForm = false) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: isForm ? {} : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body)
  });
  try { return await res.json(); } catch { return { ok: false }; }
}

function sendMsg(token, chat_id, text, extra = {}) {
  return tg(token, "sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
}

function sendFile(token, chat_id, filename, contents, caption = "") {
  const f = new FormData();
  f.append("chat_id", String(chat_id));
  f.append("document", new Blob([contents], { type: "text/plain" }), filename);
  if (caption) f.append("caption", caption);
  return tg(token, "sendDocument", f, true);
}

function randBase64(len = 32) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr));
}

// Convert country code (e.g. "IR") to flag emoji
function flagFromCode(code = "") {
  if (!code || code.length !== 2) return "";
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(c.charCodeAt(0) + 127397));
}

/* ---------------------- KV Helpers ---------------------- */
async function getDNS(env, code) {
  if (!code) return null;
  const raw = await env.DB.get(`dns:${code.toUpperCase()}`);
  return raw ? JSON.parse(raw) : null;
}

async function listDNS(env) {
  const res = await env.DB.list({ prefix: "dns:", limit: 1000 });
  const out = [];
  for (const k of res.keys || []) {
    try {
      const raw = await env.DB.get(k.name);
      if (raw) out.push(JSON.parse(raw));
    } catch (e) { /* skip */ }
  }
  return out;
}

async function updateDNS(env, code, obj) {
  await env.DB.put(`dns:${code.toUpperCase()}`, JSON.stringify(obj));
}

async function deleteDNS(env, code) {
  await env.DB.delete(`dns:${code.toUpperCase()}`);
}

/**
 * Remove one address from dns:{code}.addresses and return it.
 * Decrements stock accordingly. Returns null if none available.
 */
async function allocateAddress(env, code) {
  const rec = await getDNS(env, code);
  if (!rec || !Array.isArray(rec.addresses) || rec.addresses.length === 0) return null;
  // Pop first address (FIFO). Could use shift for more fairness.
  const addr = rec.addresses.shift();
  rec.stock = rec.addresses.length;
  if (rec.stock < 0) rec.stock = 0;
  await updateDNS(env, code, rec);
  return addr;
}

async function addUser(env, id) {
  const raw = await env.DB.get("users:list");
  const arr = raw ? JSON.parse(raw) : [];
  if (!arr.includes(id)) {
    arr.push(id);
    await env.DB.put("users:list", JSON.stringify(arr));
  }
}

async function allUsers(env) {
  const raw = await env.DB.get("users:list");
  return raw ? JSON.parse(raw) : [];
}

/* ---------------------- Quota System ---------------------- */
async function getQuota(env, id) {
  const d = DATE_YYYYMMDD();
  const dns = parseInt(await env.DB.get(`q:dns:${id}:${d}`)) || 0;
  const wg = parseInt(await env.DB.get(`q:wg:${id}:${d}`)) || 0;
  return { dnsUsed: dns, wgUsed: wg, dnsLeft: Math.max(0, MAX_DNS_PER_DAY - dns), wgLeft: Math.max(0, MAX_WG_PER_DAY - wg) };
}

async function incQuota(env, id, type) {
  const d = DATE_YYYYMMDD();
  const key = `q:${type}:${id}:${d}`;
  const v = parseInt(await env.DB.get(key)) || 0;
  await env.DB.put(key, String(v + 1));
}

/* ---------------------- UI Elements (inline keyboards) ---------------------- */
function stockEmoji(n) {
  if (!n || n <= 0) return "🔴";
  if (n <= 10) return "🟡";
  return "🟢";
}

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🌐 دریافت DNS", callback_data: "menu_dns" }, { text: "🛡️ WireGuard", callback_data: "menu_wg" }],
      [{ text: "📊 وضعیت من", callback_data: "menu_status" }]
    ]
  };
}

function countriesKeyboard(list) {
  // list: array of records with { code, country, flag?, stock }
  const rows = [];
  for (const r of list) {
    const code = (r.code || "").toUpperCase();
    const countryName = r.country || code;
    const flag = r.flag || flagFromCode(code);
    const label = `${stockEmoji(r.stock)} ${r.stock ?? 0}  |  ${flag} ${countryName}`;
    rows.push([{ text: label, callback_data: `ct:${code}` }]);
  }
  rows.push([{ text: "🔙 بازگشت", callback_data: "back" }]);
  return { inline_keyboard: rows };
}

function actionKeyboard(code) {
  return {
    inline_keyboard: [
      [{ text: "🌐 دریافت DNS", callback_data: `dns:${code}` }, { text: "🛡️ WireGuard", callback_data: `wg:${code}` }],
      [{ text: "🔙 بازگشت", callback_data: "back" }]
    ]
  };
}

function operatorKeyboard(code) {
  const rows = [];
  for (const [k, v] of Object.entries(OPERATORS)) {
    rows.push([{ text: v.title, callback_data: `op:${code}:${k}` }]);
  }
  rows.push([{ text: "🔙 بازگشت", callback_data: `ct:${code}` }]);
  return { inline_keyboard: rows };
}

function dnsChoiceKeyboard(code, op) {
  const rows = WG_FIXED_DNS.map(d => [{ text: d, callback_data: `choose:${code}:${op}:${d}` }]);
  rows.push([{ text: "🔙 بازگشت", callback_data: `op:${code}` }]);
  return { inline_keyboard: rows };
}

/* ---------------------- WireGuard builder ---------------------- */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildInterfaceOnlyConfig({ privateKey, address = "10.66.66.2/32", mtu = 1420, dns = "1.1.1.1" }) {
  // As requested, only Interface block (no Peer)
  return [
    "[Interface]",
    `PrivateKey = ${privateKey}`,
    `Address = ${address}`,
    `DNS = ${dns}`,
    `MTU = ${mtu}`,
    ""
  ].join("\n");
}

/* ---------------------- Telegram webhook handler ---------------------- */
export async function handleUpdate(update, env, { waitUntil } = {}) {
  const token = env.BOT_TOKEN;
  const adminId = String(env.ADMIN_ID || "");
  try {
    if (!update) return;

    // allow both message and callback_query
    const message = update.message || update.edited_message;
    const callback = update.callback_query;
    const user = (message && message.from && message.from.id) || (callback && callback.from && callback.from.id);
    const chatId = (message && message.chat && message.chat.id) || (callback && callback.message && callback.message.chat && callback.message.chat.id);
    if (!chatId) return;

    // register user for broadcast list (async)
    if (user) {
      const p = addUser(env, user);
      if (waitUntil) waitUntil(p);
    }

    // handle callback_query first (button-based UX)
    if (callback) {
      const data = callback.data || "";
      // answer callback to remove loading spinner
      tg(token, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => {});

      // navigation
      if (data === "back") {
        await sendMsg(token, chatId, "منوی اصلی:", { reply_markup: mainMenuKeyboard() });
        return;
      }

      if (data === "menu_dns") {
        const list = await listDNS(env);
        if (!list || list.length === 0) {
          await sendMsg(token, chatId, "فعلاً رکوردی موجود نیست.");
          return;
        }
        // ensure minimal fields
        const mapped = list.map(r => ({ code: (r.code || "").toUpperCase(), country: r.country || r.code, flag: r.flag || flagFromCode(r.code || ""), stock: r.stock || 0 }));
        await sendMsg(token, chatId, "کشور را انتخاب کنید:", { reply_markup: countriesKeyboard(mapped) });
        return;
      }

      if (data === "menu_wg") {
        const list = await listDNS(env);
        if (!list || list.length === 0) {
          await sendMsg(token, chatId, "فعلاً رکوردی موجود نیست.");
          return;
        }
        const mapped = list.map(r => ({ code: (r.code || "").toUpperCase(), country: r.country || r.code, flag: r.flag || flagFromCode(r.code || ""), stock: r.stock || 0 }));
        await sendMsg(token, chatId, "کشور را انتخاب کنید:", { reply_markup: countriesKeyboard(mapped) });
        return;
      }

      if (data === "menu_status") {
        if (!user) { await sendMsg(token, chatId, "مشخصات کاربری پیدا نشد."); return; }
        const q = await getQuota(env, user);
        const d = new Date();
        const tomorrow = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()+1));
        const resetAt = tomorrow.toISOString();
        await sendMsg(token, chatId, `📊 وضعیت شما:\nDNS باقی‌مانده امروز: ${q.dnsLeft}\nWG باقی‌مانده امروز: ${q.wgLeft}\nریست در: ${resetAt}`);
        return;
      }

      // country selected
      if (data.startsWith("ct:")) {
        const code = data.slice(3);
        await sendMsg(token, chatId, `کشور انتخاب شد: <b>${code}</b>\nعملیات را انتخاب کنید:`, { reply_markup: actionKeyboard(code) });
        return;
      }

      // dns request flow
      if (data.startsWith("dns:")) {
        const code = data.slice(4);
        if (!user) { await sendMsg(token, chatId, "کاربر نامشخص"); return; }
        const q = await getQuota(env, user);
        if (q.dnsLeft <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه DNS شما به پایان رسیده است.\nباقی‌مانده: ${q.dnsLeft}`);
          return;
        }
        // allocate one address and send it
        const addr = await allocateAddress(env, code);
        if (!addr) {
          await sendMsg(token, chatId, `برای ${code} آدرسی موجود نیست.`);
          return;
        }
        // send address and decrement quota
        await sendMsg(token, chatId, `📡 آدرس DNS برای ${code}:\n<code>${addr}</code>`);
        await incQuota(env, user, "dns");
        // record history
        const histKey = `history:${user}`;
        try {
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({ type: "dns", country: code, at: new Date().toISOString(), value: addr });
          if (h.length > 20) h.splice(20);
          await env.DB.put(histKey, JSON.stringify(h));
        } catch (e) { console.error("history save err", e); }
        return;
      }

      // wg flow step 1: user clicked wg:CODE -> choose operator
      if (data.startsWith("wg:")) {
        const code = data.slice(3);
        await sendMsg(token, chatId, `برای ${code} اپراتور مورد نظر را انتخاب کنید:`, { reply_markup: operatorKeyboard(code) });
        return;
      }

      // wg flow step 2: op:CODE:OPKEY -> choose DNS
      if (data.startsWith("op:")) {
        const parts = data.split(":");
        const code = parts[1];
        const op = parts[2];
        await sendMsg(token, chatId, `DNS مورد نظر برای اپراتور انتخابی را انتخاب کنید:`, { reply_markup: dnsChoiceKeyboard(code, op) });
        return;
      }

      // wg final: choose:CODE:OP:DNS -> allocate IP, build config, send file
      if (data.startsWith("choose:")) {
        // format choose:CODE:OP:DNSVALUE
        const parts = data.split(":");
        const code = parts[1];
        const op = parts[2];
        // DNS may contain ":" if colon present; join rest
        const dnsValue = parts.slice(3).join(":");
        if (!user) { await sendMsg(token, chatId, "کاربر نامشخص"); return; }
        const q = await getQuota(env, user);
        if (q.wgLeft <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه WireGuard شما به پایان رسیده است.\nباقی‌مانده: ${q.wgLeft}`);
          return;
        }
        // allocate endpoint IP
        const endpoint = await allocateAddress(env, code);
        if (!endpoint) {
          await sendMsg(token, chatId, `برای ${code} آدرسی موجود نیست.`);
          return;
        }
        // pick random MTU and user DNS
        const mtu = pickRandom(WG_MTUS);
        const userDns = dnsValue || pickRandom(WG_FIXED_DNS);
        // prepare keys (note: not real WG keypair derivation; uses base64 random)
        const priv = randBase64(32);
        // we don't include Peer block as requested. But include the selected DNS (user-chosen) and also a location DNS prefixed:
        // "selected global DNS + location DNS" — build a DNS list where the chosen DNS appears first, then if rec has dns array, append first.
        const rec = await getDNS(env, code);
        const locationDns = (rec && rec.dns && rec.dns.length) ? rec.dns[0] : null;
        const combinedDns = locationDns ? `${userDns}, ${locationDns}` : userDns;
        const iface = buildInterfaceOnlyConfig({ privateKey: priv, address: "10.66.66.2/32", mtu, dns: combinedDns });
        const filename = `wg-${code}-${Date.now()}.conf`;
        const caption = `WireGuard — ${code} — اپراتور: ${OPERATORS[op] ? OPERATORS[op].title : op}`;
        await sendFile(token, chatId, filename, iface, caption);
        // increment quota and save history
        await incQuota(env, user, "wg");
        try {
          const histKey = `history:${user}`;
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({ type: "wg", country: code, at: new Date().toISOString(), endpoint, operator: op, dns: userDns });
          if (h.length > 20) h.splice(20);
          await env.DB.put(histKey, JSON.stringify(h));
        } catch (e) { console.error("history save err", e); }
        return;
      }

      return;
    } // end callback handling

    // Plain text commands (fallback)
    const text = (message && message.text) ? message.text.trim() : "";

    if (text === "/start") {
      await sendMsg(token, chatId, "سلام 👋\nاز دکمه‌ها استفاده کنید:", { reply_markup: mainMenuKeyboard() });
      return;
    }

    if (text && text.startsWith("/broadcast")) {
      // admin only
      const fromId = message && message.from && message.from.id;
      if (String(fromId) !== String(adminId)) {
        await sendMsg(token, chatId, "این دستور مخصوص ادمین است.");
        return;
      }
      const payload = text.slice("/broadcast".length).trim();
      if (!payload) { await sendMsg(token, chatId, "متن پیام را بعد از /broadcast وارد کنید."); return; }
      const list = await allUsers(env);
      for (const u of list) {
        sendMsg(token, u, payload).catch(e => console.error("broadcast err", e));
      }
      await sendMsg(token, chatId, `پیام به ${list.length} کاربر ارسال شد.`);
      return;
    }

    if (text === "/status" || text === "/me") {
      if (!user) { await sendMsg(token, chatId, "کاربر نامشخص"); return; }
      const q = await getQuota(env, user);
      const rawHist = await env.DB.get(`history:${user}`);
      const hist = rawHist ? JSON.parse(rawHist) : [];
      let s = `📊 وضعیت شما:\nDNS باقی‌مانده امروز: ${q.dnsLeft}\nWG باقی‌مانده امروز: ${q.wgLeft}\n\nآخرین درخواست‌ها:\n`;
      if (!hist || hist.length === 0) s += "(تاریخی ثبت نشده)";
      else s += hist.slice(0, 10).map(h => `${h.at.slice(0, 19).replace("T", " ")} — ${h.type} — ${h.country || ""}`).join("\n");
      await sendMsg(token, chatId, s);
      return;
    }

    // default: show menu
    await sendMsg(token, chatId, "لطفاً از منوی دکمه‌ای استفاده کنید:", { reply_markup: mainMenuKeyboard() });

  } catch (err) {
    console.error("handleUpdate error:", err);
    try {
      const chat = (update.message && update.message.chat && update.message.chat.id) || (update.callback_query && update.callback_query.message && update.callback_query.message.chat && update.callback_query.message.chat.id);
      if (chat) await sendMsg(env.BOT_TOKEN, chat, "خطایی رخ داد، لطفاً بعداً امتحان کنید.");
    } catch (e) { /* swallow */ }
  }
}

/* ---------------------- Web app.fetch (Pages catch-all) ---------------------- */

function isAdminReq(request, env) {
  const url = new URL(request.url);
  const q = url.searchParams.get("admin");
  const header = request.headers.get("x-admin-id");
  const adminId = String(env.ADMIN_ID || "");
  return String(q) === adminId || String(header) === adminId;
}

const app = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // Root: admin panel (responsive, modern)
    if (path === "/" && method === "GET") {
      const html = `<!doctype html>
<html lang="fa">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WireGuard Bot — Panel</title>
<style>
:root{--bg:#071027;--card:#0b1220;--muted:#9fb6c6;--accent:#06b6d4;--btn:#0ea5a5;--text:#e6eef8}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:linear-gradient(180deg,#041022 0%,#071227 100%);color:var(--text);padding:20px}
.container{max-width:1100px;margin:0 auto}
.header{display:flex;gap:12px;align-items:center;justify-content:space-between}
.brand{font-size:20px;font-weight:600}
.grid{display:grid;grid-template-columns:1fr 360px;gap:18px;margin-top:18px}
.card{background:var(--card);border-radius:12px;padding:16px;box-shadow:0 6px 20px rgba(2,6,23,.6)}
.row{display:flex;gap:8px;align-items:center}
input,textarea,select{background:#071226;border:1px solid #18324a;color:var(--text);padding:8px;border-radius:8px;min-width:0}
button{background:var(--btn);border:0;color:#042026;padding:8px 12px;border-radius:8px;cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{padding:10px;text-align:left;border-bottom:1px solid #0f2430;font-size:14px}
.flag{font-size:18px;margin-right:6px}
.footer{color:var(--muted);font-size:13px;margin-top:12px}
@media(max-width:880px){.grid{grid-template-columns:1fr;}}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="brand">WireGuard Bot — پنل مدیریت</div>
    <div class="muted">برای عملیات ادمین ?admin=ADMIN_ID یا هدر x-admin-id را قرار دهید</div>
  </div>

  <div class="grid">
    <div class="card" id="main-card">
      <h3>DNS‌ها</h3>
      <div id="dns-list">در حال بارگذاری…</div>
      <hr/>
      <h4>افزودن / ویرایش DNS</h4>
      <form id="dns-form">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="code" placeholder="کد (مثال: GE)" required />
          <input id="country" placeholder="نام کشور" />
          <input id="stock" placeholder="stock" type="number" value="1" style="width:100px" />
        </div>
        <div style="margin-top:8px">
          <textarea id="addresses" rows="4" placeholder="آدرس‌ها هر خط یک مقدار"></textarea>
        </div>
        <div style="margin-top:8px" class="row">
          <button type="submit">ثبت</button>
        </div>
      </form>
      <div class="footer">توضیحات: وقتی آدرس از دیتابیس اختصاص داده شود، از لیست حذف و stock آپدیت می‌شود.</div>
    </div>

    <div class="card">
      <h3>کاربران & ارسال همگانی</h3>
      <div id="users">در حال بارگذاری…</div>
      <hr/>
      <h4>ارسال پیام همگانی</h4>
      <textarea id="broadcast" rows="4"></textarea>
      <div style="margin-top:8px"><button id="send-bc">ارسال همگانی</button></div>
    </div>
  </div>
</div>

<script>
const ADMIN = new URL(location).searchParams.get('admin') || '';
function authHeaders() {
  const h = {};
  if (ADMIN) h['x-admin-id'] = ADMIN;
  return h;
}
async function fetchJson(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers || {}, authHeaders());
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error('خطا');
  return res.json();
}
async function loadDNS() {
  try {
    const list = await fetchJson('/api/dns');
    if (!list || list.length === 0) {
      document.getElementById('dns-list').innerText = 'خالی';
      return;
    }
    const rows = list.map(r => {
      const add = (r.addresses||[]).map(a=>'<div style="font-family:monospace">'+a+'</div>').join('');
      const flag = (r.flag) ? `<span class="flag">${r.flag}</span>` : '';
      return '<tr><td>'+flag+ (r.code||'') +'</td><td>'+ (r.country||'') +'</td><td>'+ add +'</td><td>'+ (r.stock||0) +'</td><td><button data-code="'+(r.code||'')+'" class="del">حذف</button></td></tr>';
    }).join('');
    document.getElementById('dns-list').innerHTML = '<table><tr><th>کد</th><th>کشور</th><th>آدرس‌ها</th><th>stock</th><th></th></tr>'+rows+'</table>';
    document.querySelectorAll('.del').forEach(b => b.onclick = async e => {
      const code = e.target.dataset.code;
      if (!confirm('آیا حذف شود؟')) return;
      await fetch('/api/dns/' + code, { method: 'DELETE', headers: authHeaders() });
      loadDNS();
    });
  } catch (e) {
    document.getElementById('dns-list').innerText = 'خطا در بارگذاری';
  }
}
async function loadUsers() {
  try {
    const j = await fetchJson('/api/users');
    document.getElementById('users').innerHTML = '<small>کاربران ثبت‌شده: '+ (j.users||[]).length +'</small><pre>'+JSON.stringify(j.users, null, 2) +'</pre>';
  } catch (e) {
    document.getElementById('users').innerText = 'خطا';
  }
}
document.getElementById('dns-form').onsubmit = async ev => {
  ev.preventDefault();
  const code = document.getElementById('code').value.trim().toUpperCase();
  const country = document.getElementById('country').value.trim();
  const stock = parseInt(document.getElementById('stock').value, 10) || 1;
  const addresses = document.getElementById('addresses').value.split(/\\n+/).map(s=>s.trim()).filter(Boolean);
  const body = { code, country, stock, addresses, flag: (code.length===2?String.fromCodePoint(...code.split('').map(c=>c.charCodeAt(0)+127397)): '') };
  await fetch('/api/dns/' + code, { method: 'PUT', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify(body) });
  loadDNS();
};
document.getElementById('send-bc').onclick = async () => {
  const text = document.getElementById('broadcast').value.trim();
  if (!text) return alert('متن وارد کنید');
  await fetch('/api/broadcast', { method: 'POST', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify({ text }) });
  alert('پیام در حال ارسال است');
};
if (ADMIN) { loadDNS(); loadUsers(); } else {
  document.getElementById('dns-list').innerText = 'برای استفاده پنل، ?admin=ADMIN_ID به URL اضافه کنید.';
  document.getElementById('users').innerText = 'برای استفاده پنل، ?admin=ADMIN_ID به URL اضافه کنید.';
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
      const list = await listDNS(env);
      return jsonResponse(list);
    }

    if (path.startsWith("/api/dns/")) {
      if (!isAdminReq(request, env)) return new Response("forbidden", { status: 403 });
      const parts = path.split("/");
      const code = parts[2] || parts[3];
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
          await updateDNS(env, code, body);
          return jsonResponse({ ok: true });
        } catch (e) {
          return jsonResponse({ error: "invalid json" }, 400);
        }
      }
      if (method === "DELETE") {
        await deleteDNS(env, code);
        return jsonResponse({ ok: true });
      }
    }

    if (path === "/api/users" && method === "GET") {
      if (!isAdminReq(request, env)) return new Response("forbidden", { status: 403 });
      const us = await allUsers(env);
      return jsonResponse({ users: us });
    }

    if (path === "/api/broadcast" && method === "POST") {
      if (!isAdminReq(request, env)) return new Response("forbidden", { status: 403 });
      try {
        const body = await request.json();
        const text = body.text || "";
        if (!text) return jsonResponse({ error: "missing text" }, 400);
        const us = await allUsers(env);
        for (const u of us) {
          sendMsg(env.BOT_TOKEN, u, text).catch(e => console.error("broadcast err", e));
        }
        return jsonResponse({ ok: true, sent: us.length });
      } catch (e) { return jsonResponse({ error: "invalid json" }, 400); }
    }

    // public small endpoint to fetch DNS by code (optional)
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

/* ---------------------- Admin auth helper ---------------------- */
function isAdminReq(request, env) {
  const url = new URL(request.url);
  const q = url.searchParams.get("admin");
  const header = request.headers.get("x-admin-id");
  const adminId = String(env.ADMIN_ID || "");
  return String(q) === adminId || String(header) === adminId;
}

/* ---------------------- Export default app ---------------------- */
export default app;
