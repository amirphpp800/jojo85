// main.js — Telegram WireGuard/DNS Bot + Responsive Web Panel --> index.html for Cloudflare Pages
// ---------------------------------------------------------------
// - KV binding name: DB
// - Required env vars: BOT_TOKEN, ADMIN_ID (fallback to numeric ADMIN_FALLBACK)
//   per-user daily quotas (3 DNS / 3 WG), responsive admin panel, admin broadcast.
// ---------------------------------------------------------------

/* ---------------------- Config ---------------------- */
const MAX_DNS_PER_DAY = 3;
const MAX_WG_PER_DAY = 3;
const DATE_YYYYMMDD = () =>
  new Date().toISOString().slice(0, 10).replace(/-/g, "");

// Fallback admin id (used if ENV ADMIN_ID is missing)
const ADMIN_FALLBACK = "7240662021";

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

// Country names in Persian
const COUNTRY_NAMES_FA = {
  IR: "ایران",
  US: "آمریکا",
  GB: "انگلستان",
  DE: "آلمان",
  FR: "فرانسه",
  NL: "هلند",
  SE: "سوئد",
  FI: "فنلاند",
  NO: "نروژ",
  DK: "دانمارک",
  CH: "سوئیس",
  AT: "اتریش",
  BE: "بلژیک",
  ES: "اسپانیا",
  IT: "ایتالیا",
  PL: "لهستان",
  RO: "رومانی",
  CZ: "چک",
  HU: "مجارستان",
  BG: "بلغارستان",
  UA: "اوکراین",
  RU: "روسیه",
  TR: "ترکیه",
  AE: "امارات",
  SA: "عربستان",
  JP: "ژاپن",
  KR: "کره جنوبی",
  SG: "سنگاپور",
  HK: "هنگ کنگ",
  AU: "استرالیا",
  CA: "کانادا",
  BR: "برزیل",
  MX: "مکزیک",
  AR: "آرژانتین",
  CL: "شیلی",
  IN: "هند",
  ID: "اندونزی",
  TH: "تایلند",
  VN: "ویتنام",
  MY: "مالزی",
  PH: "فیلیپین",
  ZA: "آفریقای جنوبی",
  EG: "مصر",
  NG: "نیجریه",
  IL: "اسرائیل",
  GE: "گرجستان",
  AM: "ارمنستان",
  AZ: "آذربایجان",
  KZ: "قزاقستان",
  UZ: "ازبکستان",
  IS: "ایسلند",
  IE: "ایرلند",
  PT: "پرتغال",
  GR: "یونان",
  HR: "کرواسی",
  RS: "صربستان",
  LV: "لتونی",
  LT: "لیتوانی",
  EE: "استونی",
  SK: "اسلواکی",
  SI: "اسلوونی",
  LU: "لوکزامبورگ",
};

