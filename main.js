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

const COUNTRY_DATA = {
  "AF": { "fa": "افغانستان", "en": "Afghanistan" },
  "AL": { "fa": "آلبانی", "en": "Albania" },
  "DZ": { "fa": "الجزایر", "en": "Algeria" },
  "AD": { "fa": "آندورا", "en": "Andorra" },
  "AO": { "fa": "آنگولا", "en": "Angola" },
  "AG": { "fa": "آنتیگوا و باربودا", "en": "Antigua and Barbuda" },
  "AR": { "fa": "آرژانتین", "en": "Argentina" },
  "AM": { "fa": "ارمنستان", "en": "Armenia" },
  "AU": { "fa": "استرالیا", "en": "Australia" },
  "AT": { "fa": "اتریش", "en": "Austria" },
  "AZ": { "fa": "آذربایجان", "en": "Azerbaijan" },
  "BS": { "fa": "باهاماس", "en": "Bahamas" },
  "BH": { "fa": "بحرین", "en": "Bahrain" },
  "BD": { "fa": "بنگلادش", "en": "Bangladesh" },
  "BB": { "fa": "باربادوس", "en": "Barbados" },
  "BY": { "fa": "بلاروس", "en": "Belarus" },
  "BE": { "fa": "بلژیک", "en": "Belgium" },
  "BZ": { "fa": "بلیز", "en": "Belize" },
  "BJ": { "fa": "بنین", "en": "Benin" },
  "BT": { "fa": "بوتان", "en": "Bhutan" },
  "BO": { "fa": "بولیوی", "en": "Bolivia" },
  "BA": { "fa": "بوسنی و هرزگوین", "en": "Bosnia and Herzegovina" },
  "BW": { "fa": "بوتسوانا", "en": "Botswana" },
  "BR": { "fa": "برزیل", "en": "Brazil" },
  "BN": { "fa": "برونئی", "en": "Brunei" },
  "BG": { "fa": "بلغارستان", "en": "Bulgaria" },
  "BF": { "fa": "بورکینافاسو", "en": "Burkina Faso" },
  "BI": { "fa": "بوروندی", "en": "Burundi" },
  "CV": { "fa": "کیپ ورد", "en": "Cape Verde" },
  "KH": { "fa": "کامبوج", "en": "Cambodia" },
  "CM": { "fa": "کامرون", "en": "Cameroon" },
  "CA": { "fa": "کانادا", "en": "Canada" },
  "CF": { "fa": "جمهوری آفریقای مرکزی", "en": "Central African Republic" },
  "TD": { "fa": "چاد", "en": "Chad" },
  "CL": { "fa": "شیلی", "en": "Chile" },
  "CN": { "fa": "چین", "en": "China" },
  "CO": { "fa": "کلمبیا", "en": "Colombia" },
  "KM": { "fa": "کومور", "en": "Comoros" },
  "CG": { "fa": "کنگو", "en": "Congo" },
  "CD": { "fa": "کنگو دموکراتیک", "en": "DR Congo" },
  "CR": { "fa": "کاستاریکا", "en": "Costa Rica" },
  "HR": { "fa": "کرواسی", "en": "Croatia" },
  "CU": { "fa": "کوبا", "en": "Cuba" },
  "CY": { "fa": "قبرس", "en": "Cyprus" },
  "CZ": { "fa": "چک", "en": "Czechia" },
  "DK": { "fa": "دانمارک", "en": "Denmark" },
  "DJ": { "fa": "جیبوتی", "en": "Djibouti" },
  "DM": { "fa": "دومینیکا", "en": "Dominica" },
  "DO": { "fa": "جمهوری دومینیکن", "en": "Dominican Republic" },
  "EC": { "fa": "اکوادور", "en": "Ecuador" },
  "EG": { "fa": "مصر", "en": "Egypt" },
  "SV": { "fa": "السالوادور", "en": "El Salvador" },
  "GQ": { "fa": "گینه استوایی", "en": "Equatorial Guinea" },
  "ER": { "fa": "اریتره", "en": "Eritrea" },
  "EE": { "fa": "استونی", "en": "Estonia" },
  "SZ": { "fa": "اسواتینی", "en": "Eswatini" },
  "ET": { "fa": "اتیوپی", "en": "Ethiopia" },
  "FJ": { "fa": "فیجی", "en": "Fiji" },
  "FI": { "fa": "فنلاند", "en": "Finland" },
  "FR": { "fa": "فرانسه", "en": "France" },
  "GA": { "fa": "گابن", "en": "Gabon" },
  "GM": { "fa": "گامبیا", "en": "Gambia" },
  "GE": { "fa": "گرجستان", "en": "Georgia" },
  "DE": { "fa": "آلمان", "en": "Germany" },
  "GH": { "fa": "غنا", "en": "Ghana" },
  "GR": { "fa": "یونان", "en": "Greece" },
  "GD": { "fa": "گرنادا", "en": "Grenada" },
  "GT": { "fa": "گواتمالا", "en": "Guatemala" },
  "GN": { "fa": "گینه", "en": "Guinea" },
  "GW": { "fa": "گینه بیسائو", "en": "Guinea-Bissau" },
  "GY": { "fa": "گویان", "en": "Guyana" },
  "HT": { "fa": "هائیتی", "en": "Haiti" },
  "HN": { "fa": "هندوراس", "en": "Honduras" },
  "HU": { "fa": "مجارستان", "en": "Hungary" },
  "IS": { "fa": "ایسلند", "en": "Iceland" },
  "IN": { "fa": "هند", "en": "India" },
  "ID": { "fa": "اندونزی", "en": "Indonesia" },
  "IR": { "fa": "ایران", "en": "Iran" },
  "IQ": { "fa": "عراق", "en": "Iraq" },
  "IE": { "fa": "ایرلند", "en": "Ireland" },
  "IL": { "fa": "اسرائیل", "en": "Israel" },
  "IT": { "fa": "ایتالیا", "en": "Italy" },
  "CI": { "fa": "ساحل عاج", "en": "Ivory Coast" },
  "JM": { "fa": "جامائیکا", "en": "Jamaica" },
  "JP": { "fa": "ژاپن", "en": "Japan" },
  "JO": { "fa": "اردن", "en": "Jordan" },
  "KZ": { "fa": "قزاقستان", "en": "Kazakhstan" },
  "KE": { "fa": "کنیا", "en": "Kenya" },
  "KI": { "fa": "کیریباتی", "en": "Kiribati" },
  "KW": { "fa": "کویت", "en": "Kuwait" },
  "KG": { "fa": "قرقیزستان", "en": "Kyrgyzstan" },
  "LA": { "fa": "لائوس", "en": "Laos" },
  "LV": { "fa": "لتونی", "en": "Latvia" },
  "LB": { "fa": "لبنان", "en": "Lebanon" },
  "LS": { "fa": "لسوتو", "en": "Lesotho" },
  "LR": { "fa": "لیبریا", "en": "Liberia" },
  "LY": { "fa": "لیبی", "en": "Libya" },
  "LI": { "fa": "لیختن‌اشتاین", "en": "Liechtenstein" },
  "LT": { "fa": "لیتوانی", "en": "Lithuania" },
  "LU": { "fa": "لوکزامبورگ", "en": "Luxembourg" },
  "MG": { "fa": "ماداگاسکار", "en": "Madagascar" },
  "MW": { "fa": "مالاوی", "en": "Malawi" },
  "MY": { "fa": "مالزی", "en": "Malaysia" },
  "MV": { "fa": "مالدیو", "en": "Maldives" },
  "ML": { "fa": "مالی", "en": "Mali" },
  "MT": { "fa": "مالت", "en": "Malta" },
  "MH": { "fa": "جزایر مارشال", "en": "Marshall Islands" },
  "MR": { "fa": "موریتانی", "en": "Mauritania" },
  "MU": { "fa": "موریس", "en": "Mauritius" },
  "MX": { "fa": "مکزیک", "en": "Mexico" },
  "FM": { "fa": "میکرونزی", "en": "Micronesia" },
  "MD": { "fa": "مولداوی", "en": "Moldova" },
  "MC": { "fa": "موناکو", "en": "Monaco" },
  "MN": { "fa": "مغولستان", "en": "Mongolia" },
  "ME": { "fa": "مونته‌نگرو", "en": "Montenegro" },
  "MA": { "fa": "مراکش", "en": "Morocco" },
  "MZ": { "fa": "موزامبیک", "en": "Mozambique" },
  "MM": { "fa": "میانمار", "en": "Myanmar" },
  "NA": { "fa": "نامیبیا", "en": "Namibia" },
  "NR": { "fa": "نائورو", "en": "Nauru" },
  "NP": { "fa": "نپال", "en": "Nepal" },
  "NL": { "fa": "هلند", "en": "Netherlands" },
  "NZ": { "fa": "نیوزیلند", "en": "New Zealand" },
  "NI": { "fa": "نیکاراگوئه", "en": "Nicaragua" },
  "NE": { "fa": "نیجر", "en": "Niger" },
  "NG": { "fa": "نیجریه", "en": "Nigeria" },
  "KP": { "fa": "کره شمالی", "en": "North Korea" },
  "MK": { "fa": "مقدونیه شمالی", "en": "North Macedonia" },
  "NO": { "fa": "نروژ", "en": "Norway" },
  "OM": { "fa": "عمان", "en": "Oman" },
  "PK": { "fa": "پاکستان", "en": "Pakistan" },
  "PW": { "fa": "پالائو", "en": "Palau" },
  "PS": { "fa": "فلسطین", "en": "Palestine" },
  "PA": { "fa": "پاناما", "en": "Panama" },
  "PG": { "fa": "پاپوآ گینه نو", "en": "Papua New Guinea" },
  "PY": { "fa": "پاراگوئه", "en": "Paraguay" },
  "PE": { "fa": "پرو", "en": "Peru" },
  "PH": { "fa": "فیلیپین", "en": "Philippines" },
  "PL": { "fa": "لهستان", "en": "Poland" },
  "PT": { "fa": "پرتغال", "en": "Portugal" },
  "QA": { "fa": "قطر", "en": "Qatar" },
  "RO": { "fa": "رومانی", "en": "Romania" },
  "RU": { "fa": "روسیه", "en": "Russia" },
  "RW": { "fa": "رواندا", "en": "Rwanda" },
  "KN": { "fa": "سنت کیتس و نویس", "en": "Saint Kitts and Nevis" },
  "LC": { "fa": "سنت لوسیا", "en": "Saint Lucia" },
  "VC": { "fa": "سنت وینسنت", "en": "Saint Vincent" },
  "WS": { "fa": "ساموآ", "en": "Samoa" },
  "SM": { "fa": "سان مارینو", "en": "San Marino" },
  "ST": { "fa": "سائوتومه و پرنسیپ", "en": "Sao Tome and Principe" },
  "SA": { "fa": "عربستان", "en": "Saudi Arabia" },
  "SN": { "fa": "سنگال", "en": "Senegal" },
  "RS": { "fa": "صربستان", "en": "Serbia" },
  "SC": { "fa": "سیشل", "en": "Seychelles" },
  "SL": { "fa": "سیرالئون", "en": "Sierra Leone" },
  "SG": { "fa": "سنگاپور", "en": "Singapore" },
  "SK": { "fa": "اسلواکی", "en": "Slovakia" },
  "SI": { "fa": "اسلوونی", "en": "Slovenia" },
  "SB": { "fa": "جزایر سلیمان", "en": "Solomon Islands" },
  "SO": { "fa": "سومالی", "en": "Somalia" },
  "ZA": { "fa": "آفریقای جنوبی", "en": "South Africa" },
  "KR": { "fa": "کره جنوبی", "en": "South Korea" },
  "SS": { "fa": "سودان جنوبی", "en": "South Sudan" },
  "ES": { "fa": "اسپانیا", "en": "Spain" },
  "LK": { "fa": "سری‌لانکا", "en": "Sri Lanka" },
  "SD": { "fa": "سودان", "en": "Sudan" },
  "SR": { "fa": "سورینام", "en": "Suriname" },
  "SE": { "fa": "سوئد", "en": "Sweden" },
  "CH": { "fa": "سوئیس", "en": "Switzerland" },
  "SY": { "fa": "سوریه", "en": "Syria" },
  "TJ": { "fa": "تاجیکستان", "en": "Tajikistan" },
  "TZ": { "fa": "تانزانیا", "en": "Tanzania" },
  "TH": { "fa": "تایلند", "en": "Thailand" },
  "TL": { "fa": "تیمور شرقی", "en": "Timor-Leste" },
  "TG": { "fa": "توگو", "en": "Togo" },
  "TO": { "fa": "تونگا", "en": "Tonga" },
  "TT": { "fa": "ترینیداد و توباگو", "en": "Trinidad and Tobago" },
  "TN": { "fa": "تونس", "en": "Tunisia" },
  "TR": { "fa": "ترکیه", "en": "Turkey" },
  "TM": { "fa": "ترکمنستان", "en": "Turkmenistan" },
  "TV": { "fa": "تووالو", "en": "Tuvalu" },
  "UG": { "fa": "اوگاندا", "en": "Uganda" },
  "UA": { "fa": "اوکراین", "en": "Ukraine" },
  "AE": { "fa": "امارات", "en": "UAE" },
  "GB": { "fa": "انگلستان", "en": "UK" },
  "US": { "fa": "آمریکا", "en": "USA" },
  "UY": { "fa": "اروگوئه", "en": "Uruguay" },
  "UZ": { "fa": "ازبکستان", "en": "Uzbekistan" },
  "VU": { "fa": "وانواتو", "en": "Vanuatu" },
  "VA": { "fa": "واتیکان", "en": "Vatican" },
  "VE": { "fa": "ونزوئلا", "en": "Venezuela" },
  "VN": { "fa": "ویتنام", "en": "Vietnam" },
  "YE": { "fa": "یمن", "en": "Yemen" },
  "ZM": { "fa": "زامبیا", "en": "Zambia" },
  "ZW": { "fa": "زیمبابوه", "en": "Zimbabwe" },
  "TW": { "fa": "تایوان", "en": "Taiwan" },
  "HK": { "fa": "هنگ کنگ", "en": "Hong Kong" },
  "MO": { "fa": "ماکائو", "en": "Macau" }
};

