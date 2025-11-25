// main.js — Telegram WireGuard/DNS Bot + Responsive Web Panel for Cloudflare Pages
// ---------------------------------------------------------------
// - KV binding name: DB
// - Required env vars: BOT_TOKEN, ADMIN_ID (fallback to numeric ADMIN_FALLBACK)
// - Features: Inline keyboard UX, dynamic country list from KV, unique IP assignment,
//   per-user daily quotas (3 DNS / 3 WG), responsive admin panel, admin broadcast.
// ---------------------------------------------------------------

/* ---------------------- Config ---------------------- */
const MAX_DNS_PER_DAY = 3;
const MAX_WG_PER_DAY = 3;
const DATE_YYYYMMDD = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

// Fallback admin id (used if ENV ADMIN_ID is missing)
const ADMIN_FALLBACK = '7240662021';

// Random MTU selection list
const WG_MTUS = [1280, 1320, 1360, 1380, 1400, 1420, 1440, 1480, 1500];

// User-selectable DNS options
const WG_FIXED_DNS = [
  "1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "9.9.9.9",
  "10.202.10.10", "78.157.42.100", "208.67.222.222", "208.67.220.220",
  "185.55.226.26", "185.55.225.25", "185.51.200.2"
];

// Country names in Persian
const COUNTRY_NAMES_FA = {
  IR: "ایران", US: "آمریکا", GB: "انگلستان", DE: "آلمان", FR: "فرانسه",
  NL: "هلند", SE: "سوئد", FI: "فنلاند", NO: "نروژ", DK: "دانمارک",
  CH: "سوئیس", AT: "اتریش", BE: "بلژیک", ES: "اسپانیا", IT: "ایتالیا",
  PL: "لهستان", RO: "رومانی", CZ: "چک", HU: "مجارستان", BG: "بلغارستان",
  UA: "اوکراین", RU: "روسیه", TR: "ترکیه", AE: "امارات", SA: "عربستان",
  JP: "ژاپن", KR: "کره جنوبی", SG: "سنگاپور", HK: "هنگ کنگ", AU: "استرالیا",
  CA: "کانادا", BR: "برزیل", MX: "مکزیک", AR: "آرژانتین", CL: "شیلی",
  IN: "هند", ID: "اندونزی", TH: "تایلند", VN: "ویتنام", MY: "مالزی",
  PH: "فیلیپین", ZA: "آفریقای جنوبی", EG: "مصر", NG: "نیجریه",
  IL: "اسرائیل", GE: "گرجستان", AM: "ارمنستان", AZ: "آذربایجان",
  KZ: "قزاقستان", UZ: "ازبکستان", IS: "ایسلند", IE: "ایرلند",
  PT: "پرتغال", GR: "یونان", HR: "کرواسی", RS: "صربستان", LV: "لتونی",
  LT: "لیتوانی", EE: "استونی", SK: "اسلواکی", SI: "اسلوونی", LU: "لوکزامبورگ"
};