// Country names in English (for config filenames) - COMPLETE LIST
const COUNTRY_NAMES_EN = {
  IR: "Iran",
  US: "USA",
  GB: "UK",
  DE: "Germany",
  FR: "France",
  NL: "Netherlands",
  SE: "Sweden",
  FI: "Finland",
  NO: "Norway",
  DK: "Denmark",
  CH: "Switzerland",
  AT: "Austria",
  BE: "Belgium",
  ES: "Spain",
  IT: "Italy",
  PL: "Poland",
  RO: "Romania",
  CZ: "Czechia",
  HU: "Hungary",
  BG: "Bulgaria",
  UA: "Ukraine",
  RU: "Russia",
  TR: "Turkey",
  AE: "UAE",
  SA: "Saudi",
  JP: "Japan",
  KR: "SouthKorea",
  SG: "Singapore",
  HK: "HongKong",
  AU: "Australia",
  CA: "Canada",
  BR: "Brazil",
  MX: "Mexico",
  AR: "Argentina",
  CL: "Chile",
  IN: "India",
  ID: "Indonesia",
  TH: "Thailand",
  VN: "Vietnam",
  MY: "Malaysia",
  PH: "Philippines",
  ZA: "SouthAfrica",
  EG: "Egypt",
  NG: "Nigeria",
  IL: "Israel",
  GE: "Georgia",
  AM: "Armenia",
  AZ: "Azerbaijan",
  KZ: "Kazakhstan",
  UZ: "Uzbekistan",
  IS: "Iceland",
  IE: "Ireland",
  PT: "Portugal",
  GR: "Greece",
  HR: "Croatia",
  RS: "Serbia",
  LV: "Latvia",
  LT: "Lithuania",
  EE: "Estonia",
  SK: "Slovakia",
  SI: "Slovenia",
  LU: "Luxembourg",
  AL: "Albania",
  BA: "Bosnia",
  BY: "Belarus",
  CY: "Cyprus",
  MC: "Monaco",
  MD: "Moldova",
  ME: "Montenegro",
  MK: "Macedonia",
  MT: "Malta",
  SM: "SanMarino",
  VA: "Vatican",
  AD: "Andorra",
  LI: "Liechtenstein",
  FO: "Faroe",
  GI: "Gibraltar",
  JE: "Jersey",
  IM: "IsleOfMan",
  GG: "Guernsey",
  AX: "Aland",
  GL: "Greenland",
  CN: "China",
  TW: "Taiwan",
  MO: "Macau",
  KP: "NorthKorea",
  MN: "Mongolia",
  KH: "Cambodia",
  LA: "Laos",
  MM: "Myanmar",
  BD: "Bangladesh",
  BT: "Bhutan",
  NP: "Nepal",
  LK: "SriLanka",
  MV: "Maldives",
  PK: "Pakistan",
  AF: "Afghanistan",
  IQ: "Iraq",
  SY: "Syria",
  LB: "Lebanon",
  JO: "Jordan",
  PS: "Palestine",
  YE: "Yemen",
  OM: "Oman",
  KW: "Kuwait",
  QA: "Qatar",
  BH: "Bahrain",
  DZ: "Algeria",
  TN: "Tunisia",
  MA: "Morocco",
  LY: "Libya",
  SD: "Sudan",
  SO: "Somalia",
  ET: "Ethiopia",
  KE: "Kenya",
  TZ: "Tanzania",
  UG: "Uganda",
  RW: "Rwanda",
  BI: "Burundi",
  MW: "Malawi",
  ZM: "Zambia",
  ZW: "Zimbabwe",
  MZ: "Mozambique",
  AO: "Angola",
  NA: "Namibia",
  BW: "Botswana",
  LS: "Lesotho",
  SZ: "Eswatini",
  MG: "Madagascar",
  MU: "Mauritius",
  SC: "Seychelles",
  KM: "Comoros",
  DJ: "Djibouti",
  ER: "Eritrea",
  SS: "SouthSudan",
  CM: "Cameroon",
  CF: "CentralAfrican",
  TD: "Chad",
  CG: "Congo",
  CD: "DRCongo",
  GA: "Gabon",
  GQ: "EquatorialGuinea",
  ST: "SaoTome",
  GH: "Ghana",
  CI: "IvoryCoast",
  BF: "BurkinaFaso",
  ML: "Mali",
  NE: "Niger",
  SN: "Senegal",
  GM: "Gambia",
  GW: "GuineaBissau",
  GN: "Guinea",
  SL: "SierraLeone",
  LR: "Liberia",
  TG: "Togo",
  BJ: "Benin",
  MR: "Mauritania",
  CV: "CapeVerde",
  NZ: "NewZealand",
  PG: "PapuaNewGuinea",
  FJ: "Fiji",
  NC: "NewCaledonia",
  PF: "FrenchPolynesia",
  WS: "Samoa",
  TO: "Tonga",
  VU: "Vanuatu",
  SB: "SolomonIslands",
  KI: "Kiribati",
  FM: "Micronesia",
  MH: "MarshallIslands",
  PW: "Palau",
  NR: "Nauru",
  TV: "Tuvalu",
  TK: "Tokelau",
  NU: "Niue",
  CK: "CookIslands",
  CO: "Colombia",
  VE: "Venezuela",
  EC: "Ecuador",
  PE: "Peru",
  BO: "Bolivia",
  PY: "Paraguay",
  UY: "Uruguay",
  GY: "Guyana",
  SR: "Suriname",
  GF: "FrenchGuiana",
  CR: "CostaRica",
  PA: "Panama",
  NI: "Nicaragua",
  HN: "Honduras",
  SV: "ElSalvador",
  GT: "Guatemala",
  BZ: "Belize",
  CU: "Cuba",
  JM: "Jamaica",
  HT: "Haiti",
  DO: "DominicanRepublic",
  PR: "PuertoRico",
  TT: "TrinidadTobago",
  BB: "Barbados",
  BS: "Bahamas",
  LC: "SaintLucia",
  GD: "Grenada",
  VC: "SaintVincent",
  AG: "AntiguaBarbuda",
  DM: "Dominica",
  KN: "SaintKitts",
};

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
  const d = DATE_YYYYMMDD();
  const dns = parseInt(await env.DB.get(`q:dns:${id}:${d}`)) || 0;
  const wg = parseInt(await env.DB.get(`q:wg:${id}:${d}`)) || 0;
  return {
    dnsUsed: dns,
    wgUsed: wg,
    dnsLeft: Math.max(0, MAX_DNS_PER_DAY - dns),
    wgLeft: Math.max(0, MAX_WG_PER_DAY - wg),
  };
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