function flagFromCode(code) {
  if (!code || code.length !== 2) return '';
  const upperCode = code.toUpperCase();
  return String.fromCodePoint(...upperCode.split('').map(c => c.charCodeAt(0) + 127397));
}

function getCountryNameFA(code) {
  const upperCode = code ? code.toUpperCase() : '';
  if (COUNTRY_DATA[upperCode] && COUNTRY_DATA[upperCode].fa) {
    return COUNTRY_DATA[upperCode].fa;
  }
  return upperCode;
}

function getCountryNameEN(code) {
  const upperCode = code ? code.toUpperCase() : '';
  if (COUNTRY_DATA[upperCode] && COUNTRY_DATA[upperCode].en) {
    return COUNTRY_DATA[upperCode].en;
  }
  return upperCode;
}

// User-selectable operators with their address ranges (IPv4 and IPv6)
const OPERATORS = {
  irancell: { 
    title: "ایرانسل", 
    addresses: ["2.144.0.0/16"],
    addressesV6: ["2001:4860:4860::8888/128", "2001:4860:4860::8844/128"]
  },
  mci: { 
    title: "همراه اول", 
    addresses: ["5.52.0.0/16"],
    addressesV6: ["2606:4700:4700::1111/128", "2606:4700:4700::1001/128"]
  },
  tci: { 
    title: "مخابرات", 
    addresses: ["2.176.0.0/15", "2.190.0.0/15"],
    addressesV6: ["2620:fe::fe/128", "2620:fe::9/128"]
  },
  rightel: { 
    title: "رایتل", 
    addresses: ["37.137.128.0/17", "95.162.0.0/17"],
    addressesV6: ["2001:67c:2b0::1/128", "2001:67c:2b0::2/128"]
  },
  shatel: {
    title: "شاتل موبایل",
    addresses: ["94.182.0.0/16", "37.148.0.0/18"],
    addressesV6: ["2a00:1450:4001::8888/128", "2a00:1450:4001::8844/128"]
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
  const wg6 = parseInt(await env.DB.get(`q:wg6:${id}:${d}`)) || 0;

  // VIP and Pro users get 10 limit, regular users get 3 limit
  const dnsLimit = (isVIP || isPro) ? 10 : 3;
  const wgLimit = (isVIP || isPro) ? 10 : 3;
  // WG IPv6 limit: Pro/VIP: 5/day, Free: 1/day
  const wg6Limit = (isVIP || isPro) ? 5 : 1;

  return {
    dnsUsed: dns,
    wgUsed: wg,
    wg6Used: wg6,
    dnsLeft: Math.max(0, dnsLimit - dns),
    wgLeft: Math.max(0, wgLimit - wg),
    wg6Left: Math.max(0, wg6Limit - wg6),
    wg6Limit: wg6Limit,
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

/* ---------------------- Forced Join System ---------------------- */
async function getForcedJoinChannels(env) {
  const raw = await env.DB.get('settings:forced_join_channels');
  return raw ? JSON.parse(raw) : [];
}

async function addForcedJoinChannel(env, channelId, channelName = '') {
  const channels = await getForcedJoinChannels(env);
  const exists = channels.find(c => c.id === channelId);
  if (exists) return false;
  channels.push({ id: channelId, name: channelName, addedAt: new Date().toISOString() });
  await env.DB.put('settings:forced_join_channels', JSON.stringify(channels));
  return true;
}

async function removeForcedJoinChannel(env, channelId) {
  const channels = await getForcedJoinChannels(env);
  const filtered = channels.filter(c => c.id !== channelId);
  if (filtered.length === channels.length) return false;
  await env.DB.put('settings:forced_join_channels', JSON.stringify(filtered));
  return true;
}

async function updateForcedJoinChannel(env, oldChannelId, newChannelId, newName = '') {
  const channels = await getForcedJoinChannels(env);
  const idx = channels.findIndex(c => c.id === oldChannelId);
  if (idx === -1) return false;
  channels[idx] = { id: newChannelId, name: newName || channels[idx].name, addedAt: channels[idx].addedAt };
  await env.DB.put('settings:forced_join_channels', JSON.stringify(channels));
  return true;
}

async function checkUserMembership(token, userId, channelId) {
  try {
    const res = await tg(token, 'getChatMember', { chat_id: channelId, user_id: userId });
    if (res.ok && res.result) {
      const status = res.result.status;
      return ['member', 'administrator', 'creator'].includes(status);
    }
    return false;
  } catch (e) {
    console.error('checkUserMembership error:', e);
    return false;
  }
}

async function checkAllMemberships(token, userId, env) {
  const channels = await getForcedJoinChannels(env);
  if (!channels || channels.length === 0) return { passed: true, failedChannels: [] };

  const failedChannels = [];
  for (const channel of channels) {
    const isMember = await checkUserMembership(token, userId, channel.id);
    if (!isMember) {
      failedChannels.push(channel);
    }
  }

  return { passed: failedChannels.length === 0, failedChannels };
}

/* ---------------------- Log Channel System ---------------------- */
async function getLogChannel(env) {
  const raw = await env.DB.get('settings:log_channel');
  return raw ? JSON.parse(raw) : null;
}

async function setLogChannel(env, channelId) {
  await env.DB.put('settings:log_channel', JSON.stringify({ id: channelId, setAt: new Date().toISOString() }));
  return true;
}

async function removeLogChannel(env) {
  await env.DB.delete('settings:log_channel');
  return true;
}

function maskUserId(userId) {
  const idStr = String(userId);
  if (idStr.length <= 3) return '***';
  const start = Math.floor((idStr.length - 3) / 2);
  return idStr.slice(0, start) + '***' + idStr.slice(start + 3);
}

function maskAddress(address) {
  if (!address) return '';

  // IPv4: سانسور قسمت 3.4 (دو اکتت آخر)
  const ipv4Pattern = /^(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}$/;
  if (ipv4Pattern.test(address)) {
    return address.replace(ipv4Pattern, '$1.***.***');
  }

  // IPv6: سانسور قسمت میانی
  const ipv6Pattern = /^([0-9a-fA-F:]+)$/;
  if (ipv6Pattern.test(address) && address.includes(':')) {
    const parts = address.split(':');
    if (parts.length >= 4) {
      // سانسور قسمت‌های میانی
      const masked = parts.slice(0, 2).concat(['***', '***']).concat(parts.slice(-2));
      return masked.join(':');
    }
  }

  // اگر فرمت شناخته‌شده نبود، فقط بخشی رو نشون بده
  if (address.length > 10) {
    return address.slice(0, 6) + '***';
  }

  return address;
}

async function logActivity(token, env, userId, actionType, countryCode, actionDetails = '') {
  const logChannel = await getLogChannel(env);
  if (!logChannel || !logChannel.id) return;

  const maskedId = maskUserId(userId);
  const flag = flagFromCode(countryCode);
  const countryName = getCountryNameFA(countryCode) || countryCode;
  const now = new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });

  let actionText = '';
  if (actionType === 'dns-ipv4') {
    actionText = '🌐 DNS IPv4';
  } else if (actionType === 'dns-ipv6') {
    actionText = '🌐 DNS IPv6';
  } else if (actionType === 'wg') {
    actionText = '🛡️ WireGuard';
  } else if (actionType === 'dns-ipv4-vip') {
    actionText = '👑 DNS IPv4 VIP';
  } else if (actionType === 'dns-ipv6-vip') {
    actionText = '👑 DNS IPv6 VIP';
  } else if (actionType === 'wg-vip') {
    actionText = '👑 WireGuard VIP';
  }

  // سانسور آدرس در actionDetails
  let maskedDetails = actionDetails;
  if (actionDetails) {
    // اگر آدرس داخل متن هست، سانسورش کن
    const addressMatch = actionDetails.match(/آدرس[‌ها]*:\s*([^\n]+)/);
    if (addressMatch && addressMatch[1]) {
      const addresses = addressMatch[1].split(',').map(a => a.trim());
      const maskedAddresses = addresses.map(addr => maskAddress(addr)).join(', ');
      maskedDetails = actionDetails.replace(addressMatch[1], maskedAddresses);
    }
  }

  const logMessage = `📋 <b>گزارش فعالیت</b>

👤 کاربر: <code>${maskedId}</code>
${actionText}
${flag} کشور: ${countryName}
${maskedDetails ? `📝 ${maskedDetails}\n` : ''}🕐 زمان: ${now}`;

  try {
    await sendMsg(token, logChannel.id, logMessage);
  } catch (e) {
    console.error('logActivity error:', e);
  }
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
      await env.DB.delete(`q:wg6:${userId}:${d}`);
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
    rows.push([
      { text: "🎁 ریست محدودیت", callback_data: "menu_reset_quota" },
      { text: "⚙️ تنظیمات سرویس", callback_data: "menu_service_settings" },
    ]);
  }
  return { inline_keyboard: rows };
}

function serviceSettingsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📡 کانال‌های جویین اجباری", callback_data: "settings_forced_join" }],
      [{ text: "📝 کانال گزارش", callback_data: "settings_log_channel" }],
      [{ text: "🔙 بازگشت به منو", callback_data: "back" }],
    ],
  };
}

function forcedJoinSettingsKeyboard(channels) {
  const rows = [];
  for (const ch of channels) {
    const displayName = ch.name || ch.id;
    rows.push([
      { text: `📢 ${displayName}`, callback_data: `fjview:${ch.id}` },
      { text: "✏️", callback_data: `fjedit:${ch.id}` },
      { text: "🗑", callback_data: `fjdelete:${ch.id}` },
    ]);
  }
  rows.push([{ text: "➕ افزودن کانال جدید", callback_data: "fj_add" }]);
  rows.push([{ text: "🔙 بازگشت", callback_data: "menu_service_settings" }]);
  return { inline_keyboard: rows };
}

function forcedJoinRequiredKeyboard(failedChannels) {
  const rows = [];
  for (const ch of failedChannels) {
    const displayName = ch.name || `کانال`;
    const channelLink = ch.id.startsWith('@') ? `https://t.me/${ch.id.slice(1)}` : `https://t.me/c/${ch.id.replace('-100', '')}`;
    rows.push([{ text: `📢 عضویت در ${displayName}`, url: channelLink }]);
  }
  rows.push([{ text: "✅ عضو شدم", callback_data: "check_membership" }]);
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
    const countryNameFa = getCountryNameFA(code) || r.country || code;
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
    else if (mode.startsWith("wg6country:")) {
      // Extract parameters from mode and append country code
      callbackData = `${mode}:ct:${code}`;
    }
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

function ipv6OptionKeyboard(code, op, dns, wg6Left = 0, wg6Limit = 1) {
  const hasQuota = wg6Left > 0;
  const quotaText = hasQuota ? `(${wg6Left}/${wg6Limit} باقی‌مانده)` : '(سهمیه تمام شده)';
  const rows = [
    [
      { text: "🌐 فقط IPv4", callback_data: `wgfinal:${code}:${op}:${dns}:no` },
    ],
    [
      { 
        text: hasQuota ? `📡 IPv4 + IPv6 ${quotaText}` : `❌ IPv6 ${quotaText}`, 
        callback_data: hasQuota ? `wg6select:${code}:${op}:${dns}` : `noop:noquota` 
      },
    ],
    [{ text: "🔙 بازگشت", callback_data: `choose:${code}:${op}:${dns}` }],
  ];
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

      // Handle forced join channel add
      const awaitFJAdd = await env.DB.get(`awaitForcedJoinAdd:${adminId}`);
      if (awaitFJAdd) {
        const channelInput = message.text.trim();
        await env.DB.delete(`awaitForcedJoinAdd:${adminId}`);

        // Parse input - could be @username or -100xxx or "name:@channel"
        let channelId = channelInput;
        let channelName = '';

        if (channelInput.includes(':') && !channelInput.startsWith('-')) {
          const parts = channelInput.split(':');
          if (parts[0].trim().toLowerCase() === 'نام') {
            channelName = parts.slice(1).join(':').trim();
            await sendMsg(token, chatId, "❌ لطفاً آیدی کانال را هم وارد کنید.");
            return;
          }
        }

        const added = await addForcedJoinChannel(env, channelId, channelName);
        const channels = await getForcedJoinChannels(env);

        if (added) {
          await sendMsg(token, chatId, `✅ کانال <code>${channelId}</code> با موفقیت اضافه شد.`, {
            reply_markup: forcedJoinSettingsKeyboard(channels),
          });
        } else {
          await sendMsg(token, chatId, `⚠️ این کانال قبلاً اضافه شده است.`, {
            reply_markup: forcedJoinSettingsKeyboard(channels),
          });
        }
        return;
      }

      // Handle forced join channel edit
      const awaitFJEdit = await env.DB.get(`awaitForcedJoinEdit:${adminId}`);
      if (awaitFJEdit) {
        const oldChannelId = awaitFJEdit;
        const newInput = message.text.trim();
        await env.DB.delete(`awaitForcedJoinEdit:${adminId}`);

        let newChannelId = oldChannelId;
        let newName = '';

        // Check if only updating name
        if (newInput.startsWith('نام:')) {
          newName = newInput.slice(4).trim();
        } else {
          newChannelId = newInput;
        }

        const updated = await updateForcedJoinChannel(env, oldChannelId, newChannelId, newName);
        const channels = await getForcedJoinChannels(env);

        if (updated) {
          await sendMsg(token, chatId, `✅ کانال با موفقیت ویرایش شد.`, {
            reply_markup: forcedJoinSettingsKeyboard(channels),
          });
        } else {
          await sendMsg(token, chatId, `❌ خطا در ویرایش کانال.`, {
            reply_markup: forcedJoinSettingsKeyboard(channels),
          });
        }
        return;
      }

      // Handle log channel set
      const awaitLogCh = await env.DB.get(`awaitLogChannel:${adminId}`);
      if (awaitLogCh) {
        const channelId = message.text.trim();
        await env.DB.delete(`awaitLogChannel:${adminId}`);

        await setLogChannel(env, channelId);

        // Send confirmation to the log channel
        try {
          await sendMsg(token, channelId, "✅ <b>کانال گزارش تنظیم شد</b>\n\n📋 از این پس، فعالیت‌های کاربران در این کانال ثبت خواهد شد.\n\n⏰ زمان تنظیم: " + new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }));
          await sendMsg(token, chatId, `✅ کانال گزارش با موفقیت تنظیم شد.\n\nپیام تایید به کانال ارسال شد.`, {
            reply_markup: serviceSettingsKeyboard(),
          });
        } catch (e) {
          await sendMsg(token, chatId, `⚠️ کانال تنظیم شد اما ارسال پیام تایید ناموفق بود.\n\nمطمئن شوید ربات ادمین کانال است.`, {
            reply_markup: serviceSettingsKeyboard(),
          });
        }
        return;
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
            const countryName = getCountryNameFA(h.country) || h.country || "نامشخص";

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
            const countryName = getCountryNameFA(h.country) || h.country || "نامشخص";
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
            const countryName = getCountryNameFA(h.country) || h.country || "نامشخص";
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
        await sendMsg(token, chatId, "📢 <b>پیام همگانی</b>\n\nلطفا متن پیام را ارسال کنید:\n\n💡 پیام شما به تمام کاربران ربات ارسال خواهد شد.");
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

      // Service Settings Menu
      if (data === "menu_service_settings") {
        if (String(user) !== adminId) return;
        await editMsg(token, chatId, callback.message.message_id,
          "⚙️ <b>تنظیمات سرویس</b>\n\nیکی از گزینه‌ها را انتخاب کنید:", {
          reply_markup: serviceSettingsKeyboard(),
        });
        return;
      }

      // Forced Join Settings
      if (data === "settings_forced_join") {
        if (String(user) !== adminId) return;
        const channels = await getForcedJoinChannels(env);
        let text = "📡 <b>تنظیمات جویین اجباری</b>\n\n";
        if (channels.length === 0) {
          text += "هیچ کانالی برای جویین اجباری تنظیم نشده است.\n\n💡 با افزودن کانال، کاربران موظف به عضویت در آن‌ها خواهند بود.";
        } else {
          text += `📊 تعداد کانال‌ها: ${channels.length}\n\n💡 کاربران قبل از استفاده از ربات باید در همه کانال‌ها عضو شوند.`;
        }
        await editMsg(token, chatId, callback.message.message_id, text, {
          reply_markup: forcedJoinSettingsKeyboard(channels),
        });
        return;
      }

      // Add Forced Join Channel
      if (data === "fj_add") {
        if (String(user) !== adminId) return;
        await env.DB.put(`awaitForcedJoinAdd:${adminId}`, "1");
        await sendMsg(token, chatId, 
          "📡 <b>افزودن کانال جویین اجباری</b>\n\nآیدی یا یوزرنیم کانال را ارسال کنید:\n\n💡 مثال:\n<code>@channel_username</code>\nیا\n<code>-1001234567890</code>\n\n⚠️ توجه: ربات باید ادمین کانال باشد.", {
          reply_markup: {
            inline_keyboard: [[{ text: "❌ انصراف", callback_data: "settings_forced_join" }]]
          }
        });
        return;
      }

      // View Forced Join Channel
      if (data.startsWith("fjview:")) {
        if (String(user) !== adminId) return;
        const channelId = data.slice(7);
        const channels = await getForcedJoinChannels(env);
        const channel = channels.find(c => c.id === channelId);
        if (!channel) {
          await sendMsg(token, chatId, "کانال یافت نشد.");
          return;
        }
        const addedDate = channel.addedAt ? new Date(channel.addedAt).toLocaleDateString('fa-IR') : 'نامشخص';
        await editMsg(token, chatId, callback.message.message_id,
          `📢 <b>اطلاعات کانال</b>\n\n🆔 آیدی: <code>${channel.id}</code>\n📝 نام: ${channel.name || 'تنظیم نشده'}\n📅 تاریخ افزودن: ${addedDate}`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✏️ ویرایش", callback_data: `fjedit:${channelId}` }],
              [{ text: "🗑 حذف", callback_data: `fjdelete:${channelId}` }],
              [{ text: "🔙 بازگشت", callback_data: "settings_forced_join" }]
            ]
          }
        });
        return;
      }

      // Edit Forced Join Channel
      if (data.startsWith("fjedit:")) {
        if (String(user) !== adminId) return;
        const channelId = data.slice(7);
        await env.DB.put(`awaitForcedJoinEdit:${adminId}`, channelId);
        await sendMsg(token, chatId,
          `✏️ <b>ویرایش کانال</b>\n\nآیدی یا یوزرنیم جدید کانال را ارسال کنید:\n\nکانال فعلی: <code>${channelId}</code>\n\n💡 برای تغییر فقط نام، با فرمت زیر ارسال کنید:\n<code>نام:نام جدید</code>`, {
          reply_markup: {
            inline_keyboard: [[{ text: "❌ انصراف", callback_data: "settings_forced_join" }]]
          }
        });
        return;
      }

      // Delete Forced Join Channel
      if (data.startsWith("fjdelete:")) {
        if (String(user) !== adminId) return;
        const channelId = data.slice(9);
        await editMsg(token, chatId, callback.message.message_id,
          `⚠️ آیا از حذف کانال <code>${channelId}</code> اطمینان دارید؟`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ بله، حذف کن", callback_data: `fjconfirmdelete:${channelId}` },
                { text: "❌ انصراف", callback_data: "settings_forced_join" }
              ]
            ]
          }
        });
        return;
      }

      // Confirm Delete Forced Join Channel
      if (data.startsWith("fjconfirmdelete:")) {
        if (String(user) !== adminId) return;
        const channelId = data.slice(16);
        await removeForcedJoinChannel(env, channelId);
        const channels = await getForcedJoinChannels(env);
        await editMsg(token, chatId, callback.message.message_id,
          `✅ کانال <code>${channelId}</code> با موفقیت حذف شد.`, {
          reply_markup: forcedJoinSettingsKeyboard(channels),
        });
        return;
      }

      // Log Channel Settings
      if (data === "settings_log_channel") {
        if (String(user) !== adminId) return;
        const logChannel = await getLogChannel(env);
        let text = "📝 <b>تنظیمات کانال گزارش</b>\n\n";
        if (!logChannel) {
          text += "هیچ کانالی برای گزارش تنظیم نشده است.\n\n💡 با تنظیم کانال گزارش، فعالیت‌های کاربران (دریافت DNS و کانفیگ) در کانال ثبت می‌شود.";
        } else {
          const setDate = logChannel.setAt ? new Date(logChannel.setAt).toLocaleDateString('fa-IR') : 'نامشخص';
          text += `✅ کانال گزارش فعال است\n\n🆔 آیدی: <code>${logChannel.id}</code>\n📅 تاریخ تنظیم: ${setDate}`;
        }
        await editMsg(token, chatId, callback.message.message_id, text, {
          reply_markup: {
            inline_keyboard: [
              logChannel 
                ? [{ text: "✏️ تغییر کانال", callback_data: "log_channel_set" }, { text: "🗑 حذف", callback_data: "log_channel_delete" }]
                : [{ text: "➕ تنظیم کانال گزارش", callback_data: "log_channel_set" }],
              [{ text: "🔙 بازگشت", callback_data: "menu_service_settings" }]
            ]
          }
        });
        return;
      }

      // Set Log Channel
      if (data === "log_channel_set") {
        if (String(user) !== adminId) return;
        await env.DB.put(`awaitLogChannel:${adminId}`, "1");
        await sendMsg(token, chatId,
          "📝 <b>تنظیم کانال گزارش</b>\n\nآیدی یا یوزرنیم کانال را ارسال کنید:\n\n💡 مثال:\n<code>@channel_username</code>\nیا\n<code>-1001234567890</code>\n\n⚠️ توجه: ربات باید ادمین کانال باشد تا بتواند پیام ارسال کند.", {
          reply_markup: {
            inline_keyboard: [[{ text: "❌ انصراف", callback_data: "settings_log_channel" }]]
          }
        });
        return;
      }

      // Delete Log Channel
      if (data === "log_channel_delete") {
        if (String(user) !== adminId) return;
        await editMsg(token, chatId, callback.message.message_id,
          "⚠️ آیا از حذف کانال گزارش اطمینان دارید؟\n\nبا حذف، فعالیت‌های کاربران دیگر ثبت نخواهد شد.", {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ بله، حذف کن", callback_data: "log_channel_confirm_delete" },
                { text: "❌ انصراف", callback_data: "settings_log_channel" }
              ]
            ]
          }
        });
        return;
      }

      // Confirm Delete Log Channel
      if (data === "log_channel_confirm_delete") {
        if (String(user) !== adminId) return;
        await removeLogChannel(env);
        await editMsg(token, chatId, callback.message.message_id,
          "✅ کانال گزارش با موفقیت حذف شد.", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "➕ تنظیم کانال جدید", callback_data: "log_channel_set" }],
              [{ text: "🔙 بازگشت", callback_data: "menu_service_settings" }]
            ]
          }
        });
        return;
      }

      // Check Membership (for forced join)
      if (data === "check_membership") {
        const membershipCheck = await checkAllMemberships(token, user, env);
        if (membershipCheck.passed) {
          const userIsVIP = await isVIPUser(env, user);
          await editMsg(token, chatId, callback.message.message_id,
            "✅ عضویت شما تایید شد!\n\nاکنون می‌توانید از ربات استفاده کنید.", {
            reply_markup: mainMenuKeyboard(String(user) === adminId, userIsVIP),
          });
        } else {
          await editMsg(token, chatId, callback.message.message_id,
            "❌ هنوز در همه کانال‌ها عضو نشده‌اید!\n\nلطفاً ابتدا در کانال‌های زیر عضو شوید:", {
            reply_markup: forcedJoinRequiredKeyboard(membershipCheck.failedChannels),
          });
        }
        return;
      }

      // country selected
      if (data.startsWith("ct:")) {
        const code = data.slice(3);
        const flag = flagFromCode(code);
        const countryName = getCountryNameFA(code) || code;
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
        const countryName = getCountryNameFA(code) || rec?.country || code;
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
        // Log VIP activity
        await logActivity(token, env, user, 'dns-ipv4-vip', code, `آدرس: ${addr}`);

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
        const countryName = getCountryNameFA(code) || rec?.country || code;
        const stock = rec?.stock || 0;

        await sendMsg(token, chatId, `${flag} <b>${countryName}</b> - IPv6 VIP\n\n🌐 آدرس‌های اختصاصی شما:\n<code>${addresses[0]}</code>\n<code>${addresses[1]}</code>\n\n📊 موجودی باقی‌مانده: ${stock}\n📈 سهمیه امروز: ${q.dnsUsed + 1}/${VIP_DNS_PER_DAY}`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 بازگشت به منوی VIP", callback_data: "menu_vip" }]]
          }
        });

        await incQuota(env, user, "dns");
        await updateVIPUsage(env, user, "dns");
        // Log VIP activity
        await logActivity(token, env, user, 'dns-ipv6-vip', code, `آدرس‌ها: ${addresses.join(", ")}`);

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
        const countryName = getCountryNameFA(code) || code;
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
        const countryName = getCountryNameFA(code) || code;
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
        const op = parts[2];
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

        const countryNameFa = getCountryNameFA(code) || recBefore?.country || code;
        const countryNameEn = getCountryNameEN(code) || code;
        const operatorName = operatorData ? operatorData.title : op;
        const filename = `VIP_${countryNameEn}_WG.conf`;
        const flag = flagFromCode(code);
        const recAfter = await getVIPDNS(env, code);
        const currentStock = recAfter?.stock || 0;

        const caption = `${flag} <b>${countryNameFa}</b> VIP

━━━━━━━━━━━━━━━━━━━━
📱 اپراتور: ${operatorName}
📡 موجودی: ${currentStock}
📈 سهمیه: ${q.wgUsed + 1}/${VIP_WG_PER_DAY}
━━━━━━━━━━━━━━━━━━━━

✅ کانفیگ VIP شما آماده است!
🚀 تنظیمات بهینه‌سازی شده`;

        await sendFile(token, chatId, filename, iface, caption);
        await incQuota(env, user, "wg");
        await updateVIPUsage(env, user, "wg");
        // Log VIP WG activity
        await logActivity(token, env, user, 'wg-vip', code, `اپراتور: ${operatorName}`);

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
        const countryName = getCountryNameFA(code) || rec?.country || code;
        const stock = rec?.stock || 0;
        const checkUrl = `https://check-host.net/check-ping?host=${addr}`;

        const maxQuota = (q.isVIP || q.isPro) ? 10 : MAX_DNS_PER_DAY;
        const message = `${flag} <b>${countryName}</b> - IPv4

🌐 آدرس اختصاصی شما:
<code>${addr}</code>

📊 موجودی باقی‌مانده ${countryName}: ${stock} عدد
📈 سهمیه امروز شما: ${q.dnsUsed + 1}/${maxQuota}

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
        if (!isAdmin) {
          await incQuota(env, user, "dns");
          // Log activity for non-admin users
          await logActivity(token, env, user, 'dns-ipv4', code, `آدرس: ${addr}`);
        }
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
        const countryNameFa = getCountryNameFA(code) || rec?.country || code;
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
        if (!isAdmin) {
          await incQuota(env, user, "dns");
          // Log activity for non-admin users
          await logActivity(token, env, user, 'dns-ipv6', code, `آدرس‌ها: ${addresses.join(", ")}`);
        }
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
        const countryName = getCountryNameFA(code) || code;
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
        const countryName = getCountryNameFA(code) || code;
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

      // wg step 3: choose:CODE:OP:DNS -> show IPv6 option
      if (data.startsWith("choose:") && !data.includes(":vip")) {
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

        const flag = flagFromCode(code);
        const countryName = getCountryNameFA(code) || code;
        const operatorData = OPERATORS[op];
        const operatorName = operatorData ? operatorData.title : op;
        
        // Show IPv6 option
        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          `${flag} <b>${countryName}</b> - ${operatorName}