// User-selectable operators with their address ranges
const OPERATORS = {
  irancell: { title: "ایرانسل", addresses: ["2.144.0.0/16"] },
  mci: { title: "همراه اول", addresses: ["5.52.0.0/16"] },
  tci: { title: "مخابرات", addresses: ["2.176.0.0/15", "2.190.0.0/15"] },
  rightel: { title: "رایتل", addresses: ["37.137.128.0/17", "95.162.0.0/17"] },
  shatel: { title: "شاتل موبایل", addresses: ["94.182.0.0/16", "37.148.0.0/18"] }
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

function mainMenuKeyboard(isAdmin = false) {
  const rows = [
    [ { text: "🛡️ WireGuard", callback_data: "menu_wg" }, { text: "🌐 DNS", callback_data: "menu_dns" } ],
    [ { text: "👤 my Account", callback_data: "menu_account" } ]
  ];
  if (isAdmin) {
    rows.push([
      { text: "📢 پیام همگانی", callback_data: "menu_broadcast" },
      { text: "📊 آمار ربات", callback_data: "menu_stats" }
    ]);
  }
  return { inline_keyboard: rows };
}

function countriesKeyboard(list, page = 0, mode = 'select') {
  const ITEMS_PER_PAGE = 14;
  const start = page * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const pageItems = list.slice(start, end);
  
  const rows = [];
  for (const r of pageItems) {
    const code = (r.code || "").toUpperCase();
    const countryNameFa = COUNTRY_NAMES_FA[code] || r.country || code;
    const flag = flagFromCode(code);
    const stockCount = r.stock ?? 0;
    const emoji = stockEmoji(stockCount);
    
    const callbackData = mode === 'dns' ? `dns:${code}` : (mode === 'wg' ? `wg:${code}` : `ct:${code}`);
    
    rows.push([
      { text: emoji, callback_data: `noop:${code}` },
      { text: String(stockCount), callback_data: `noop:${code}` },
      { text: `${flag} ${countryNameFa}`, callback_data: callbackData }
    ]);
  }
  
  const totalPages = Math.ceil(list.length / ITEMS_PER_PAGE);
  const navButtons = [];
  if (page > 0) {
    navButtons.push({ text: "◀️ قبلی", callback_data: `page:${mode}:${page - 1}` });
  }
  if (end < list.length) {
    navButtons.push({ text: "بعدی ▶️", callback_data: `page:${mode}:${page + 1}` });
  }
  if (navButtons.length > 0) {
    rows.push(navButtons);
  }
  
  rows.push([{ text: "🔙 بازگشت به منو", callback_data: "back" }]);
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
  const rows = [
    [
      { text: OPERATORS.irancell.title, callback_data: `op:${code}:irancell` },
      { text: OPERATORS.mci.title, callback_data: `op:${code}:mci` }
    ],
    [
      { text: OPERATORS.tci.title, callback_data: `op:${code}:tci` },
      { text: OPERATORS.rightel.title, callback_data: `op:${code}:rightel` }
    ],
    [
      { text: OPERATORS.shatel.title, callback_data: `op:${code}:shatel` }
    ],
    [{ text: "🔙 بازگشت", callback_data: "back" }]
  ];
  return { inline_keyboard: rows };
}

function dnsChoiceKeyboard(code, op) {
  const rows = [];
  for (let i = 0; i < WG_FIXED_DNS.length; i += 2) {
    const row = [{ text: WG_FIXED_DNS[i], callback_data: `choose:${code}:${op}:${WG_FIXED_DNS[i]}` }];
    if (i + 1 < WG_FIXED_DNS.length) {
      row.push({ text: WG_FIXED_DNS[i + 1], callback_data: `choose:${code}:${op}:${WG_FIXED_DNS[i + 1]}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "🔙 بازگشت", callback_data: `op:${code}` }]);
  return { inline_keyboard: rows };
}

/* ---------------------- WireGuard builder ---------------------- */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildInterfaceOnlyConfig({ privateKey, address = "10.66.66.2/32", mtu = 1420, dns = "1.1.1.1", operatorAddress = null }) {
  const finalAddress = operatorAddress || address;
  return [
    "[Interface]",
    `PrivateKey = ${privateKey}`,
    `Address = ${finalAddress}`,
    `DNS = ${dns}`,
    `MTU = ${mtu}`,
    ""
  ].join("\n");
}

/* ---------------------- Telegram webhook handler ---------------------- */
export async function handleUpdate(update, env, { waitUntil } = {}) {
  const token = env.BOT_TOKEN;
  // prefer env ADMIN_ID, otherwise fallback to ADMIN_FALLBACK
  const adminId = String(env.ADMIN_ID || ADMIN_FALLBACK);
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

    // If admin is in awaiting-broadcast state and sends a plain text message -> broadcast
    if (message && message.text && user && String(user) === adminId) {
      const waiting = await env.DB.get(`awaitBroadcast:${adminId}`);
      if (waiting) {
        const txt = message.text.trim();
        if (txt.length > 0) {
          const list = await allUsers(env);
          for (const u of list) {
            sendMsg(token, u, txt).catch(() => {});
          }
          await env.DB.delete(`awaitBroadcast:${adminId}`);
          await sendMsg(token, chatId, `✅ پیام برای ${list.length} کاربر ارسال شد.`, { reply_markup: mainMenuKeyboard(true) });
          return;
        }
      }
    }

    // handle callback_query first (button-based UX)
    if (callback) {
      const data = callback.data || "";
      // answer callback to remove loading spinner
      tg(token, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => {});

      // navigation
      if (data === "back") {
        await sendMsg(token, chatId, "منوی اصلی:", { reply_markup: mainMenuKeyboard(String(user) === adminId) });
        return;
      }

      // Pagination handler
      if (data.startsWith("page:")) {
        const parts = data.split(":");
        const mode = parts[1] || 'select';
        const page = parseInt(parts[2]) || 0;
        const list = await listDNS(env);
        if (!list || list.length === 0) {
          await sendMsg(token, chatId, "فعلاً رکوردی موجود نیست.");
          return;
        }
        const mapped = list
          .map(r => ({ 
            code: (r.code || "").toUpperCase(), 
            country: r.country || r.code, 
            stock: r.stock || 0 
          }))
          .sort((a, b) => b.stock - a.stock);
        
        const totalPages = Math.ceil(mapped.length / 14);
        const title = mode === 'dns' ? '🌐 دریافت DNS' : (mode === 'wg' ? '🛡️ دریافت WireGuard' : '📡 لیست کشورها');
        await tg(token, "editMessageText", {
          chat_id: chatId,
          message_id: callback.message.message_id,
          text: `${title} (صفحه ${page + 1} از ${totalPages}):\n\n🟢 موجود | 🟡 کم | 🔴 تمام`,
          reply_markup: countriesKeyboard(mapped, page, mode)
        });
        return;
      }

      // Handle noop callbacks (for non-clickable buttons like stock indicator)
      if (data.startsWith("noop:")) {
        return;
      }

      if (data === "menu_dns") {
        const list = await listDNS(env);
        if (!list || list.length === 0) {
          await sendMsg(token, chatId, "فعلاً رکوردی موجود نیست.");
          return;
        }
        const mapped = list
          .map(r => ({ 
            code: (r.code || "").toUpperCase(), 
            country: r.country || r.code, 
            stock: r.stock || 0 
          }))
          .sort((a, b) => b.stock - a.stock);
        
        await sendMsg(token, chatId, "🌐 دریافت DNS - کشور مورد نظر را انتخاب کنید:\n\n🟢 موجود | 🟡 کم | 🔴 تمام", { 
          reply_markup: countriesKeyboard(mapped, 0, 'dns') 
        });
        return;
      }

      if (data === "menu_wg") {
        const list = await listDNS(env);
        if (!list || list.length === 0) {
          await sendMsg(token, chatId, "فعلاً رکوردی موجود نیست.");
          return;
        }
        const mapped = list
          .map(r => ({ 
            code: (r.code || "").toUpperCase(), 
            country: r.country || r.code, 
            stock: r.stock || 0 
          }))
          .sort((a, b) => b.stock - a.stock);
        
        await sendMsg(token, chatId, "🛡️ دریافت WireGuard - کشور مورد نظر را انتخاب کنید:\n\n🟢 موجود | 🟡 کم | 🔴 تمام", { 
          reply_markup: countriesKeyboard(mapped, 0, 'wg') 
        });
        return;
      }

      if (data === "menu_account") {
        if (!user) { await sendMsg(token, chatId, "مشخصات کاربری پیدا نشد."); return; }
        const q = await getQuota(env, user);
        const rawHist = await env.DB.get(`history:${user}`);
        const hist = rawHist ? JSON.parse(rawHist) : [];
        let text = `👤 حساب شما:\nDNS باقی‌مانده امروز: ${q.dnsLeft}\nWG باقی‌مانده امروز: ${q.wgLeft}\n\nتاریخچه اخیر:`;
        if (!hist.length) text += "\n(هیچ سابقه‌ای نیست)";
        else text += "\n" + hist.slice(0, 10).map(h => `${h.at.slice(0,19).replace("T"," ")} — ${h.type} — ${h.country || ""}`).join("\n");
        await sendMsg(token, chatId, text, { reply_markup: mainMenuKeyboard(String(user) === adminId) });
        return;
      }

      if (data === "menu_broadcast") {
        if (String(user) !== adminId) return;
        await env.DB.put(`awaitBroadcast:${adminId}`, "1");
        await sendMsg(token, chatId, "لطفا متن پیام همگانی را ارسال کنید:");
        return;
      }

      if (data === "menu_stats") {
        if (String(user) !== adminId) return;
        const us = await allUsers(env);
        const dns = await listDNS(env);
        const totalStock = dns.reduce((s, r) => s + (r.stock || 0), 0);
        await sendMsg(token, chatId, `📊 آمار ربات:\n👥 کاربران: ${us.length}\n🌍 کشورها: ${dns.length}\n📡 مجموع موجودی IP: ${totalStock}`, { reply_markup: mainMenuKeyboard(true) });
        return;
      }

      // country selected
      if (data.startsWith("ct:")) {
        const code = data.slice(3);
        const flag = flagFromCode(code);
        const countryName = COUNTRY_NAMES_FA[code] || code;
        const rec = await getDNS(env, code);
        const stockInfo = rec ? `موجودی: ${rec.stock || 0} IP` : "موجودی: نامشخص";
        
        await sendMsg(token, chatId, 
          `${flag} <b>${countryName}</b>\n${stockInfo}\n\nعملیات را انتخاب کنید:`, 
          { reply_markup: actionKeyboard(code) }
        );
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
        const addr = await allocateAddress(env, code);
        if (!addr) {
          await sendMsg(token, chatId, `برای ${code} آدرسی موجود نیست.`);
          return;
        }
        
        const rec = await getDNS(env, code);
        const flag = flagFromCode(code);
        const countryName = COUNTRY_NAMES_FA[code] || rec?.country || code;
        const stock = rec?.stock || 0;
        const checkUrl = `https://check-host.net/check-ping?host=${addr}`;
        
        const message = `${flag} <b>${countryName}</b>

🌐 آدرس اختصاصی شما:
<code>${addr}</code>

📊 موجودی باقی‌مانده ${countryName}: ${stock} عدد
📈 سهمیه امروز شما: ${q.dnsUsed + 1}/${MAX_DNS_PER_DAY}

🔧 DNS‌های پیشنهادی:
• <code>178.22.122.100</code> - شاتل
• <code>185.51.200.2</code> - ایرانسل
• <code>10.202.10.10</code> - رادار
• <code>8.8.8.8</code> - گوگل
• <code>1.1.1.1</code> - کلودفلر
• <code>4.2.2.4</code> - لول 3
• <code>78.157.42.100</code> - الکترو

💡 نکته: برای بررسی فیلتر، فقط سرورهای ایران را چک کنید (باید 4/4 باشد)`;
        
        await sendMsg(token, chatId, message, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔍 بررسی وضعیت فیلتر", url: checkUrl }],
              [{ text: "🔙 بازگشت به منو", callback_data: "back" }]
            ]
          }
        });
        await incQuota(env, user, "dns");
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
        const parts = data.split(":");
        const code = parts[1];
        const op = parts[2];
        const dnsValue = parts.slice(3).join(":");
        if (!user) { await sendMsg(token, chatId, "کاربر نامشخص"); return; }
        const q = await getQuota(env, user);
        if (q.wgLeft <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه WireGuard شما به پایان رسیده است.\nباقی‌مانده: ${q.wgLeft}`);
          return;
        }
        const endpoint = await allocateAddress(env, code);
        if (!endpoint) {
          await sendMsg(token, chatId, `برای ${code} آدرسی موجود نیست.`);
          return;
        }
        const mtu = pickRandom(WG_MTUS);
        const userDns = dnsValue || pickRandom(WG_FIXED_DNS);
        const priv = randBase64(32);
        const rec = await getDNS(env, code);
        
        // DNS: یکی انتخابی کاربر، یکی از لوکیشن
        const locationDns = (rec && rec.dns && rec.dns.length) ? rec.dns[0] : null;
        const combinedDns = locationDns ? `${locationDns}, ${userDns}` : userDns;
        
        // Address: از اپراتور انتخابی
        const operatorData = OPERATORS[op];
        const operatorAddress = operatorData && operatorData.addresses && operatorData.addresses.length 
          ? pickRandom(operatorData.addresses) 
          : "10.66.66.2/32";
        
        const iface = buildInterfaceOnlyConfig({ 
          privateKey: priv, 
          address: "10.66.66.2/32", 
          mtu, 
          dns: combinedDns,
          operatorAddress 
        });
        
        // نام فایل فقط نام کشور
        const countryName = COUNTRY_NAMES_FA[code] || rec?.country || code;
        const filename = `${countryName}.conf`;
        const flag = flagFromCode(code);
        const caption = `${flag} <b>${countryName}</b>\n🔧 اپراتور: ${operatorData ? operatorData.title : op}`;
        
        await sendFile(token, chatId, filename, iface, caption);
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
      await sendMsg(token, chatId, "سلام 👋\nاز دکمه‌ها استفاده کنید:", { reply_markup: mainMenuKeyboard(String(user) === adminId) });
      return;
    }

    // support /broadcast for admin as fallback
    if (text && text.startsWith("/broadcast")) {
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
    await sendMsg(token, chatId, "لطفاً از منوی دکمه‌ای استفاده کنید:", { reply_markup: mainMenuKeyboard(String(user) === adminId) });

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
  const adminId = String(env.ADMIN_ID || ADMIN_FALLBACK);
  return String(q) === adminId || String(header) === adminId;
}

const app = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // Root: admin panel (responsive, modern)
    if (path === "/" && method === "GET") {
      const adminQuery = url.searchParams.get('admin') || '';
      const html = `<!doctype html>
<html lang='fa' dir='rtl'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<title>پنل مدیریت ربات</title>
<style>
:root{--bg:#0a0e27;--card:#141b2d;--muted:#8b9bb5;--accent:#00d9ff;--btn:#00b8d4;--text:#e8f4f8;--border:#1e2940}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Tahoma,Arial;background:linear-gradient(135deg,#0a0e27 0%,#1a1f3a 100%);color:var(--text);padding:20px;min-height:100vh}
.container{max-width:1200px;margin:0 auto}
.header{text-align:center;margin-bottom:30px}
.brand{font-size:24px;font-weight:700;color:var(--accent);margin-bottom:10px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(450px,1fr));gap:20px}
.card{background:var(--card);border-radius:16px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,.4);border:1px solid var(--border)}
.card h3{color:var(--accent);margin-bottom:16px;font-size:18px}
input,textarea{background:#0a1120;border:1px solid var(--border);color:var(--text);padding:12px;border-radius:8px;width:100%;font-family:Tahoma;margin-bottom:10px;transition:border .3s}
input:focus,textarea:focus{outline:none;border-color:var(--accent)}
button{background:var(--btn);border:0;color:#fff;padding:12px 20px;border-radius:8px;cursor:pointer;font-weight:600;transition:transform .2s,background .3s;width:100%}
button:hover{background:#00a3b8;transform:translateY(-2px)}
button:active{transform:translateY(0)}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{padding:12px 8px;text-align:right;border-bottom:1px solid var(--border);font-size:13px}
th{color:var(--accent);font-weight:600}
.flag{font-size:20px;margin-left:8px}
.small{font-size:12px;color:var(--muted)}
.del{width:auto;padding:6px 12px;background:#dc3545;font-size:12px}
.del:hover{background:#c82333}
.controls{display:grid;grid-template-columns:1fr 1fr 100px;gap:8px;margin-bottom:10px}
.note{background:#1a2332;padding:12px;border-radius:8px;color:var(--muted);font-size:12px;margin-top:12px;border-right:3px solid var(--accent)}
@media(max-width:980px){.grid{grid-template-columns:1fr}.controls{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class='container'>
  <div class='header'>
    <div class='brand'>🤖 پنل مدیریت ربات DNS</div>
  </div>

  <div class='grid'>
    <div class='card'>
      <h3>📋 مدیریت DNS</h3>
      <div id='dns-list' class='small'>در حال بارگذاری...</div>
      <hr style='border:0;border-top:1px solid var(--border);margin:20px 0'/>
      <h3>➕ افزودن کشور جدید</h3>
      <form id='dns-form'>
        <div class='controls'>
          <input id='code' placeholder='کد کشور (EE)' required />
          <input id='country' placeholder='نام کشور (استونی)' required />
          <input id='stock' type='number' value='0' placeholder='موجودی' />
        </div>
        <textarea id='addresses' rows='4' placeholder='آدرس‌های IP (هر خط یک آدرس)'></textarea>
        <button type='submit'>💾 ذخیره</button>
      </form>
    </div>

    <div class='card'>
      <h3>👥 کاربران</h3>
      <div id='users' class='small'>در حال بارگذاری...</div>
      <hr style='border:0;border-top:1px solid var(--border);margin:20px 0'/>
      <h3>📢 پیام همگانی</h3>
      <textarea id='broadcast' rows='4' placeholder='متن پیام خود را وارد کنید...'></textarea>
      <button id='send-bc'>📤 ارسال</button>
    </div>
  </div>
</div>

<script>
console.log('WireGuard Bot Admin Panel Loaded');
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
      document.getElementById('dns-list').innerText = 'هیچ کشوری ثبت نشده';
      return;
    }
    const rows = list.map(r => {
      const flag = (r.flag) ? r.flag : '';
      const country = r.country || r.code;
      return '<tr><td>'+flag+' '+(r.code||'')+'</td><td>'+country+'</td><td>'+(r.stock||0)+'</td><td><button data-code="'+(r.code||'')+'" class="del">❌</button></td></tr>';
    }).join('');
    document.getElementById('dns-list').innerHTML = '<table><tr><th>کد</th><th>کشور</th><th>موجودی</th><th></th></tr>'+rows+'</table>';
    document.querySelectorAll('.del').forEach(b => b.onclick = async e => {
      const code = e.target.dataset.code;
      if (!confirm('حذف '+code+'?')) return;
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
    document.getElementById('users').innerHTML = '<div class="note">تعداد: '+ (j.users||[]).length +' کاربر</div>';
  } catch (e) {
    document.getElementById('users').innerText = 'خطا';
  }
}
document.getElementById('dns-form').onsubmit = async ev => {
  ev.preventDefault();
  const code = document.getElementById('code').value.trim().toUpperCase();
  const country = document.getElementById('country').value.trim();
  const stock = parseInt(document.getElementById('stock').value, 10) || 0;
  const addresses = document.getElementById('addresses').value.split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const body = { code, country, stock, addresses, flag: (code.length===2?String.fromCodePoint(...code.split('').map(c=>c.charCodeAt(0)+127397)): '') };
  await fetch('/api/dns/' + code, { method: 'PUT', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify(body) });
  document.getElementById('dns-form').reset();
  loadDNS();
};
document.getElementById('send-bc').onclick = async () => {
  const text = document.getElementById('broadcast').value.trim();
  if (!text) return alert('متن وارد کنید');
  await fetch('/api/broadcast', { method: 'POST', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify({ text }) });
  alert('✅ پیام ارسال شد');
  document.getElementById('broadcast').value = '';
};
if (ADMIN) { loadDNS(); loadUsers(); } else {
  document.getElementById('dns-list').innerHTML = '<div class="note">⚠️ برای دسترسی به پنل، ?admin=ADMIN_ID به URL اضافه کنید</div>';
  document.getElementById('users').innerHTML = '<div class="note">⚠️ برای دسترسی به پنل، ?admin=ADMIN_ID به URL اضافه کنید</div>';
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
        let successCount = 0;
        for (const u of us) {
          try {
            await sendMsg(env.BOT_TOKEN, u, text);
            successCount++;
          } catch (e) {
            console.error("broadcast err for user", u, e);
          }
        }
        return jsonResponse({ ok: true, sent: successCount, total: us.length });
      } catch (e) { 
        console.error("broadcast error:", e);
        return jsonResponse({ error: "invalid json" }, 400); 
      }
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

/* ---------------------- Export default app ---------------------- */
export default app;