function mainMenuKeyboard(isAdmin = false) {
  const rows = [
    [
      { text: "🛡️ WireGuard", callback_data: "menu_wg" },
      { text: "🌐 DNS", callback_data: "menu_dns_proto" },
    ],
    [{ text: "👤 حساب من", callback_data: "menu_account" }],
  ];
  if (isAdmin) {
    rows.push([
      { text: "📢 پیام همگانی", callback_data: "menu_broadcast" },
      { text: "📊 آمار ربات", callback_data: "menu_stats" },
    ]);
    rows.push([{ text: "🎁 ریست محدودیت", callback_data: "menu_reset_quota" }]);
  }
  return { inline_keyboard: rows };
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
    const flag = flagFromCode(code);
    const stockCount = r.stock ?? 0;
    const emoji = stockEmoji(stockCount);

    let callbackData;
    if (mode === "dns4") callbackData = `dns4:${code}`;
    else if (mode === "dns6") callbackData = `dns6:${code}`;
    else if (mode === "wg") callbackData = `wg:${code}`;
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
        { text: "🌐 دریافت DNS", callback_data: `dns:${code}` },
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
  // prefer env ADMIN_ID, otherwise fallback to ADMIN_FALLBACK
  const adminId = String(env.ADMIN_ID || ADMIN_FALLBACK);
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
          await sendMsg(
            token,
            chatId,
            `✅ پیام برای ${list.length} کاربر ارسال شد.`,
            { reply_markup: mainMenuKeyboard(true) },
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
      }).catch(() => {});

      // navigation
      if (data === "back") {
        await sendMsg(token, chatId, "منوی اصلی:", {
          reply_markup: mainMenuKeyboard(String(user) === adminId),
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
        await sendMsg(
          token,
          chatId,
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

          await sendMsg(
            token,
            chatId,
            "🌐 دریافت DNS IPv4 - کشور مورد نظر را انتخاب کنید:\n\n🟢 موجود | 🟡 کم | 🔴 تمام",
            {
              reply_markup: countriesKeyboard(mapped, 0, "dns4"),
            },
          );
        } else if (protocol === "ipv6") {
          const list = await listDNS6(env);
          if (!list || list.length === 0) {
            await sendMsg(token, chatId, "فعلاً رکوردی IPv6 موجود نیست.");
            return;
          }
          const mapped = list
            .map((r) => ({
              code: (r.code || "").toUpperCase(),
              country: r.country || r.code,
              stock: r.stock || 0,
            }))
            .sort((a, b) => b.stock - a.stock);

          await sendMsg(
            token,
            chatId,
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

        await sendMsg(
          token,
          chatId,
          "🛡️ دریافت WireGuard - کشور مورد نظر را انتخاب کنید:\n\n🟢 موجود | 🟡 کم | 🔴 تمام",
          {
            reply_markup: countriesKeyboard(mapped, 0, "wg"),
          },
        );
        return;
      }

      if (data === "menu_account") {
        if (!user) {
          await sendMsg(token, chatId, "مشخصات کاربری پیدا نشد.");
          return;
        }
        const q = await getQuota(env, user);
        const rawHist = await env.DB.get(`history:${user}`);
        const hist = rawHist ? JSON.parse(rawHist) : [];

        let text = `👤 <b>حساب کاربری شما</b>

━━━━━━━━━━━━━━━━━━━━
📊 <b>سهمیه امروز:</b>

🌐 DNS باقی‌مانده: <b>${q.dnsLeft}/${MAX_DNS_PER_DAY}</b>
🛡️ WireGuard باقی‌مانده: <b>${q.wgLeft}/${MAX_WG_PER_DAY}</b>

━━━━━━━━━━━━━━━━━━━━
📁 <b>تاریخچه درخواست‌ها:</b>
`;

        if (!hist.length) {
          text += "\n📭 هنوز هیچ درخواستی ثبت نشده است";
        } else {
          const recentHist = hist.slice(0, 10);
          recentHist.forEach((h, idx) => {
            const dateTime = h.at.slice(0, 19).replace("T", " ");
            const date = dateTime.slice(0, 10);
            const time = dateTime.slice(11, 16);
            const flag = h.country ? flagFromCode(h.country) : "🌍";
            const countryName =
              COUNTRY_NAMES_FA[h.country] || h.country || "نامشخص";

            let typeIcon = "📦";
            let typeName = h.type;
            if (h.type === "dns-ipv4") {
              typeIcon = "🌐";
              typeName = "DNS IPv4";
            } else if (h.type === "dns-ipv6") {
              typeIcon = "🌐";
              typeName = "DNS IPv6";
            } else if (h.type === "wg") {
              typeIcon = "🛡️";
              typeName = "WireGuard";
            }

            text += `\n${idx + 1}. ${flag} <b>${countryName}</b>`;
            text += `\n   ${typeIcon} ${typeName}`;
            text += `\n   📅 ${date} ⏰ ${time}`;
            if (h.value) {
              const val =
                String(h.value).length > 40
                  ? String(h.value).slice(0, 37) + "..."
                  : h.value;
              text += `\n   📍 <code>${val}</code>`;
            }
            if (h.dns) {
              text += `\n   🌐 DNS: <code>${h.dns}</code>`;
            }
            if (h.operator) {
              const opName = OPERATORS[h.operator]
                ? OPERATORS[h.operator].title
                : h.operator;
              text += `\n   📱 ${opName}`;
            }
            text += "\n";
          });

          if (hist.length > 10) {
            text += `\n... و ${hist.length - 10} درخواست دیگر`;
          }
        }

        text += "\n━━━━━━━━━━━━━━━━━━━━";

        await sendMsg(token, chatId, text, {
          reply_markup: mainMenuKeyboard(String(user) === adminId),
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
        await sendMsg(
          token,
          chatId,
          `📊 آمار ربات:\n👥 کاربران: ${us.length}\n🌍 کشورها: ${dns.length}\n📡 مجموع موجودی IP: ${totalStock}`,
          { reply_markup: mainMenuKeyboard(true) },
        );
        return;
      }

      if (data === "menu_reset_quota") {
        if (String(user) !== adminId) return;
        await sendMsg(
          token,
          chatId,
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

        await sendMsg(
          token,
          chatId,
          `✅ عملیات با موفقیت انجام شد!\n\n📊 گزارش:\n👥 تعداد کاربران: ${users.length}\n🔄 محدودیت ریست شده: ${resetCount}\n📢 پیام ارسال شده: ${sentCount}`,
          {
            reply_markup: mainMenuKeyboard(true),
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

        await sendMsg(
          token,
          chatId,
          `${flag} <b>${countryName}</b>\n${stockInfo}\n\nعملیات را انتخاب کنید:`,
          { reply_markup: actionKeyboard(code) },
        );
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
        await sendMsg(
          token,
          chatId,
          `برای ${code} اپراتور مورد نظر را انتخاب کنید:`,
          { reply_markup: operatorKeyboard(code) },
        );
        return;
      }

      // wg flow step 2: op:CODE:OPKEY -> choose DNS
      if (data.startsWith("op:")) {
        const parts = data.split(":");
        const code = parts[1];
        const op = parts[2];
        await sendMsg(
          token,
          chatId,
          `DNS مورد نظر برای اپراتور انتخابی را انتخاب کنید:`,
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
📱 اپراتور: <b>${operatorName}</b>
🌐 DNS: <code>${combinedDns}</code>
📡 موجودی باقی‌مانده: <b>${currentStock}</b>
━━━━━━━━━━━━━━━━━━━━

✅ کانفیگ شما آماده است!`;

        await sendFile(token, chatId, filename, iface, caption);
        if (!isAdmin) await incQuota(env, user, "wg");
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
      await sendMsg(token, chatId, "سلام 👋\nاز دکمه‌ها استفاده کنید:", {
        reply_markup: mainMenuKeyboard(String(user) === adminId),
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
    await sendMsg(token, chatId, "لطفاً از منوی دکمه‌ای استفاده کنید:", {
      reply_markup: mainMenuKeyboard(String(user) === adminId),
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

    // Root: serve index.html
    if (path === "/" && method === "GET") {
      try {
        if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
          const htmlFile = await env.ASSETS.fetch(new Request(request.url));
          return htmlFile;
        }
        // Fallback: read index.html directly (for Node.js environment)
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

    // IPv6 DNS endpoints
    if (path === "/api/dns6" && method === "GET") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const list = await listDNS6(env);
      return jsonResponse(list);
    }

    if (path.startsWith("/api/dns6/")) {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const parts = path.split("/");
      const code = parts[2] || parts[3];
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

    return new Response("Not found", { status: 404 });
  },
};

/* ---------------------- Export default app ---------------------- */
export default app;