DNS: ${dnsValue}

📡 آیا می‌خواهید آدرس IPv6 نیز در کانفیگ اضافه شود؟

💡 <i>نکته: IPv6 می‌تواند در برخی شبکه‌ها عملکرد بهتری داشته باشد</i>

🔢 سهمیه IPv6 امروز: ${q.wg6Left}/${q.wg6Limit}`,
          { reply_markup: ipv6OptionKeyboard(code, op, dnsValue, q.wg6Left, q.wg6Limit) },
        );
        return;
      }

      // wg IPv6 country selection: wg6select:CODE:OP:DNS
      if (data.startsWith("wg6select:")) {
        const parts = data.split(":");
        const ipv4Code = parts[1];
        const op = parts[2];
        const dnsValue = parts.slice(3).join(":");
        
        if (!user) return;
        const q = await getQuota(env, user);
        const isAdmin = String(user) === adminId;
        
        if (!isAdmin && q.wg6Left <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه IPv6 شما به پایان رسیده است.\nباقی‌مانده: ${q.wg6Left}/${q.wg6Limit}`);
          return;
        }

        const list = await listDNS6(env);
        if (!list || list.length === 0) {
          await editMsg(token, chatId, callback.message.message_id, "کشور IPv6 موجود نیست.", {
            reply_markup: { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: `choose:${ipv4Code}:${op}:${dnsValue}` }]] }
          });
          return;
        }

        const mapped = list.map((r) => ({
          code: (r.code || "").toUpperCase(),
          country: r.country || r.code,
          stock: r.stock || 0,
        })).sort((a, b) => b.stock - a.stock);

        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          `📡 <b>انتخاب کشور IPv6</b>\n\nکشور مورد نظر برای IPv6 را انتخاب کنید:\n(سهمیه امروز: ${q.wg6Left}/${q.wg6Limit})\n\n🟢 موجود | 🟡 کم | 🔴 تمام`,
          { reply_markup: countriesKeyboard(mapped, 0, `wg6country:${ipv4Code}:${op}:${dnsValue}`) },
        );
        return;
      }

      // wg IPv6 country selected: wg6country:IPV4CODE:OP:DNS:ct:IPV6CODE
      // این باید قبل از wg6select قرار بگیره تا اول پردازش بشه
      if (data.startsWith("wg6country:") && data.includes(":ct:")) {
        const parts = data.split(":");
        const ipv4Code = parts[1];
        const op = parts[2];
        const dns = parts[3];
        // parts[4] is "ct"
        const ipv6Code = parts[5]; // after "ct:"
        
        // مستقیماً پردازش wgfinal را انجام می‌دهیم
        if (!user) {
          await sendMsg(token, chatId, "کاربر نامشخص");
          return;
        }
        const q = await getQuota(env, user);
        const isAdmin = String(user) === adminId;
        if (!isAdmin && q.wgLeft <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه WireGuard شما به پایان رسیده است.\nباقی‌مانده: ${q.wgLeft}`);
          return;
        }
        if (!isAdmin && q.wg6Left <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه IPv6 شما به پایان رسیده است.\nباقی‌مانده: ${q.wg6Left}/${q.wg6Limit}`);
          return;
        }

        // Get IPv4 data
        const recBefore = await getDNS(env, ipv4Code);
        const locationDns = recBefore && recBefore.addresses && recBefore.addresses.length > 0 ? recBefore.addresses[0] : null;
        const endpoint = await allocateAddress(env, ipv4Code);
        if (!endpoint) {
          await sendMsg(token, chatId, `برای ${ipv4Code} آدرسی موجود نیست.`);
          return;
        }

        // Allocate IPv6 addresses
        const ipv6Addresses = await allocateAddress6(env, ipv6Code);
        if (!ipv6Addresses) {
          await sendMsg(token, chatId, `برای ${ipv6Code} آدرس IPv6 موجود نیست.`);
          return;
        }

        const mtu = pickRandom(WG_MTUS);
        const userDns = dns || pickRandom(WG_FIXED_DNS);
        const priv = randBase64(32);

        let combinedDns = locationDns ? `${locationDns}, ${userDns}` : userDns;
        if (ipv6Addresses && ipv6Addresses.length >= 2) {
          combinedDns += `, ${ipv6Addresses[0]}, ${ipv6Addresses[1]}`;
        }

        const operatorData = OPERATORS[op];
        let operatorAddress = operatorData && operatorData.addresses && operatorData.addresses.length ? pickRandom(operatorData.addresses) : "10.66.66.2/32";
        if (operatorData && operatorData.addressesV6 && operatorData.addressesV6.length) {
          const v6Addr = pickRandom(operatorData.addressesV6);
          operatorAddress += `, ${v6Addr}`;
        }

        const iface = buildWireGuardConfig({
          privateKey: priv,
          address: "10.66.66.2/32",
          mtu,
          dns: combinedDns,
          operatorAddress,
        });

        const countryNameFa = getCountryNameFA(ipv4Code) || recBefore?.country || ipv4Code;
        const countryNameEn = getCountryNameEN(ipv4Code) || ipv4Code;
        const operatorName = operatorData ? operatorData.title : op;
        
        const ipv6Rec = await getDNS6(env, ipv6Code);
        const ipv6CountryNameFa = getCountryNameFA(ipv6Code) || ipv6Rec?.country || ipv6Code;
        const ipv6Flag = flagFromCode(ipv6Code);
        const ipv6CountryInfo = ipv6Code !== ipv4Code ? ` + ${ipv6Flag}${ipv6CountryNameFa}` : '';
        
        const filename = `${countryNameEn}_WG6.conf`;
        const flag = flagFromCode(ipv4Code);
        const recAfter = await getDNS(env, ipv4Code);
        const currentStock = recAfter?.stock || 0;

        const caption = `${flag} <b>${countryNameFa}</b>

━━━━━━━━━━━━━━━━━━━━
📱 اپراتور: ${operatorName}
📡 IPv6: فعال (${ipv6Addresses.length} آدرس${ipv6CountryInfo})
📡 موجودی: ${currentStock}
📈 سهمیه: ${q.wgUsed + 1}/${q.dailyLimit}
━━━━━━━━━━━━━━━━━━━━

✅ کانفیگ شما آماده است!`;

        await sendFile(token, chatId, filename, iface, caption);
        if (!isAdmin) {
          await incQuota(env, user, "wg");
          await incQuota(env, user, "wg6");
          await logActivity(token, env, user, 'wg', ipv4Code, `اپراتور: ${operatorName} (IPv6: ${ipv6Code})`);
        }
        if (q.isVIP) await updateVIPUsage(env, user, "wg");
        try {
          const histKey = `history:${user}`;
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({
            type: "wg6",
            country: ipv4Code,
            ipv6Country: ipv6Code,
            at: new Date().toISOString(),
            endpoint,
            operator: op,
            dns: combinedDns,
            ipv6: ipv6Addresses,
          });
          if (h.length > 20) h.splice(20);
          await env.DB.put(histKey, JSON.stringify(h));
        } catch (e) {
          console.error("history save err", e);
        }
        return;
      }

      // wg IPv6 country selection: wg6select:CODE:OP:DNS
      if (data.startsWith("wg6select:") && !data.startsWith("wg6country:")) {
        const parts = data.split(":");
        const ipv4Code = parts[1];
        const op = parts[2];
        const dnsValue = parts.slice(3).join(":");
        
        if (!user) return;
        const q = await getQuota(env, user);
        const isAdmin = String(user) === adminId;
        
        if (!isAdmin && q.wg6Left <= 0) {
          await sendMsg(token, chatId, `محدودیت روزانه IPv6 شما به پایان رسیده است.\nباقی‌مانده: ${q.wg6Left}/${q.wg6Limit}`);
          return;
        }

        const list = await listDNS6(env);
        if (!list || list.length === 0) {
          await editMsg(token, chatId, callback.message.message_id, "کشور IPv6 موجود نیست.", {
            reply_markup: { inline_keyboard: [[{ text: "🔙 بازگشت", callback_data: `choose:${ipv4Code}:${op}:${dnsValue}` }]] }
          });
          return;
        }

        const mapped = list.map((r) => ({
          code: (r.code || "").toUpperCase(),
          country: r.country || r.code,
          stock: r.stock || 0,
        })).sort((a, b) => b.stock - a.stock);

        await editMsg(
          token,
          chatId,
          callback.message.message_id,
          `📡 <b>انتخاب کشور IPv6</b>\n\nکشور مورد نظر برای IPv6 را انتخاب کنید:\n(سهمیه امروز: ${q.wg6Left}/${q.wg6Limit})\n\n🟢 موجود | 🟡 کم | 🔴 تمام`,
          { reply_markup: countriesKeyboard(mapped, 0, `wg6country:${ipv4Code}:${op}:${dnsValue}`) },
        );
        return;
      }

      // wg final: wgfinal:CODE:OP:DNS:IPV6CODE -> allocate IP, build config, send file
      if (data.startsWith("wgfinal:")) {
        const parts = data.split(":");
        const code = parts[1];
        const op = parts[2];
        const dnsValue = parts[3];
        const ipv6CodeOrFlag = parts[4];
        
        // Check if IPv6 is enabled (either "yes" for old format or country code for new format)
        const includeIPv6 = ipv6CodeOrFlag && ipv6CodeOrFlag !== "no";
        const ipv6CountryCode = (ipv6CodeOrFlag && ipv6CodeOrFlag !== "no" && ipv6CodeOrFlag !== "yes") ? ipv6CodeOrFlag : code;
        
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

        // Check IPv6 quota if requested
        if (includeIPv6 && !isAdmin && q.wg6Left <= 0) {
          await sendMsg(
            token,
            chatId,
            `محدودیت روزانه IPv6 شما به پایان رسیده است.\nباقی‌مانده: ${q.wg6Left}/${q.wg6Limit}`,
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

        // IPv6 allocation if requested (from selected country)
        let ipv6Addresses = null;
        if (includeIPv6) {
          ipv6Addresses = await allocateAddress6(env, ipv6CountryCode);
          if (!ipv6Addresses) {
            // If no IPv6 available, continue without it
            ipv6Addresses = null;
          }
        }

        const mtu = pickRandom(WG_MTUS);
        const userDns = dnsValue || pickRandom(WG_FIXED_DNS);
        const priv = randBase64(32);

        // DNS: location DNS first, then user selected DNS
        let combinedDns = locationDns
          ? `${locationDns}, ${userDns}`
          : userDns;

        // If IPv6 addresses available, add BOTH IPv6 addresses to DNS
        if (ipv6Addresses && ipv6Addresses.length >= 2) {
          combinedDns += `, ${ipv6Addresses[0]}, ${ipv6Addresses[1]}`;
        }

        // Address: از اپراتور انتخابی
        const operatorData = OPERATORS[op];
        let operatorAddress =
          operatorData &&
            operatorData.addresses &&
            operatorData.addresses.length
            ? pickRandom(operatorData.addresses)
            : "10.66.66.2/32";

        // اگر IPv6 فعال باشه، آدرس IPv6 اپراتور رو هم اضافه کن
        if (includeIPv6 && ipv6Addresses && ipv6Addresses.length > 0) {
          // اگه اپراتور IPv6 داره، ازش استفاده کن
          if (operatorData && operatorData.addressesV6 && operatorData.addressesV6.length > 0) {
            const ipv6OpAddr = pickRandom(operatorData.addressesV6);
            operatorAddress = `${operatorAddress}, ${ipv6OpAddr}`;
          } else {
            // در غیر این صورت از آدرس پیشفرض IPv6 استفاده کن
            operatorAddress = `${operatorAddress}, fd00::2/128`;
          }
        }
        // اگر IPv6 فعال نباشه، فقط همون آدرس IPv4 اپراتور باقی میمونه

        const iface = buildInterfaceOnlyConfig({
          privateKey: priv,
          address: "10.66.66.2/32",
          mtu,
          dns: combinedDns,
          operatorAddress,
        });

        // Use English country name for filename
        const countryNameFa =
          getCountryNameFA(code) || recBefore?.country || code;
        const countryNameEn = getCountryNameEN(code) || code;
        const operatorName = operatorData ? operatorData.title : op;
        
        // Get IPv6 country info if different from IPv4
        let ipv6CountryInfo = '';
        if (ipv6Addresses && ipv6CountryCode !== code) {
          const ipv6Rec = await getDNS6(env, ipv6CountryCode);
          const ipv6CountryNameFa = getCountryNameFA(ipv6CountryCode) || ipv6Rec?.country || ipv6CountryCode;
          const ipv6Flag = flagFromCode(ipv6CountryCode);
          ipv6CountryInfo = ` + ${ipv6Flag}${ipv6CountryNameFa}`;
        }
        
        const filename = ipv6Addresses ? `${countryNameEn}_WG6.conf` : `${countryNameEn}_WG.conf`;
        const flag = flagFromCode(code);

        // Get updated stock after allocation
        const recAfter = await getDNS(env, code);
        const currentStock = recAfter?.stock || 0;

        const ipv6Status = ipv6Addresses ? `\n📡 IPv6: فعال (${ipv6Addresses.length} آدرس${ipv6CountryInfo})` : '';
        const caption = `${flag} <b>${countryNameFa}</b>

━━━━━━━━━━━━━━━━━━━━
📱 اپراتور: ${operatorName}${ipv6Status}
📡 موجودی: ${currentStock}
📈 سهمیه: ${q.wgUsed + 1}/${MAX_WG_PER_DAY}
━━━━━━━━━━━━━━━━━━━━

✅ کانفیگ شما آماده است!`;

        await sendFile(token, chatId, filename, iface, caption);
        if (!isAdmin) {
          await incQuota(env, user, "wg");
          if (ipv6Addresses) {
            await incQuota(env, user, "wg6");
          }
          // Log activity for non-admin users
          const activityDetails = ipv6Addresses ? `اپراتور: ${operatorName} (IPv6: ${ipv6CountryCode})` : `اپراتور: ${operatorName}`;
          await logActivity(token, env, user, 'wg', code, activityDetails);
        }
        // Track VIP usage
        if (q.isVIP) await updateVIPUsage(env, user, "wg");
        try {
          const histKey = `history:${user}`;
          const raw = await env.DB.get(histKey);
          const h = raw ? JSON.parse(raw) : [];
          h.unshift({
            type: ipv6Addresses ? "wg6" : "wg",
            country: code,
            ipv6Country: ipv6Addresses ? ipv6CountryCode : null,
            at: new Date().toISOString(),
            endpoint,
            operator: op,
            dns: combinedDns,
            ipv6: ipv6Addresses || null,
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
      // Check forced join for non-admin users
      if (String(user) !== adminId) {
        const membershipCheck = await checkAllMemberships(token, user, env);
        if (!membershipCheck.passed) {
          await sendMsg(token, chatId,
            "👋 سلام!\n\n⚠️ برای استفاده از ربات، ابتدا باید در کانال‌های زیر عضو شوید:", {
            reply_markup: forcedJoinRequiredKeyboard(membershipCheck.failedChannels),
          });
          return;
        }
      }
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
    console.error("Error stack:", err.stack);
    try {
      const chat =
        (update.message && update.message.chat && update.message.chat.id) ||
        (update.callback_query &&
          update.callback_query.message &&
          update.callback_query.message.chat &&
          update.callback_query.message.chat.id);
      if (chat && env.BOT_TOKEN) {
        await sendMsg(
          env.BOT_TOKEN,
          chat,
          "❌ خطایی رخ داد.\n\nجزئیات خطا در لاگ سرور ثبت شده است.",
        );
      }
    } catch (e) {
      console.error("Error sending error message:", e);
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
    const url = new URL(request.url);
    const path = url.pathname;

    // Validate required environment variables based on endpoint
    // BOT_TOKEN is only required for /webhook (Telegram bot functionality)
    // ADMIN_ID is required for admin API endpoints
    if (path === "/webhook" && !env.BOT_TOKEN) {
      console.error("CRITICAL: BOT_TOKEN is required for webhook endpoint");
      return new Response(
        "Service unavailable: BOT_TOKEN is not configured",
        { status: 503 }
      );
    }

    if (path.startsWith("/api/") && !env.ADMIN_ID) {
      console.error("CRITICAL: ADMIN_ID is required for API endpoints");
      return new Response(
        "Service unavailable: ADMIN_ID is not configured",
        { status: 503 }
      );
    }

    const method = request.method.toUpperCase();

    // Root: serve index.html
    if (path === "/" && method === "GET") {
      try {
        // Use ASSETS (Cloudflare Pages)
        if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
          return env.ASSETS.fetch(request);
        }
        return new Response("index.html not found", { status: 404 });
      } catch (e) {
        console.error("Error serving index.html:", e);
        return new Response("index.html not found", { status: 404 });
      }
    }

    // Serve countries.json
    if (path === "/countries.json" && method === "GET") {
      try {
        // Use ASSETS (Cloudflare Pages)
        if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
          return env.ASSETS.fetch(request);
        }
        return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
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

    // DNS6 rename endpoint
    if (path.startsWith("/api/dns6/rename/") && method === "POST") {
      if (!isAdminReq(request, env))
        return new Response("forbidden", { status: 403 });
      const parts = path.split("/");
      const oldCode = parts[4];
      const newCode = parts[5];
      if (!oldCode || !newCode) return new Response("bad request", { status: 400 });

      try {
        const body = await request.json();
        const rec = await getDNS6(env, oldCode);
        if (!rec) return new Response("not found", { status: 404 });

        // Update record with new code
        rec.code = newCode.toUpperCase();
        if (body.country) rec.country = body.country;
        
        // Generate new flag
        if (newCode.length === 2) {
          rec.flag = String.fromCodePoint(...newCode.toUpperCase().split('').map(c => c.charCodeAt(0) + 127397));
        }

        // Delete old record and create new one
        await deleteDNS6(env, oldCode);
        await updateDNS6(env, newCode, rec);

        return jsonResponse({ ok: true });
      } catch (e) {
        return jsonResponse({ error: "invalid json" }, 400);
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
