// main.js — Telegram WireGuard/DNS Bot + Responsive Web Panel --> index.html for Cloudflare Pages
// ---------------------------------------------------------------
// - KV binding name: DB
// - Required env vars: BOT_TOKEN, ADMIN_ID
//   per-user daily quotas (3 DNS / 3 WG), responsive admin panel, admin broadcast.
// ---------------------------------------------------------------

import { isVIPUser, getAllVIPUsersWithDetails, addVIPUser, removeVIPUser, getVIPUserData, updateVIPUsage, updateVIPExpiration, updateVIPNotes, getVIPStats, calculateVIPExpiry, buildVIPWireGuardConfig } from './vip.js';

/* ---------------------- Config ---------------------- */
const MAX_DNS_PER_DAY = 3;
const MAX_WG_PER_DAY = 3;
const VIP_DNS_PER_DAY = 10;
const VIP_WG_PER_DAY = 10;
const DATE_YYYYMMDD = () =>
  new Date().toISOString().slice(0, 10).replace(/-/g, "");

// Random MTU selection list
const WG_MTUS = [1280, 1320, 1360, 1380, 1400, 1420, 1440, 1480, 1500];

// User-selectable DNS options
const WG_FIXED_DNS = [
  "1.1.1.1",
  "1.0.0.1",
  "8.8.8.8",
  "8.8.4.4",
  "9.9.9.9",
  "10.202.10.10",
  "78.157.42.100",
  "208.67.222.222",
  "208.67.220.220",
  "185.55.226.26",
  "185.55.225.25",
  "185.51.200.2",
];

// Import country data
import COUNTRY_DATA_RAW from './countries.json' assert { type: 'json' };
const COUNTRY_DATA = COUNTRY_DATA_RAW || {};

// Helper functions to get country names
const COUNTRY_NAMES_FA = new Proxy({}, {
  get: (target, code) => COUNTRY_DATA[code]?.fa || code
});

const COUNTRY_NAMES_EN = new Proxy({}, {
  get: (target, code) => COUNTRY_DATA[code]?.en || code
});

// User-selectable operators with their address ranges
const OPERATORS = {
  irancell: { title: "ایرانسل", addresses: ["2.144.0.0/16"] },
  mci: { title: "همراه اول", addresses: ["5.52.0.0/16"] },
  tci: { title: "مخابرات", addresses: ["2.176.0.0/15", "2.190.0.0/15"] },
  rightel: { title: "رایتل", addresses: ["37.137.128.0/17", "95.162.0.0/17"] },
  shatel: {
    title: "شاتل موبایل",
    addresses: ["94.182.0.0/16", "37.148.0.0/18"],
  },
};

/* ---------------------- Utility Helpers ---------------------- */
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function tg(token, method, body, isForm = false) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: isForm ? {} : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  try {
    return await res.json();
  } catch {
    return { ok: false };
  }
}

function sendMsg(token, chat_id, text, extra = {}) {
  return tg(token, "sendMessage", {
    chat_id,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

function editMsg(token, chat_id, message_id, text, extra = {}) {
  return tg(token, "editMessageText", {
    chat_id,
    message_id,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

function deleteMsg(token, chat_id, message_id) {
  return tg(token, "deleteMessage", {
    chat_id,
    message_id,
  });
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
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(c.charCodeAt(0) + 127397));
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
    } catch (e) {
      /* skip */
    }
  }
  return out;
}

async function updateDNS(env, code, obj) {
  await env.DB.put(`dns:${code.toUpperCase()}`, JSON.stringify(obj));
}

async function deleteDNS(env, code) {
  await env.DB.delete(`dns:${code.toUpperCase()}`);
}

/* ---------------------- VIP DNS KV Helpers ---------------------- */
async function getVIPDNS(env, code) {
  if (!code) return null;
  const raw = await env.DB.get(`vipdns:${code.toUpperCase()}`);
  return raw ? JSON.parse(raw) : null;
}

async function listVIPDNS(env) {
  const res = await env.DB.list({ prefix: "vipdns:", limit: 1000 });
  const out = [];
  for (const k of res.keys || []) {
    try {
      const raw = await env.DB.get(k.name);
      if (raw) out.push(JSON.parse(raw));
    } catch (e) {
      /* skip */
    }
  }
  return out;
}

async function updateVIPDNS(env, code, obj) {
  await env.DB.put(`vipdns:${code.toUpperCase()}`, JSON.stringify(obj));
}

async function deleteVIPDNS(env, code) {
  await env.DB.delete(`vipdns:${code.toUpperCase()}`);
}

async function allocateVIPAddress(env, code) {
  const rec = await getVIPDNS(env, code);
  if (!rec || !Array.isArray(rec.addresses) || rec.addresses.length === 0)
    return null;
  const addr = rec.addresses.shift();
  rec.stock = rec.addresses.length;
  if (rec.stock < 0) rec.stock = 0;
  await updateVIPDNS(env, code, rec);
  return addr;
}

/* ---------------------- VIP IPv6 KV Helpers ---------------------- */
async function getVIPDNS6(env, code) {
  if (!code) return null;
  const raw = await env.DB.get(`vipdns6:${code.toUpperCase()}`);
  return raw ? JSON.parse(raw) : null;
}

async function listVIPDNS6(env) {
  const res = await env.DB.list({ prefix: "vipdns6:", limit: 1000 });
  const out = [];
  for (const k of res.keys || []) {
    try {
      const raw = await env.DB.get(k.name);
      if (raw) out.push(JSON.parse(raw));
    } catch (e) {
      /* skip */
    }
  }
  return out;
}

async function updateVIPDNS6(env, code, obj) {
  await env.DB.put(`vipdns6:${code.toUpperCase()}`, JSON.stringify(obj));
}

async function deleteVIPDNS6(env, code) {
  await env.DB.delete(`vipdns6:${code.toUpperCase()}`);
}

async function allocateVIPAddress6(env, code) {
  const rec = await getVIPDNS6(env, code);
  if (!rec || !Array.isArray(rec.addresses) || rec.addresses.length < 2)
    return null;
  const addr1 = rec.addresses.shift();
  const addr2 = rec.addresses.shift();
  rec.stock = rec.addresses.length;
  if (rec.stock < 0) rec.stock = 0;
  await updateVIPDNS6(env, code, rec);
  return [addr1, addr2];
}

/**
 * Remove one address from dns:{code}.addresses and return it.
 * Decrements stock accordingly. Returns null if none available.
 */
async function allocateAddress(env, code) {
  const rec = await getDNS(env, code);
  if (!rec || !Array.isArray(rec.addresses) || rec.addresses.length === 0)
    return null;
  const addr = rec.addresses.shift();
  rec.stock = rec.addresses.length;
  if (rec.stock < 0) rec.stock = 0;
  await updateDNS(env, code, rec);
  return addr;
}

/* ---------------------- IPv6 KV Helpers ---------------------- */
async function getDNS6(env, code) {
  if (!code) return null;
  const raw = await env.DB.get(`dns6:${code.toUpperCase()}`);
  return raw ? JSON.parse(raw) : null;
}

async function listDNS6(env) {
  const res = await env.DB.list({ prefix: "dns6:", limit: 1000 });
  const out = [];
  for (const k of res.keys || []) {
    try {
      const raw = await env.DB.get(k.name);
      if (raw) out.push(JSON.parse(raw));
    } catch (e) {
      /* skip */
    }
  }
  return out;
}

async function updateDNS6(env, code, obj) {
  await env.DB.put(`dns6:${code.toUpperCase()}`, JSON.stringify(obj));
}

async function deleteDNS6(env, code) {
  await env.DB.delete(`dns6:${code.toUpperCase()}`);
}

/**
 * For IPv6, allocate TWO addresses at once
 */
async function allocateAddress6(env, code) {
  const rec = await getDNS6(env, code);
  if (!rec || !Array.isArray(rec.addresses) || rec.addresses.length < 2)
    return null;
  const addr1 = rec.addresses.shift();
  const addr2 = rec.addresses.shift();
  rec.stock = rec.addresses.length;
  if (rec.stock < 0) rec.stock = 0;
  await updateDNS6(env, code, rec);
  return [addr1, addr2];
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
  const isVIP = await isVIPUser(env, id);
  const isPro = await isProUser(env, id);
  const d = DATE_YYYYMMDD();
  const dns = parseInt(await env.DB.get(`q:dns:${id}:${d}`)) || 0;
  const wg = parseInt(await env.DB.get(`q:wg:${id}:${d}`)) || 0;

  // VIP and Pro users get 10 limit, regular users get 3 limit
  const dnsLimit = (isVIP || isPro) ? 10 : 3;
  const wgLimit = (isVIP || isPro) ? 10 : 3;

  return {
    dnsUsed: dns,
    wgUsed: wg,
    dnsLeft: Math.max(0, dnsLimit - dns),
    wgLeft: Math.max(0, wgLimit - wg),
    isVIP: isVIP,
    isPro: isPro,
    dailyLimit: (isVIP || isPro) ? 10 : 3
  };
}

/* ---------------------- Pro Key System ---------------------- */
async function isProUser(env, userId) {
  const raw = await env.DB.get(`pro:user:${userId}`);
  if (!raw) return false;

  try {
    const userData = JSON.parse(raw);
    if (!userData.expiresAt) return true;

    const expiryDate = new Date(userData.expiresAt);
    const now = new Date();
    return expiryDate > now;
  } catch (e) {
    return false;
  }
}

async function addProUser(env, userId, days) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + parseInt(days));
  expiryDate.setHours(23, 59, 59, 999);

  const userData = {
    addedAt: new Date().toISOString(),
    expiresAt: expiryDate.toISOString(),
    durationDays: parseInt(days)
  };

  await env.DB.put(`pro:user:${userId}`, JSON.stringify(userData));
  return true;
}

async function getAllProKeys(env) {
  const res = await env.DB.list({ prefix: 'prokey:', limit: 1000 });
  const keys = [];
  for (const k of res.keys || []) {
    try {
      const raw = await env.DB.get(k.name);
      if (raw) {
        const data = JSON.parse(raw);
        keys.push({ key: k.name.replace('prokey:', ''), ...data });
      }
    } catch (e) { }
  }
  return keys;
}

async function createProKey(env, days, count = 1) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const keyCode = randBase64(16).replace(/[^a-zA-Z0-9]/g, '').substring(0, 12).toUpperCase();
    const keyData = {
      days: parseInt(days),
      used: false,
      createdAt: new Date().toISOString()
    };
    await env.DB.put(`prokey:${keyCode}`, JSON.stringify(keyData));
    keys.push(keyCode);
  }
  return keys;
}

async function useProKey(env, userId, keyCode) {
  const raw = await env.DB.get(`prokey:${keyCode.toUpperCase()}`);
  if (!raw) return { success: false, error: 'کد پرو نامعتبر است' };

  try {
    const keyData = JSON.parse(raw);
    if (keyData.used) {
      return { success: false, error: 'این کد قبلاً استفاده شده است' };
    }

    keyData.used = true;
    keyData.usedBy = userId;
    keyData.usedAt = new Date().toISOString();
    await env.DB.put(`prokey:${keyCode.toUpperCase()}`, JSON.stringify(keyData));

    await addProUser(env, userId, keyData.days);

    return { success: true, days: keyData.days };
  } catch (e) {
    return { success: false, error: 'خطا در پردازش کد' };
  }
}

async function deleteProKey(env, keyCode) {
  await env.DB.delete(`prokey:${keyCode.toUpperCase()}`);
  return true;
}

async function incQuota(env, id, type) {
  const d = DATE_YYYYMMDD();
  const key = `q:${type}:${id}:${d}`;
  const v = parseInt(await env.DB.get(key)) || 0;
  await env.DB.put(key, String(v + 1));
}

async function resetAllQuotas(env) {
  const d = DATE_YYYYMMDD();
  const users = await allUsers(env);
  let count = 0;

  for (const userId of users) {
    try {
      await env.DB.delete(`q:dns:${userId}:${d}`);
      await env.DB.delete(`q:wg:${userId}:${d}`);
      count++;
    } catch (e) {
      console.error(`Error resetting quota for user ${userId}:`, e);
    }
  }

  return count;
}

/* ---------------------- UI Elements (inline keyboards) ---------------------- */
function stockEmoji(n) {
  if (!n || n <= 0) return "🔴";
  if (n <= 10) return "🟡";
  return "🟢";
}

function mainMenuKeyboard(isAdmin = false, isVIP = false) {
  const rows = [
    [
      { text: "🛡️ WireGuard", callback_data: "menu_wg" },
      { text: "🌐 DNS", callback_data: "menu_dns_proto" },
    ],
    [{ text: "👤 حساب من", callback_data: "menu_account" }],
  ];
  if (isVIP) {
    rows.push([{ text: "👑 بخش VIP", callback_data: "menu_vip" }]);
  }
  if (isAdmin) {
    rows.push([
      { text: "📢 پیام همگانی", callback_data: "menu_broadcast" },
      { text: "📊 آمار ربات", callback_data: "menu_stats" },
    ]);
    rows.push([{ text: "🎁 ریست محدودیت", callback_data: "menu_reset_quota" }]);
  }
  return { inline_keyboard: rows };
}

function accountMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📊 سهمیه امروز", callback_data: "account_quota" },
        { text: "📜 تاریخچه", callback_data: "account_history" },
      ],
      [
        { text: "🌐 آدرس‌های DNS من", callback_data: "account_dns" },
        { text: "🛡️ کانفیگ‌های WG", callback_data: "account_wg" },
      ],
      [{ text: "🔙 بازگشت به منو", callback_data: "back" }],
    ],
  };
}

function accountBackKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔙 بازگشت به حساب", callback_data: "menu_account" }],
      [{ text: "🏠 منوی اصلی", callback_data: "back" }],
    ],
  };
}

function vipMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🛡️ WireGuard VIP", callback_data: "vip_wg" },
        { text: "🌐 DNS VIP", callback_data: "vip_dns" },
      ],
      [
        { text: "📊 آمار VIP من", callback_data: "vip_stats" },
        { text: "⏰ اعتبار اشتراک", callback_data: "vip_expiry" },
      ],
      [
        { text: "🎁 مزایای VIP", callback_data: "vip_benefits" },
      ],
      [{ text: "🔙 بازگشت به منو", callback_data: "back" }],
    ],
  };
}

function vipBackKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔙 بازگشت به منوی VIP", callback_data: "menu_vip" }],
      [{ text: "🏠 منوی اصلی", callback_data: "back" }],
    ],
  };
}

function protocolSelectionKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "IPv6 🌐", callback_data: "proto:ipv6" },
        { text: "IPv4 🌐", callback_data: "proto:ipv4" },
      ],
      [{ text: "🔙 بازگشت به منو", callback_data: "back" }],
    ],
  };
}

function countriesKeyboard(list, page = 0, mode = "select") {
  const ITEMS_PER_PAGE = 14;
  const start = page * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const pageItems = list.slice(start, end);

  const rows = [];
  for (const r of pageItems) {
    const code = (r.code || "").toUpperCase();
    const countryNameFa = COUNTRY_NAMES_FA[code] || r.country || code;
    const flag = r.flag || flagFromCode(code);
    const stockCount = r.stock ?? 0;
    const emoji = stockEmoji(stockCount);

    let callbackData;
    if (mode === "dns4") callbackData = `dns4:${code}`;
    else if (mode === "dns6") callbackData = `dns6:${code}`;
    else if (mode === "wg") callbackData = `wg:${code}`;
    else if (mode === "vipdns4") callbackData = `vipdns4:${code}`;
    else if (mode === "vipdns6") callbackData = `vipdns6:${code}`;
    else if (mode === "vipwg") callbackData = `vipwg:${code}`;
    else callbackData = `ct:${code}`;

    rows.push([
      { text: emoji, callback_data: `noop:${code}` },
      { text: String(stockCount), callback_data: `noop:${code}` },
      { text: `${flag} ${countryNameFa}`, callback_data: callbackData },
    ]);
  }

  const totalPages = Math.ceil(list.length / ITEMS_PER_PAGE);
  const navButtons = [];
  if (page > 0) {
    navButtons.push({
      text: "◀️ قبلی",
      callback_data: `page:${mode}:${page - 1}`,
    });
  }
  if (end < list.length) {
    navButtons.push({
      text: "بعدی ▶️",
      callback_data: `page:${mode}:${page + 1}`,
    });
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
      [
        { text: "🌐 دریافت DNS", callback_data: `dns4:${code}` },
        { text: "🛡️ WireGuard", callback_data: `wg:${code}` },
      ],
      [{ text: "🔙 بازگشت", callback_data: "back" }],
    ],
  };
}

function operatorKeyboard(code) {
  const rows = [
    [
      { text: OPERATORS.irancell.title, callback_data: `op:${code}:irancell` },
      { text: OPERATORS.mci.title, callback_data: `op:${code}:mci` },
    ],
    [
      { text: OPERATORS.tci.title, callback_data: `op:${code}:tci` },
      { text: OPERATORS.rightel.title, callback_data: `op:${code}:rightel` },
    ],
    [{ text: OPERATORS.shatel.title, callback_data: `op:${code}:shatel` }],
    [{ text: "🔙 بازگشت", callback_data: "back" }],
  ];
  return { inline_keyboard: rows };
}

function dnsChoiceKeyboard(code, op) {
  const rows = [];
  for (let i = 0; i < WG_FIXED_DNS.length; i += 2) {
    const row = [
      {
        text: WG_FIXED_DNS[i],
        callback_data: `choose:${code}:${op}:${WG_FIXED_DNS[i]}`,
      },
    ];
    if (i + 1 < WG_FIXED_DNS.length) {
      row.push({
        text: WG_FIXED_DNS[i + 1],
        callback_data: `choose:${code}:${op}:${WG_FIXED_DNS[i + 1]}`,
      });
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

function buildInterfaceOnlyConfig({
  privateKey,
  address = "10.66.66.2/32",
  mtu = 1420,
  dns = "1.1.1.1",
  operatorAddress = null,
}) {
  const finalAddress = operatorAddress || address;
  return [
    "[Interface]",
    `PrivateKey = ${privateKey}`,
    `Address = ${finalAddress}`,
    `DNS = ${dns}`,
    `MTU = ${mtu}`,
    "",
  ].join("\n");
}

/* ---------------------- Telegram webhook handler ---------------------- */
export async function handleUpdate(update, env, { waitUntil } = {}) {
  const token = env.BOT_TOKEN;
  if (!token) {
    console.error("CRITICAL: BOT_TOKEN environment variable is not set");
    throw new Error("BOT_TOKEN is required but not configured");
  }
  // require ADMIN_ID from environment
  const adminId = env.ADMIN_ID ? String(env.ADMIN_ID) : null;
  if (!adminId) {
    console.error("CRITICAL: ADMIN_ID environment variable is not set");
    throw new Error("ADMIN_ID is required but not configured");
  }
  try {
    if (!update) return;

    // allow both message and callback_query
    const message = update.message || update.edited_message;
    const callback = update.callback_query;
    const user =
      (message && message.from && message.from.id) ||
      (callback && callback.from && callback.from.id);
    const chatId =
      (message && message.chat && message.chat.id) ||
      (callback &&
        callback.message &&
        callback.message.chat &&
        callback.message.chat.id);
    if (!chatId) return;

    // فقط به پیام‌های خصوصی پاسخ بده (نه گروه/کانال)
    const chatType =
      (message && message.chat && message.chat.type) ||
      (callback && callback.message && callback.message.chat && callback.message.chat.type);
    if (chatType && chatType !== 'private') {
      return; // در گروه یا کانال پاسخ نده
    }

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
            sendMsg(token, u, txt).catch(() => { });
          }
          await env.DB.delete(`awaitBroadcast:${adminId}`);
          const adminVIP = await isVIPUser(env, user);
          await sendMsg(
            token,
            chatId,
            `✅ پیام برای ${list.length} کاربر ارسال شد.`,
            { reply_markup: mainMenuKeyboard(true, adminVIP) },
          );
          return;
        }
      }
    }

    // handle callback_query first (button-based UX)
    if (callback) {
      const data = callback.data || "";
      // answer callback to remove loading spinner
      tg(token, "answerCallbackQuery", {
        callback_query_id: callback.id,
      }).catch(() => { });

      // navigation
      if (data === "back") {
        // ادیت پیام قبلی به جای ارسال پیام جدید
        const userIsVIP = await isVIPUser(env, user);
        await editMsg(token, chatId, callback.message.message_id, "منوی اصلی:", {
          reply_markup: mainMenuKeyboard(String(user) === adminId, userIsVIP),
        });
        return;
      }

      // VIP Menu Handler
      if (data === "menu_vip") {
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) {
          await editMsg(token, chatId, callback.message.message_id,
            "⛔️ شما به بخش VIP دسترسی ندارید.\n\n💎 <b>خرید اشتراک VIP</b>\n\n✨ مزایای VIP:\n• سهمیه روزانه 10 عددی (DNS و WireGuard)\n• دسترسی به سرورهای اختصاصی VIP\n• کیفیت و سرعت بالاتر\n• پشتیبانی ویژه\n\n📩 برای دریافت اطلاعات و خرید با ادمین در ارتباط باشید:\n@Minimalcraft", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "📩 ارتباط با ادمین", url: "https://t.me/Minimalcraft" }],
                [{ text: "🔙 بازگشت به منو", callback_data: "back" }]
              ]
            }
          });
          return;
        }

        const vipData = await getVIPUserData(env, user);
        let expiryText = "♾️ دائمی";
        if (vipData && vipData.expiresAt) {
          const expiryDate = new Date(vipData.expiresAt);
          const now = new Date();
          const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
          expiryText = daysLeft > 0 ? `${daysLeft} روز باقی‌مانده` : "منقضی شده";
        }

        await editMsg(token, chatId, callback.message.message_id,
          `👑 <b>پنل VIP</b>\n\n🌟 به بخش ویژه خوش آمدید!\n\n⏰ اعتبار: ${expiryText}\n\n💎 سهمیه روزانه: <b>10 DNS</b> + <b>10 WireGuard</b>\n🚀 دسترسی به سرورهای اختصاصی VIP\n⚡️ کیفیت و سرعت بالاتر\n\nیک گزینه را انتخاب کنید:`, {
          reply_markup: vipMenuKeyboard(),
        });
        return;
      }

      // VIP WireGuard - Direct access to VIP WG countries
      if (data === "vip_wg") {
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        const list = await listVIPDNS(env);
        if (!list || list.length === 0) {
          await editMsg(token, chatId, callback.message.message_id, "فعلاً سرور VIP موجود نیست.", {
            reply_markup: vipBackKeyboard()
          });
          return;
        }
        const mapped = list
          .map((r) => ({
            code: (r.code || "").toUpperCase(),
            country: r.country || r.code,
            stock: r.stock || 0,
          }))
          .sort((a, b) => b.stock - a.stock);

        const q = await getQuota(env, user);
        await editMsg(token, chatId, callback.message.message_id,
          `👑 <b>WireGuard VIP</b>\n\n🚀 سرورهای اختصاصی VIP با کیفیت بالا\n\n🛡️ کشور مورد نظر را انتخاب کنید:\n(سهمیه امروز: ${q.wgLeft}/${VIP_WG_PER_DAY})\n\n🟢 موجود | 🟡 کم | 🔴 تمام`, {
          reply_markup: countriesKeyboard(mapped, 0, "vipwg"),
        });
        return;
      }

      // VIP DNS - Direct access with protocol selection
      if (data === "vip_dns") {
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        const q = await getQuota(env, user);
        await editMsg(token, chatId, callback.message.message_id,
          `👑 <b>DNS VIP</b>\n\n🚀 آدرس‌های اختصاصی VIP با کیفیت برتر\n\n🌐 نوع پروتکل را انتخاب کنید:\n(سهمیه امروز: ${q.dnsLeft}/${VIP_DNS_PER_DAY})`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "IPv6 🌐", callback_data: "vipdns:ipv6" },
                { text: "IPv4 🌐", callback_data: "vipdns:ipv4" },
              ],
              [{ text: "🔙 بازگشت به منوی VIP", callback_data: "menu_vip" }],
            ],
          },
        });
        return;
      }

      // VIP Stats - Show usage statistics
      if (data === "vip_stats") {
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        const vipData = await getVIPUserData(env, user);
        const totalDns = vipData?.totalDnsUsed || 0;
        const totalWg = vipData?.totalWgUsed || 0;
        const lastActivity = vipData?.lastActivity ? new Date(vipData.lastActivity).toLocaleDateString('fa-IR') : 'نامشخص';
        const memberSince = vipData?.addedAt ? new Date(vipData.addedAt).toLocaleDateString('fa-IR') : 'نامشخص';

        await editMsg(token, chatId, callback.message.message_id,
          `👑 <b>آمار VIP شما</b>\n\n━━━━━━━━━━━━━━━━━━━━\n📊 <b>مصرف کل</b>\n🌐 DNS دریافت شده: <b>${totalDns}</b>\n🛡️ WireGuard دریافت شده: <b>${totalWg}</b>\n\n━━━━━━━━━━━━━━━━━━━━\n📅 <b>تاریخچه</b>\n🗓 عضویت VIP از: <b>${memberSince}</b>\n⏰ آخرین فعالیت: <b>${lastActivity}</b>\n━━━━━━━━━━━━━━━━━━━━`, {
          reply_markup: vipBackKeyboard(),
        });
        return;
      }

      // VIP Expiry - Show subscription expiry
      if (data === "vip_expiry") {
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        const vipData = await getVIPUserData(env, user);
        let expiryInfo = "";

        if (!vipData || !vipData.expiresAt) {
          expiryInfo = "♾️ <b>اشتراک دائمی</b>\n\n🎉 شما دارای اشتراک VIP دائمی هستید!\nنیازی به تمدید نیست.";
        } else {
          const expiryDate = new Date(vipData.expiresAt);
          const now = new Date();
          const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
          const expiryDateStr = expiryDate.toLocaleDateString('fa-IR');

          if (daysLeft > 0) {
            let statusEmoji = "🟢";
            if (daysLeft <= 7) statusEmoji = "🟡";
            if (daysLeft <= 3) statusEmoji = "🔴";

            expiryInfo = `${statusEmoji} <b>اشتراک فعال</b>\n\n📅 تاریخ انقضا: <b>${expiryDateStr}</b>\n⏳ روزهای باقی‌مانده: <b>${daysLeft} روز</b>`;

            if (daysLeft <= 7) {
              expiryInfo += "\n\n⚠️ اشتراک شما به زودی منقضی می‌شود!\nبرای تمدید با ادمین تماس بگیرید.";
            }
          } else {
            expiryInfo = "🔴 <b>اشتراک منقضی شده</b>\n\n❌ اشتراک VIP شما منقضی شده است.\nبرای تمدید با ادمین تماس بگیرید.";
          }
        }

        await editMsg(token, chatId, callback.message.message_id,
          `👑 <b>وضعیت اشتراک VIP</b>\n\n━━━━━━━━━━━━━━━━━━━━\n${expiryInfo}\n━━━━━━━━━━━━━━━━━━━━`, {
          reply_markup: vipBackKeyboard(),
        });
        return;
      }

      // VIP Benefits - Show VIP benefits
      if (data === "vip_benefits") {
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        await editMsg(token, chatId, callback.message.message_id,
          `🎁 <b>امکانات ویژه تو</b>\n\n━━━━━━━━━━━━━━━━━━━━\n✨ <b>ببین چی داری:</b>\n\n📈 هر روز <b>۱۰ تا</b> دی‌ان‌اس میتونی بگیری\n📈 هر روز <b>۱۰ تا</b> وایرگارد هم همینطور\n🌟 سرورهای <b>اختصاصی</b> فقط واسه تو\n⚡️ سرعت و کیفیت <b>فوق‌العاده</b>\n🚀 پشتیبانی <b>سریع و اختصاصی</b>\n🔔 سرورهای جدید <b>زودتر از همه</b>\n🎁 تخفیف ویژه برای <b>تمدید</b>\n📊 مشاهده <b>آمار کاملت</b>\n\n━━━━━━━━━━━━━━━━━━━━\n💡 <b>یادت باشه:</b> سرورهای ویژه خیلی بهتر از معمولی‌ها هستن!\n\n━━━━━━━━━━━━━━━━━━━━\n💚 ممنون که باهامی عزیزم!`, {
          reply_markup: vipBackKeyboard(),
        });
        return;
      }

      // Pagination handler
      if (data.startsWith("page:")) {
        const parts = data.split(":");
        const mode = parts[1] || "select";
        const page = parseInt(parts[2]) || 0;

        const list = mode === "dns6" ? await listDNS6(env) : await listDNS(env);
        if (!list || list.length === 0) {
          await sendMsg(token, chatId, "فعلاً رکوردی موجود نیست.");
          return;
        }
        const mapped = list
          .map((r) => ({
            code: (r.code || "").toUpperCase(),
            country: r.country || r.code,
            stock: r.stock || 0,
          }))
          .sort((a, b) => b.stock - a.stock);

        const totalPages = Math.ceil(mapped.length / 14);
        let title = "📡 لیست کشورها";
        if (mode === "dns4") title = "🌐 دریافت DNS IPv4";
        else if (mode === "dns6") title = "🌐 دریافت DNS IPv6";
        else if (mode === "wg") title = "🛡️ دریافت WireGuard";

        await tg(token, "editMessageText", {
          chat_id: chatId,
          message_id: callback.message.message_id,
          text: `${title} (صفحه ${page + 1} از ${totalPages}):\n\n🟢 موجود | 🟡 کم | 🔴 تمام`,
          reply_markup: countriesKeyboard(mapped, page, mode),
        });
        return;
      }

      // Handle noop callbacks (for non-clickable buttons like stock indicator)
      if (data.startsWith("noop:")) {
        return;
      }

      if (data === "menu_dns_proto") {
        // ادیت پیام به جای ارسال جدید
        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          "🌐 DNS - پروتکل مورد نظر را انتخاب کنید:",
          {
            reply_markup: protocolSelectionKeyboard(),
          },
        );
        return;
      }

      if (data.startsWith("proto:")) {
        const protocol = data.slice(6);
        if (protocol === "ipv4") {
          const list = await listDNS(env);
          if (!list || list.length === 0) {
            await editMsg(token, chatId, callback.message.message_id, "فعلاً رکوردی موجود نیست.", {
              reply_markup: { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "back" }]] }
            });
            return;
          }
          const mapped = list
            .map((r) => {
              const code = (r.code || "").toUpperCase();
              return {
                code: code,
                country: r.country || r.code,
                stock: r.stock || 0,
                flag: r.flag || flagFromCode(code)
              };
            })
            .sort((a, b) => b.stock - a.stock);

          // ادیت پیام به جای ارسال جدید
          await editMsg(
            token,
            chatId,
            callback.message.message_id,
            "🌐 دریافت DNS IPv4 - کشور مورد نظر را انتخاب کنید:\n\n🟢 موجود | 🟡 کم | 🔴 تمام",
            {
              reply_markup: countriesKeyboard(mapped, 0, "dns4"),
            },
          );
        } else if (protocol === "ipv6") {
          const list = await listDNS6(env);
          if (!list || list.length === 0) {
            await editMsg(token, chatId, callback.message.message_id, "فعلاً رکوردی IPv6 موجود نیست.", {
              reply_markup: { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "back" }]] }
            });
            return;
          }
          const mapped = list
            .map((r) => {
              const code = (r.code || "").toUpperCase();
              return {
                code: code,
                country: r.country || r.code,
                stock: r.stock || 0,
                flag: r.flag || flagFromCode(code)
              };
            })
            .sort((a, b) => b.stock - a.stock);

          // ادیت پیام به جای ارسال جدید
          await editMsg(
            token,
            chatId,
            callback.message.message_id,
            "🌐 دریافت DNS IPv6 - کشور مورد نظر را انتخاب کنید:\n\n🟢 موجود | 🟡 کم | 🔴 تمام",
            {
              reply_markup: countriesKeyboard(mapped, 0, "dns6"),
            },
          );
        }
        return;
      }

      if (data === "menu_wg") {
        const list = await listDNS(env);
        if (!list || list.length === 0) {
          await editMsg(token, chatId, callback.message.message_id, "فعلاً رکوردی موجود نیست.", {
            reply_markup: { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "back" }]] }
          });
          return;
        }
        const mapped = list
          .map((r) => ({
            code: (r.code || "").toUpperCase(),
            country: r.country || r.code,
            stock: r.stock || 0,
          }))
          .sort((a, b) => b.stock - a.stock);

        // ادیت پیام به جای ارسال جدید
        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          "🛡️ دریافت WireGuard - کشور مورد نظر را انتخاب کنید:\n\n🟢 موجود | 🟡 کم | 🔴 تمام",
          {
            reply_markup: countriesKeyboard(mapped, 0, "wg"),
          },
        );
        return;
      }

      if (data === "menu_account") {
        if (!user) {
          await editMsg(token, chatId, callback.message.message_id, "مشخصات کاربری پیدا نشد.", {
            reply_markup: { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: "back" }]] }
          });
          return;
        }
        const q = await getQuota(env, user);
        const rawHist = await env.DB.get(`history:${user}`);
        const hist = rawHist ? JSON.parse(rawHist) : [];

        const dnsCount = hist.filter(h => h.type === "dns-ipv4" || h.type === "dns-ipv6").length;
        const wgCount = hist.filter(h => h.type === "wg").length;

        const vipBadge = q.isVIP ? '\n\n👑 <b>کاربر VIP</b> - سهمیه روزانه 10 DNS و 10 WireGuard' : '';
        const proBadge = q.isPro && !q.isVIP ? '\n\n⭐️ <b>کاربر پرو</b> - سهمیه روزانه 10 DNS و 10 WireGuard' : '';

        const dailyQuota = (q.isVIP || q.isPro) ? 10 : MAX_DNS_PER_DAY;

        const text = `👤 <b>حساب کاربری شما</b>${vipBadge}${proBadge}

━━━━━━━━━━━━━━━━━━━━

📊 <b>سهمیه امروز:</b>
┌ 🌐 DNS: <b>${q.dnsLeft} از ${dailyQuota}</b>
└ 🛡️ WireGuard: <b>${q.wgLeft} از ${dailyQuota}</b>

📁 <b>آمار کلی:</b>
┌ 🌐 آدرس‌های دریافتی: <b>${dnsCount}</b>
└ 🛡️ کانفیگ‌های ساخته شده: <b>${wgCount}</b>

━━━━━━━━━━━━━━━━━━━━

💡 از دکمه‌های زیر برای مشاهده جزئیات استفاده کنید:`;

        await editMsg(token, chatId, callback.message.message_id, text, {
          reply_markup: accountMenuKeyboard(),
        });
        return;
      }

      if (data === "account_quota") {
        if (!user) return;
        const q = await getQuota(env, user);

        const maxQuota = (q.isVIP || q.isPro) ? 10 : MAX_DNS_PER_DAY;
        const dnsBar = "█".repeat(q.dnsLeft) + "░".repeat(maxQuota - q.dnsLeft);
        const wgBar = "█".repeat(q.wgLeft) + "░".repeat(maxQuota - q.wgLeft);

        const statusBadge = q.isVIP ? '👑 VIP' : (q.isPro ? '⭐️ پرو' : '👤 عادی');

        const text = `📊 <b>سهمیه امروز شما</b>
${statusBadge}

━━━━━━━━━━━━━━━━━━━━

🌐 <b>DNS</b>
${dnsBar}
باقی‌مانده: <b>${q.dnsLeft}</b> از ${maxQuota}
مصرف شده: <b>${q.dnsUsed}</b>

🛡️ <b>WireGuard</b>
${wgBar}
باقی‌مانده: <b>${q.wgLeft}</b> از ${maxQuota}
مصرف شده: <b>${q.wgUsed}</b>

━━━━━━━━━━━━━━━━━━━━

⏰ سهمیه شما هر ۲۴ ساعت ریست می‌شود.`;

        await editMsg(token, chatId, callback.message.message_id, text, {
          reply_markup: accountBackKeyboard(),
        });
        return;
      }

      if (data === "account_history") {
        if (!user) return;
        const rawHist = await env.DB.get(`history:${user}`);
        const hist = rawHist ? JSON.parse(rawHist) : [];

        let text = `📜 <b>تاریخچه درخواست‌ها</b>

━━━━━━━━━━━━━━━━━━━━
`;

        if (!hist.length) {
          text += "\n📭 هنوز هیچ درخواستی ثبت نشده است.";
        } else {
          const recentHist = hist.slice(0, 10);
          recentHist.forEach((h, idx) => {
            const dateTime = h.at.slice(0, 19).replace("T", " ");
            const date = dateTime.slice(0, 10);
            const time = dateTime.slice(11, 16);
            const flag = h.country ? flagFromCode(h.country) : "🌍";
            const countryName = COUNTRY_NAMES_FA[h.country] || h.country || "نامشخص";

            let typeIcon = "📦";
            let typeName = h.type;
            if (h.type === "dns-ipv4") {
              typeIcon = "🌐";
              typeName = "IPv4";
            } else if (h.type === "dns-ipv6") {
              typeIcon = "🌐";
              typeName = "IPv6";
            } else if (h.type === "wg") {
              typeIcon = "🛡️";
              typeName = "WG";
            }

            text += `\n<b>${idx + 1}.</b> ${flag} ${countryName} • ${typeIcon} ${typeName}`;
            text += `\n    📅 ${date} • ⏰ ${time}`;
          });

          text += "\n\n━━━━━━━━━━━━━━━━━━━━";

          if (hist.length > 10) {
            text += `\n\n📋 مجموع: ${hist.length} درخواست`;
          }
        }

        await editMsg(token, chatId, callback.message.message_id, text, {
          reply_markup: accountBackKeyboard(),
        });
        return;
      }

      if (data === "account_dns") {
        if (!user) return;
        const rawHist = await env.DB.get(`history:${user}`);
        const hist = rawHist ? JSON.parse(rawHist) : [];
        const dnsHist = hist.filter(h => h.type === "dns-ipv4" || h.type === "dns-ipv6");

        let text = `🌐 <b>آدرس‌های DNS دریافتی شما</b>

━━━━━━━━━━━━━━━━━━━━
`;

        if (!dnsHist.length) {
          text += "\n📭 هنوز آدرس DNS دریافت نکرده‌اید.\n\nاز منوی اصلی گزینه DNS را انتخاب کنید.";
        } else {
          const recentDns = dnsHist.slice(0, 8);
          recentDns.forEach((h, idx) => {
            const flag = h.country ? flagFromCode(h.country) : "🌍";
            const countryName = COUNTRY_NAMES_FA[h.country] || h.country || "نامشخص";
            const ipType = h.type === "dns-ipv6" ? "IPv6" : "IPv4";
            const date = h.at.slice(0, 10);

            text += `\n<b>${idx + 1}. ${flag} ${countryName}</b> (${ipType})`;
            text += `\n   📅 ${date}`;
            if (h.value) {
              text += `\n   📍 <code>${h.value}</code>`;
            }
            text += "\n";
          });

          if (dnsHist.length > 8) {
            text += `\n... و ${dnsHist.length - 8} آدرس دیگر`;
          }
        }

        text += "\n━━━━━━━━━━━━━━━━━━━━";

        await editMsg(token, chatId, callback.message.message_id, text, {
          reply_markup: accountBackKeyboard(),
        });
        return;
      }

      if (data === "account_wg") {
        if (!user) return;
        const rawHist = await env.DB.get(`history:${user}`);
        const hist = rawHist ? JSON.parse(rawHist) : [];
        const wgHist = hist.filter(h => h.type === "wg");

        let text = `🛡️ <b>کانفیگ‌های WireGuard شما</b>

━━━━━━━━━━━━━━━━━━━━
`;

        if (!wgHist.length) {
          text += "\n📭 هنوز کانفیگ WireGuard دریافت نکرده‌اید.\n\nاز منوی اصلی گزینه WireGuard را انتخاب کنید.";
        } else {
          const recentWg = wgHist.slice(0, 6);
          recentWg.forEach((h, idx) => {
            const flag = h.country ? flagFromCode(h.country) : "🌍";
            const countryName = COUNTRY_NAMES_FA[h.country] || h.country || "نامشخص";
            const date = h.at.slice(0, 10);
            const opName = h.operator && OPERATORS[h.operator] ? OPERATORS[h.operator].title : h.operator || "-";

            text += `\n<b>${idx + 1}. ${flag} ${countryName}</b>`;
            text += `\n   📅 ${date}`;
            text += `\n   📱 اپراتور: ${opName}`;
            if (h.dns) {
              const dnsShort = h.dns.length > 25 ? h.dns.slice(0, 22) + "..." : h.dns;
              text += `\n   🌐 DNS: <code>${dnsShort}</code>`;
            }
            text += "\n";
          });

          if (wgHist.length > 6) {
            text += `\n... و ${wgHist.length - 6} کانفیگ دیگر`;
          }

          text += "\n\n💡 برای دریافت مجدد کانفیگ، از منوی اصلی استفاده کنید.";
        }

        text += "\n━━━━━━━━━━━━━━━━━━━━";

        await editMsg(token, chatId, callback.message.message_id, text, {
          reply_markup: accountBackKeyboard(),
        });
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
        const vipStats = await getVIPStats(env);
        const adminVIP = await isVIPUser(env, user);
        // ادیت پیام به جای ارسال جدید
        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          `📊 آمار ربات:\n👥 کاربران: ${us.length}\n🌍 کشورها: ${dns.length}\n📡 مجموع موجودی IP: ${totalStock}\n👑 کاربران VIP: ${vipStats.total}`,
          { reply_markup: mainMenuKeyboard(true, adminVIP) },
        );
        return;
      }

      if (data === "menu_reset_quota") {
        if (String(user) !== adminId) return;
        // ادیت پیام به جای ارسال جدید
        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          "⚠️ آیا از ریست کردن محدودیت تمام کاربران اطمینان دارید؟\n\nبا تایید، محدودیت روزانه همه کاربران صفر شده و به آن‌ها اطلاع داده می‌شود.",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "✅ بله، ریست کن",
                    callback_data: "confirm_reset_quota",
                  },
                  { text: "❌ انصراف", callback_data: "back" },
                ],
              ],
            },
          },
        );
        return;
      }

      if (data === "confirm_reset_quota") {
        if (String(user) !== adminId) return;

        await sendMsg(token, chatId, "⏳ در حال ریست کردن محدودیت کاربران...");

        const resetCount = await resetAllQuotas(env);
        const users = await allUsers(env);

        const giftMessage = `🎁 خبر خوش!\n\n✨ محدودیت روزانه شما به عنوان هدیه ریست شد!\n\n🔄 می‌توانید مجدداً از سرویس‌های زیر استفاده کنید:\n🌐 DNS: ${MAX_DNS_PER_DAY} بار\n🛡️ WireGuard: ${MAX_WG_PER_DAY} بار\n\n💚 از استفاده شما متشکریم!`;

        let sentCount = 0;
        for (const u of users) {
          try {
            await sendMsg(token, u, giftMessage);
            sentCount++;
          } catch (e) {
            console.error(`Error sending gift message to user ${u}:`, e);
          }
        }

        const adminVIP = await isVIPUser(env, user);
        await sendMsg(
          token,
          chatId,
          `✅ عملیات با موفقیت انجام شد!\n\n📊 گزارش:\n👥 تعداد کاربران: ${users.length}\n🔄 محدودیت ریست شده: ${resetCount}\n📢 پیام ارسال شده: ${sentCount}`,
          {
            reply_markup: mainMenuKeyboard(true, adminVIP),
          },
        );

        return;
      }

      // country selected
      if (data.startsWith("ct:")) {
        const code = data.slice(3);
        const flag = flagFromCode(code);
        const countryName = COUNTRY_NAMES_FA[code] || code;
        const rec = await getDNS(env, code);
        const stockInfo = rec
          ? `موجودی: ${rec.stock || 0} IP`
          : "موجودی: نامشخص";

        // ادیت پیام به جای ارسال جدید
        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          `${flag} <b>${countryName}</b>\n${stockInfo}\n\nعملیات را انتخاب کنید:`,
          { reply_markup: actionKeyboard(code) },
        );
        return;
      }

      // VIP DNS IPv4 selection
      if (data.startsWith("vipdns:ipv4")) {
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        const list = await listVIPDNS(env);
        if (!list || list.length === 0) {
          await editMsg(token, chatId, callback.message.message_id, "فعلاً کشور VIP موجود نیست.", {
            reply_markup: vipBackKeyboard()
          });
          return;
        }
        const mapped = list
          .map((r) => ({
            code: (r.code || "").toUpperCase(),
            country: r.country || r.code,
            stock: r.stock || 0,
          }))
          .sort((a, b) => b.stock - a.stock);

        const q = await getQuota(env, user);
        await editMsg(token, chatId, callback.message.message_id,
          `👑 <b>DNS IPv4 VIP</b>\n\nکشور مورد نظر را انتخاب کنید:\n(سهمیه امروز: ${q.dnsLeft}/${VIP_DNS_PER_DAY})\n\n🟢 موجود | 🟡 کم | 🔴 تمام`, {
          reply_markup: countriesKeyboard(mapped, 0, "vipdns4"),
        });
        return;
      }

      // VIP DNS IPv6 selection
      if (data.startsWith("vipdns:ipv6")) {
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        const list = await listVIPDNS6(env);
        if (!list || list.length === 0) {
          await editMsg(token, chatId, callback.message.message_id, "فعلاً کشور VIP IPv6 موجود نیست.", {
            reply_markup: vipBackKeyboard()
          });
          return;
        }
        const mapped = list
          .map((r) => ({
            code: (r.code || "").toUpperCase(),
            country: r.country || r.code,
            stock: r.stock || 0,
          }))
          .sort((a, b) => b.stock - a.stock);

        const q = await getQuota(env, user);
        await editMsg(token, chatId, callback.message.message_id,
          `👑 <b>DNS IPv6 VIP</b>\n\nکشور مورد نظر را انتخاب کنید:\n(سهمیه امروز: ${q.dnsLeft}/${VIP_DNS_PER_DAY})\n\n🟢 موجود | 🟡 کم | 🔴 تمام`, {
          reply_markup: countriesKeyboard(mapped, 0, "vipdns6"),
        });
        return;
      }

      // VIP DNS IPv4 request
      if (data.startsWith("vipdns4:")) {
        const code = data.slice(8);
        if (!user) return;
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        const q = await getQuota(env, user);
        if (q.dnsLeft <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه DNS VIP شما به پایان رسیده است.\nباقی‌مانده: ${q.dnsLeft}/${VIP_DNS_PER_DAY}`);
          return;
        }

        const addr = await allocateVIPAddress(env, code);
        if (!addr) {
          await sendMsg(token, chatId, `برای ${code} آدرس VIP موجود نیست.`);
          return;
        }

        const rec = await getVIPDNS(env, code);
        const flag = flagFromCode(code);
        const countryName = COUNTRY_NAMES_FA[code] || rec?.country || code;
        const stock = rec?.stock || 0;
        const checkUrl = `https://check-host.net/check-ping?host=${addr}`;

        await sendMsg(token, chatId, `${flag} <b>${countryName}</b> - IPv4 VIP\n\n🌐 آدرس اختصاصی شما:\n<code>${addr}</code>\n\n📊 موجودی باقی‌مانده: ${stock}\n📈 سهمیه امروز: ${q.dnsUsed + 1}/${VIP_DNS_PER_DAY}`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔍 بررسی وضعیت فیلتر", url: checkUrl }],
              [{ text: "🔙 بازگشت به منوی VIP", callback_data: "menu_vip" }],
            ],
          },
        });

        await incQuota(env, user, "dns");
        await updateVIPUsage(env, user, "dns");

        const histKey = `history:${user}`;
        try {
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({ type: "dns-ipv4-vip", country: code, at: new Date().toISOString(), value: addr });
          if (h.length > 20) h.splice(20);
          await env.DB.put(histKey, JSON.stringify(h));
        } catch (e) { }
        return;
      }

      // VIP DNS IPv6 request
      if (data.startsWith("vipdns6:")) {
        const code = data.slice(8);
        if (!user) return;
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        const q = await getQuota(env, user);
        if (q.dnsLeft <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه DNS VIP شما به پایان رسیده است.\nباقی‌مانده: ${q.dnsLeft}/${VIP_DNS_PER_DAY}`);
          return;
        }

        const addresses = await allocateVIPAddress6(env, code);
        if (!addresses || addresses.length < 2) {
          await sendMsg(token, chatId, `برای ${code} آدرس VIP IPv6 کافی موجود نیست.`);
          return;
        }

        const rec = await getVIPDNS6(env, code);
        const flag = flagFromCode(code);
        const countryName = COUNTRY_NAMES_FA[code] || rec?.country || code;
        const stock = rec?.stock || 0;

        await sendMsg(token, chatId, `${flag} <b>${countryName}</b> - IPv6 VIP\n\n🌐 آدرس‌های اختصاصی شما:\n<code>${addresses[0]}</code>\n<code>${addresses[1]}</code>\n\n📊 موجودی باقی‌مانده: ${stock}\n📈 سهمیه امروز: ${q.dnsUsed + 1}/${VIP_DNS_PER_DAY}`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 بازگشت به منوی VIP", callback_data: "menu_vip" }]]
          }
        });

        await incQuota(env, user, "dns");
        await updateVIPUsage(env, user, "dns");

        const histKey = `history:${user}`;
        try {
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({ type: "dns-ipv6-vip", country: code, at: new Date().toISOString(), value: addresses.join(", ") });
          if (h.length > 20) h.splice(20);
          await env.DB.put(histKey, JSON.stringify(h));
        } catch (e) { }
        return;
      }

      // VIP WireGuard request
      if (data.startsWith("vipwg:")) {
        const code = data.slice(6);
        const flag = flagFromCode(code);
        const countryName = COUNTRY_NAMES_FA[code] || code;
        await editMsg(token, chatId, callback.message.message_id,
          `${flag} <b>${countryName}</b> - VIP\n\nاپراتور مورد نظر را انتخاب کنید:`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: OPERATORS.irancell.title, callback_data: `vipop:${code}:irancell` },
                { text: OPERATORS.mci.title, callback_data: `vipop:${code}:mci` },
              ],
              [
                { text: OPERATORS.tci.title, callback_data: `vipop:${code}:tci` },
                { text: OPERATORS.rightel.title, callback_data: `vipop:${code}:rightel` },
              ],
              [{ text: OPERATORS.shatel.title, callback_data: `vipop:${code}:shatel` }],
              [{ text: "🔙 بازگشت", callback_data: "vip_wg" }],
            ],
          },
        });
        return;
      }

      // VIP WG operator selection
      if (data.startsWith("vipop:")) {
        const parts = data.split(":");
        const code = parts[1];
        const op = parts[2];
        const flag = flagFromCode(code);
        const countryName = COUNTRY_NAMES_FA[code] || code;
        const operatorName = OPERATORS[op] ? OPERATORS[op].title : op;
        await editMsg(token, chatId, callback.message.message_id,
          `${flag} <b>${countryName}</b> - ${operatorName} VIP\n\nDNS مورد نظر را انتخاب کنید:`, {
          reply_markup: dnsChoiceKeyboard(code, `vip${op}`),
        });
        return;
      }

      // VIP WG final config generation
      if (data.startsWith("choose:") && data.includes(":vip")) {
        const parts = data.split(":");
        const code = parts[1];
        const opPart = parts[2];
        const op = opPart.replace("vip", "");
        const dnsValue = parts.slice(3).join(":");

        if (!user) return;
        const userIsVIP = await isVIPUser(env, user);
        if (!userIsVIP) return;

        const q = await getQuota(env, user);
        if (q.wgLeft <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه WireGuard VIP شما به پایان رسیده است.\nباقی‌مانده: ${q.wgLeft}/${VIP_WG_PER_DAY}`);
          return;
        }

        const recBefore = await getVIPDNS(env, code);
        const locationDns = recBefore && recBefore.addresses && recBefore.addresses.length > 0 ? recBefore.addresses[0] : null;
        const endpoint = await allocateVIPAddress(env, code);

        if (!endpoint) {
          await sendMsg(token, chatId, `برای ${code} آدرس VIP موجود نیست.`);
          return;
        }

        const userDns = dnsValue || null;
        const combinedDns = locationDns && userDns ? `${locationDns}, ${userDns}` : (locationDns || userDns);
        const operatorData = OPERATORS[op];
        const operatorAddress = operatorData && operatorData.addresses && operatorData.addresses.length ? pickRandom(operatorData.addresses) : "10.66.66.2/32";

        // استفاده از تابع مخصوص VIP از vip.js
        const privateKey = randBase64(32);
        const mtu = pickRandom(WG_MTUS);
        const iface = buildVIPWireGuardConfig({
          privateKey,
          address: "10.66.66.2/32",
          mtu,
          dns: combinedDns,
          operatorAddress,
        });

        const countryNameFa = COUNTRY_NAMES_FA[code] || recBefore?.country || code;
        const countryNameEn = COUNTRY_NAMES_EN[code] || code;
        const operatorName = operatorData ? operatorData.title : op;
        const filename = `VIP_${countryNameEn}_WG.conf`;
        const flag = flagFromCode(code);
        const recAfter = await getVIPDNS(env, code);
        const currentStock = recAfter?.stock || 0;

        const caption = `${flag} <b>${countryNameFa}</b> VIP

━━━━━━━━━━━━━━━━━━━━
📱 اپراتور: ${operatorName}
🌐 DNS: ${combinedDns}
📡 موجودی: ${currentStock}
📈 سهمیه: ${q.wgUsed + 1}/${VIP_WG_PER_DAY}
━━━━━━━━━━━━━━━━━━━━

✅ کانفیگ VIP شما آماده است!
🚀 تنظیمات بهینه‌سازی شده`;

        await sendFile(token, chatId, filename, iface, caption);
        await incQuota(env, user, "wg");
        await updateVIPUsage(env, user, "wg");

        try {
          const histKey = `history:${user}`;
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({ type: "wg-vip", country: code, at: new Date().toISOString(), endpoint, operator: op, dns: combinedDns });
          if (h.length > 20) h.splice(20);
          await env.DB.put(histKey, JSON.stringify(h));
        } catch (e) { }
        return;
      }

      // IPv4 DNS request flow
      if (data.startsWith("dns4:")) {
        const code = data.slice(5);
        if (!user) {
          await sendMsg(token, chatId, "کاربر نامشخص");
          return;
        }
        const q = await getQuota(env, user);
        const isAdmin = String(user) === adminId;
        if (!isAdmin && q.dnsLeft <= 0) {
          await sendMsg(
            token,
            chatId,
            `محدودیت روزانه DNS شما به پایان رسیده است.\nباقی‌مانده: ${q.dnsLeft}`,
          );
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

        const message = `${flag} <b>${countryName}</b> - IPv4

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
              [{ text: "🔙 بازگشت به منو", callback_data: "back" }],
            ],
          },
        });
        if (!isAdmin) await incQuota(env, user, "dns");
        // Track VIP usage
        if (q.isVIP) await updateVIPUsage(env, user, "dns");
        const histKey = `history:${user}`;
        try {
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({
            type: "dns-ipv4",
            country: code,
            at: new Date().toISOString(),
            value: addr,
          });
          if (h.length > 20) h.splice(20);
          await env.DB.put(histKey, JSON.stringify(h));
        } catch (e) {
          console.error("history save err", e);
        }
        return;
      }

      // IPv6 DNS request flow (gives 2 addresses, no filter check)
      if (data.startsWith("dns6:")) {
        const code = data.slice(5);
        if (!user) { await sendMsg(token, chatId, "کاربر نامشخص"); return; }
        const q = await getQuota(env, user);
        const isAdmin = String(user) === adminId;
        if (!isAdmin && q.dnsLeft <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه DNS شما به پایان رسیده است.\nباقی‌مانده: ${q.dnsLeft}`);
          return;
        }
        const addresses = await allocateAddress6(env, code);
        if (!addresses || addresses.length < 2) {
          await sendMsg(token, chatId, `برای ${code} آدرس IPv6 کافی موجود نیست.`);
          return;
        }

        const rec = await getDNS6(env, code);
        const flag = flagFromCode(code);
        const countryNameFa = COUNTRY_NAMES_FA[code] || rec?.country || code;
        const stock = rec?.stock || 0;

        const message = `${flag} <b>${countryNameFa}</b> - IPv6

🌐 آدرس‌های اختصاصی شما:
<code>${addresses[0]}</code>
<code>${addresses[1]}</code>

📊 موجودی باقی‌مانده ${countryNameFa}: ${stock} عدد
📈 سهمیه امروز شما: ${q.dnsUsed + 1}/${MAX_DNS_PER_DAY}`;

        await sendMsg(token, chatId, message, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔙 بازگشت به منو", callback_data: "back" }]
            ]
          }
        });
        if (!isAdmin) await incQuota(env, user, "dns");
        // Track VIP usage
        if (q.isVIP) await updateVIPUsage(env, user, "dns");
        const histKey = `history:${user}`;
        try {
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({ type: "dns-ipv6", country: code, at: new Date().toISOString(), value: addresses.join(", ") });
          if (h.length > 20) h.splice(20);
          await env.DB.put(histKey, JSON.stringify(h));
        } catch (e) { console.error("history save err", e); }
        return;
      }

      // wg flow step 1: user clicked wg:CODE -> choose operator
      if (data.startsWith("wg:")) {
        const code = data.slice(3);
        const flag = flagFromCode(code);
        const countryName = COUNTRY_NAMES_FA[code] || code;
        // ادیت پیام به جای ارسال جدید
        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          `${flag} <b>${countryName}</b>\n\nاپراتور مورد نظر را انتخاب کنید:`,
          { reply_markup: operatorKeyboard(code) },
        );
        return;
      }

      // wg flow step 2: op:CODE:OPKEY -> choose DNS
      if (data.startsWith("op:")) {
        const parts = data.split(":");
        const code = parts[1];
        const op = parts[2];
        const flag = flagFromCode(code);
        const countryName = COUNTRY_NAMES_FA[code] || code;
        const operatorName = OPERATORS[op] ? OPERATORS[op].title : op;
        // ادیت پیام به جای ارسال جدید
        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          `${flag} <b>${countryName}</b> - ${operatorName}\n\nDNS مورد نظر را انتخاب کنید:`,
          { reply_markup: dnsChoiceKeyboard(code, op) },
        );
        return;
      }

      // wg final: choose:CODE:OP:DNS -> allocate IP, build config, send file
      if (data.startsWith("choose:")) {
        const parts = data.split(":");
        const code = parts[1];
        const op = parts[2];
        const dnsValue = parts.slice(3).join(":");
        if (!user) {
          await sendMsg(token, chatId, "کاربر نامشخص");
          return;
        }
        const q = await getQuota(env, user);
        const isAdmin = String(user) === adminId;
        if (!isAdmin && q.wgLeft <= 0) {
          await sendMsg(
            token,
            chatId,
            `محدودیت روزانه WireGuard شما به پایان رسیده است.\nباقی‌مانده: ${q.wgLeft}`,
          );
          return;
        }

        // IMPORTANT: Get location DNS BEFORE allocating address
        const recBefore = await getDNS(env, code);

        // Get DNS location (first available address from country)
        const locationDns =
          recBefore && recBefore.addresses && recBefore.addresses.length > 0
            ? recBefore.addresses[0]
            : null;

        // Now allocate the address (which removes it from the list)
        const endpoint = await allocateAddress(env, code);
        if (!endpoint) {
          await sendMsg(token, chatId, `برای ${code} آدرسی موجود نیست.`);
          return;
        }

        const mtu = pickRandom(WG_MTUS);
        const userDns = dnsValue || pickRandom(WG_FIXED_DNS);
        const priv = randBase64(32);

        // DNS: location DNS first, then user selected DNS
        const combinedDns = locationDns
          ? `${locationDns}, ${userDns}`
          : userDns;

        // Address: از اپراتور انتخابی
        const operatorData = OPERATORS[op];
        const operatorAddress =
          operatorData &&
            operatorData.addresses &&
            operatorData.addresses.length
            ? pickRandom(operatorData.addresses)
            : "10.66.66.2/32";

        const iface = buildInterfaceOnlyConfig({
          privateKey: priv,
          address: "10.66.66.2/32",
          mtu,
          dns: combinedDns,
          operatorAddress,
        });

        // Use English country name for filename
        const countryNameFa =
          COUNTRY_NAMES_FA[code] || recBefore?.country || code;
        const countryNameEn = COUNTRY_NAMES_EN[code] || code;
        const operatorName = operatorData ? operatorData.title : op;
        const filename = `${countryNameEn}_WG.conf`;
        const flag = flagFromCode(code);

        // Get updated stock after allocation
        const recAfter = await getDNS(env, code);
        const currentStock = recAfter?.stock || 0;

        const caption = `${flag} <b>${countryNameFa}</b>

━━━━━━━━━━━━━━━━━━━━
📱 اپراتور: ${operatorName}
🌐 DNS: ${combinedDns}
📡 موجودی: ${currentStock}
📈 سهمیه: ${q.wgUsed + 1}/${MAX_WG_PER_DAY}
━━━━━━━━━━━━━━━━━━━━

✅ کانفیگ شما آماده است!`;

        await sendFile(token, chatId, filename, iface, caption);
        if (!isAdmin) await incQuota(env, user, "wg");
        // Track VIP usage
        if (q.isVIP) await updateVIPUsage(env, user, "wg");
        try {
          const histKey = `history:${user}`;
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({
            type: "wg",
            country: code,
            at: new Date().toISOString(),
            endpoint,
            operator: op,
            dns: combinedDns,
          });
          if (h.length > 20) h.splice(20);
          await env.DB.put(histKey, JSON.stringify(h));
        } catch (e) {
          console.error("history save err", e);
        }
        return;
      }

      return;
    } // end callback handling

    // Plain text commands (fallback)
    const text = message && message.text ? message.text.trim() : "";

    if (text === "/start") {
      const userIsVIP = await isVIPUser(env, user);
      await sendMsg(token, chatId, "سلام 👋\nاز دکمه‌ها استفاده کنید:", {
        reply_markup: mainMenuKeyboard(String(user) === adminId, userIsVIP),
      });
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
      if (!payload) {
        await sendMsg(
          token,
          chatId,
          "متن پیام را بعد از /broadcast وارد کنید.",
        );
        return;
      }
      const list = await allUsers(env);
      for (const u of list) {
        sendMsg(token, u, payload).catch((e) =>
          console.error("broadcast err", e),
        );
      }
      await sendMsg(token, chatId, `پیام به ${list.length} کاربر ارسال شد.`);
      return;
    }

    if (text === "/vip") {
      if (!user) {
        await sendMsg(token, chatId, "کاربر نامشخص");
        return;
      }
      const userIsVIP = await isVIPUser(env, user);
      if (!userIsVIP) {
        await sendMsg(token, chatId,
          "⛔️ شما به بخش VIP دسترسی ندارید.\n\n💎 <b>خرید اشتراک VIP</b>\n\n✨ مزایای VIP:\n• سهمیه روزانه 10 عددی (DNS و WireGuard)\n• دسترسی به سرورهای اختصاصی VIP\n• کیفیت و سرعت بالاتر\n• پشتیبانی ویژه\n\n📩 برای دریافت اطلاعات و خرید با ادمین در ارتباط باشید:\n@Minimalcraft", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📩 ارتباط با ادمین", url: "https://t.me/Minimalcraft" }],
              [{ text: "🔙 بازگشت به منو", callback_data: "back" }]
            ]
          }
        });
        return;
      }

      const vipData = await getVIPUserData(env, user);
      let expiryText = "♾️ دائمی";
      if (vipData && vipData.expiresAt) {
        const expiryDate = new Date(vipData.expiresAt);
        const now = new Date();
        const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        expiryText = daysLeft > 0 ? `${daysLeft} روز باقی‌مانده` : "منقضی شده";
      }

      await sendMsg(token, chatId, `👑 <b>پنل VIP</b>\n\n🌟 به بخش ویژه خوش آمدید!\n\n⏰ اعتبار: ${expiryText}\n\n💎 سهمیه روزانه: <b>10 DNS</b> + <b>10 WireGuard</b>\n🚀 دسترسی به سرورهای اختصاصی VIP\n⚡️ کیفیت و سرعت بالاتر\n\nیک گزینه را انتخاب کنید:`, {
        reply_markup: vipMenuKeyboard(),
      });
      return;
    }

    if (text.startsWith("/pro")) {
      if (!user) {
        await sendMsg(token, chatId, "کاربر نامشخص");
        return;
      }

      const parts = text.trim().split(/\s+/);
      if (parts.length === 1) {
        // Show Pro info
        const isPro = await isProUser(env, user);
        if (isPro) {
          const proData = await env.DB.get(`pro:user:${user}`);
          const userData = proData ? JSON.parse(proData) : {};
          let expiryText = "نامشخص";
          if (userData.expiresAt) {
            const expiryDate = new Date(userData.expiresAt);
            const now = new Date();
            const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
            expiryText = daysLeft > 0 ? `${daysLeft} روز` : "منقضی شده";
          }
          await sendMsg(token, chatId, `⭐️ <b>شما کاربر پرو هستید!</b>\n\n✅ سهمیه روزانه: <b>10 DNS + 10 WireGuard</b>\n⏰ اعتبار باقی‌مانده: ${expiryText}\n\n💡 با اشتراک پرو، از همه امکانات با سهمیه بالاتر استفاده کنید!`);
        } else {
          await sendMsg(token, chatId,
            "⭐️ <b>ارتقا به حساب پرو</b>\n\n🎯 با خرید اشتراک پرو:\n• سهمیه روزانه <b>10 DNS</b> دریافت کنید\n• سهمیه روزانه <b>10 WireGuard</b> دریافت کنید\n• از همه سرورهای عادی با سهمیه بالاتر استفاده کنید\n\n📩 برای دریافت اطلاعات و خرید کد پرو با ادمین در ارتباط باشید:\n@Minimalcraft\n\n💡 <b>نحوه استفاده:</b>\nبعد از خرید کد، از دستور زیر استفاده کنید:\n<code>/pro کد_شما</code>",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "📩 ارتباط با ادمین", url: "https://t.me/Minimalcraft" }]
                ]
              }
            }
          );
        }
        return;
      }

      // User entered a key
      const keyCode = parts[1].toUpperCase();
      const result = await useProKey(env, user, keyCode);

      if (result.success) {
        // Send notification to user
        await sendMsg(token, chatId,
          `🎉 <b>تبریک!</b>\n\n✅ اشتراک پرو شما با موفقیت فعال شد!\n\n⏰ مدت اعتبار: <b>${result.days} روز</b>\n📈 سهمیه روزانه جدید: <b>10 DNS + 10 WireGuard</b>\n\n🚀 از این لحظه می‌توانید با سهمیه بالاتر از خدمات استفاده کنید!\n\n💚 از اعتماد شما متشکریم!`
        );

        // Send notification to admin
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + result.days);
        const expiryStr = expiryDate.toLocaleDateString('fa-IR');
        await sendMsg(token, adminId,
          `🔔 <b>اشتراک پرو فعال شد</b>\n\n👤 کاربر: <code>${user}</code>\n⏰ مدت: ${result.days} روز\n📅 انقضا: ${expiryStr}`
        );

        const userIsVIP = await isVIPUser(env, user);
        await sendMsg(token, chatId, "منوی اصلی:", {
          reply_markup: mainMenuKeyboard(String(user) === adminId, userIsVIP),
        });
      } else {
        await sendMsg(token, chatId, `❌ ${result.error}\n\n💡 اگر کد را از ادمین خریداری کرده‌اید، لطفاً مجدداً تلاش کنید یا با پشتیبانی تماس بگیرید.`);
      }
      return;
    }

    if (text === "/status" || text === "/me") {
      if (!user) {
        await sendMsg(token, chatId, "کاربر نامشخص");
        return;
      }
      const q = await getQuota(env, user);
      const rawHist = await env.DB.get(`history:${user}`);
      const hist = rawHist ? JSON.parse(rawHist) : [];
      let s = `📊 وضعیت شما:\nDNS باقی‌مانده امروز: ${q.dnsLeft}\nWG باقی‌مانده امروز: ${q.wgLeft}\n\nآخرین درخواست‌ها:\n`;
      if (!hist || hist.length === 0) s += "(تاریخی ثبت نشده)";
      else
        s += hist
          .slice(0, 10)
          .map(
            (h) =>
              `${h.at.slice(0, 19).replace("T", " ")} — ${h.type} — ${h.country || ""}`,
          )
          .join("\n");
      await sendMsg(token, chatId, s);
      return;
    }

    // default: show menu
    const userIsVIP = await isVIPUser(env, user);
    await sendMsg(token, chatId, "لطفاً از منوی دکمه‌ای استفاده کنید:", {
      reply_markup: mainMenuKeyboard(String(user) === adminId, userIsVIP),
    });
  } catch (err) {
    console.error("handleUpdate error:", err);
    try {
      const chat =
        (update.message && update.message.chat && update.message.chat.id) ||
        (update.callback_query &&
          update.callback_query.message &&
          update.callback_query.message.chat &&
          update.callback_query.message.chat.id);
      if (chat)
        await sendMsg(
          env.BOT_TOKEN,
          chat,
          "خطایی رخ داد، لطفاً بعداً امتحان کنید.",
        );
    } catch (e) {
      /* swallow */
    }
  }
}

/* ---------------------- Web app.fetch (Pages catch-all) ---------------------- */

function isAdminReq(request, env) {
  if (!env.ADMIN_ID) return false; // No admin configured
  const url = new URL(request.url);
  const q = url.searchParams.get("admin");
  const header = request.headers.get("x-admin-id");
  const adminId = String(env.ADMIN_ID);
  return String(q) === adminId || String(header) === adminId;
}

const app = {
  async fetch(request, env) {
    // Validate required environment variables
    if (!env.BOT_TOKEN || !env.ADMIN_ID) {
      console.error("CRITICAL: Required environment variables missing", {
        hasBotToken: !!env.BOT_TOKEN,
        hasAdminId: !!env.ADMIN_ID
      });
      // For root path, still serve the HTML but admin panel won't work
      // For API endpoints, return 503 Service Unavailable
      const url = new URL(request.url);
      if (url.pathname === "/" && request.method.toUpperCase() === "GET") {
        // Allow homepage to load (it will show access denied anyway)
      } else if (url.pathname.startsWith("/api/") || url.pathname === "/webhook") {
        return new Response(
          "Service unavailable: Required environment variables (BOT_TOKEN, ADMIN_ID) are not configured",
          { status: 503 }
        );
      }
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // Root: serve index.html
    if (path === "/" && method === "GET") {
      try {
        // Try ASSETS first (Cloudflare Pages)
        if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
          const htmlFile = await env.ASSETS.fetch(request);
          return htmlFile;
        }
        // Fallback: read index.html directly (for development/Node.js)
        const fs = await import("fs/promises");
        const content = await fs.readFile("index.html", "utf-8");
        return new Response(content, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
          },
        });
      } catch (e) {
        console.error("Error serving index.html:", e);
        return new Response("index.html not found", { status: 404 });
      }
    }

    // Serve countries.json
    if (path === "/countries.json" && method === "GET") {
      try {
        // Try ASSETS first (Cloudflare Pages)
        if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
          return env.ASSETS.fetch(request);
        }
        // Fallback: read countries.json directly (for development/Node.js)
        const fs = await import("fs/promises");
        const content = await fs.readFile("countries.json", "utf-8");
        return new Response(content, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch (e) {
        console.error("Error serving countries.json:", e);
        return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
      }
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
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const list = await listDNS(env);
      return jsonResponse(list);
    }

    if (path.startsWith("/api/dns/")) {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const parts = path.split("/");
      const code = parts[3];
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

    // IPv6 DNS endpoints
    if (path === "/api/dns6" && method === "GET") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const list = await listDNS6(env);
      return jsonResponse(list);
    }

    // VIP DNS IPv4 endpoints
    if (path === "/api/vipdns" && method === "GET") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const list = await listVIPDNS(env);
      return jsonResponse(list);
    }

    if (path.startsWith("/api/vipdns/")) {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const parts = path.split("/");
      const code = parts[3];
      if (!code) return new Response("bad request", { status: 400 });

      if (method === "GET") {
        const rec = await getVIPDNS(env, code);
        if (!rec) return new Response("not found", { status: 404 });
        return jsonResponse(rec);
      }
      if (method === "PUT") {
        try {
          const body = await request.json();
          body.code = code.toUpperCase();
          await updateVIPDNS(env, code, body);
          return jsonResponse({ ok: true });
        } catch (e) {
          return jsonResponse({ error: "invalid json" }, 400);
        }
      }
      if (method === "DELETE") {
        await deleteVIPDNS(env, code);
        return jsonResponse({ ok: true });
      }
    }

    // VIP DNS IPv6 endpoints
    if (path === "/api/vipdns6" && method === "GET") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const list = await listVIPDNS6(env);
      return jsonResponse(list);
    }

    if (path.startsWith("/api/vipdns6/")) {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const parts = path.split("/");
      const code = parts[3];
      if (!code) return new Response("bad request", { status: 400 });

      if (method === "GET") {
        const rec = await getVIPDNS6(env, code);
        if (!rec) return new Response("not found", { status: 404 });
        return jsonResponse(rec);
      }
      if (method === "PUT") {
        try {
          const body = await request.json();
          body.code = code.toUpperCase();
          await updateVIPDNS6(env, code, body);
          return jsonResponse({ ok: true });
        } catch (e) {
          return jsonResponse({ error: "invalid json" }, 400);
        }
      }
      if (method === "DELETE") {
        await deleteVIPDNS6(env, code);
        return jsonResponse({ ok: true });
      }
    }

    if (path.startsWith("/api/dns6/")) {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const parts = path.split("/");
      const code = parts[3];
      if (!code) return new Response("bad request", { status: 400 });

      if (method === "GET") {
        const rec = await getDNS6(env, code);
        if (!rec) return new Response("not found", { status: 404 });
        return jsonResponse(rec);
      }
      if (method === "PUT") {
        try {
          const body = await request.json();
          body.code = code.toUpperCase();
          await updateDNS6(env, code, body);
          return jsonResponse({ ok: true });
        } catch (e) {
          return jsonResponse({ error: "invalid json" }, 400);
        }
      }
      if (method === "DELETE") {
        await deleteDNS6(env, code);
        return jsonResponse({ ok: true });
      }
    }

    if (path === "/api/users" && method === "GET") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const us = await allUsers(env);
      return jsonResponse({ users: us });
    }

    // Add endpoint to fetch user info
    if (path.startsWith("/api/user/") && method === "GET") {
      if (!isAdminReq(request, env)) {
        return new Response("forbidden", { status: 403 });
      }
      const parts = path.split("/");
      const userId = parts[2];
      if (!userId) {
        return new Response("Bad Request: User ID is required", { status: 400 });
      }

      // Fetch user info from Telegram API (or a cached version if available)
      // For simplicity, let's assume we have a way to get basic user info.
      // In a real scenario, you'd likely store this when the user first interacts.
      // For now, we'll return a placeholder or mock data.
      // You would replace this with actual logic to retrieve user data.
      const userInfo = {
        id: userId,
        username: `user_${userId.slice(-4)}`, // Placeholder username
        first_name: "نام", // Placeholder first name
        last_name: "کاربر", // Placeholder last name
        last_seen: new Date().toISOString(), // Placeholder last seen
      };

      // Mock fetching from a hypothetical KV store or cache if available
      // Example: const cachedInfo = await env.DB.get(`user_info:${userId}`);
      // if (cachedInfo) { userInfo = JSON.parse(cachedInfo); }

      return jsonResponse(userInfo);
    }

    if (path === "/api/broadcast" && method === "POST") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
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

    // VIP API endpoints
    if (path === "/api/vip" && method === "GET") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const vipUsers = await getAllVIPUsersWithDetails(env);
      return jsonResponse({ vipUsers });
    }

    if (path === "/api/vip/stats" && method === "GET") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const stats = await getVIPStats(env);
      return jsonResponse(stats);
    }

    if (path === "/api/vip/add" && method === "POST") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      try {
        const body = await request.json();
        const userId = body.userId;
        if (!userId) return jsonResponse({ error: "missing userId" }, 400);

        const options = {};

        // محاسبه تاریخ انقضا بر اساس روزها
        if (body.days) {
          options.expiresAt = calculateVIPExpiry(parseInt(body.days));
        } else if (body.expiresAt) {
          options.expiresAt = body.expiresAt;
        }

        if (body.notes) options.notes = body.notes;

        const added = await addVIPUser(env, userId, options);

        // Send notification to user
        let expiryText = "♾️ دائمی";
        if (options.expiresAt) {
          const expiryDate = new Date(options.expiresAt);
          const now = new Date();
          const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
          expiryText = daysLeft > 0 ? `${daysLeft} روز` : "منقضی شده";
        }

        await sendMsg(token, userId,
          `🎉 <b>تبریک!</b>\n\n👑 اشتراک VIP شما با موفقیت فعال شد!\n\n⏰ مدت اعتبار: ${expiryText}\n📈 سهمیه روزانه جدید: <b>10 DNS + 10 WireGuard</b>\n🌟 دسترسی به سرورهای اختصاصی VIP\n\n🚀 از این لحظه می‌توانید از امکانات ویژه VIP استفاده کنید!\n\n💚 از اعتماد شما متشکریم!`
        );

        return jsonResponse({ ok: true, added, expiresAt: options.expiresAt });
      } catch (e) {
        return jsonResponse({ error: "invalid json" }, 400);
      }
    }

    if (path === "/api/vip/remove" && method === "POST") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      try {
        const body = await request.json();
        const userId = body.userId;
        if (!userId) return jsonResponse({ error: "missing userId" }, 400);
        const removed = await removeVIPUser(env, userId);
        return jsonResponse({ ok: true, removed });
      } catch (e) {
        return jsonResponse({ error: "invalid json" }, 400);
      }
    }

    if (path === "/api/vip/update" && method === "POST") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      try {
        const body = await request.json();
        const userId = body.userId;
        if (!userId) return jsonResponse({ error: "missing userId" }, 400);

        if (body.expiresAt !== undefined) {
          await updateVIPExpiration(env, userId, body.expiresAt);
        }
        if (body.notes !== undefined) {
          await updateVIPNotes(env, userId, body.notes);
        }

        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: "invalid json" }, 400);
      }
    }

    // Pro Key API endpoints
    if (path === "/api/prokeys" && method === "GET") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const keys = await getAllProKeys(env);
      return jsonResponse({ keys });
    }

    if (path === "/api/prokeys/create" && method === "POST") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      try {
        const body = await request.json();
        const days = parseInt(body.days);
        const count = parseInt(body.count) || 1;
        if (!days || days <= 0) return jsonResponse({ error: "invalid days" }, 400);

        const keys = await createProKey(env, days, count);
        return jsonResponse({ ok: true, keys });
      } catch (e) {
        return jsonResponse({ error: "invalid json" }, 400);
      }
    }

    if (path.startsWith("/api/prokeys/") && method === "DELETE") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const parts = path.split("/");
      const keyCode = parts[3];
      if (!keyCode) return new Response("bad request", { status: 400 });

      await deleteProKey(env, keyCode);
      return jsonResponse({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  },
};

/* ---------------------- Export default app ---------------------- */
export default app;
