
const TELEGRAM_BASE = (token) => `https://api.telegram.org/bot${token}`;
const ADMIN_ID = 7240662021;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

// === Per-user Daily Quotas & History ===
function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// محاسبه زمان باقی‌مانده تا ریست سهمیه (نیمه‌شب UTC)
function getTimeUntilReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  
  const diff = tomorrow - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${hours} ساعت و ${minutes} دقیقه`;
}

async function getUserQuota(kv, userId, type) {
  const key = `quota:${type}:${userId}:${todayKey()}`;
  const raw = await kv.get(key);
  const count = raw ? Number(raw) || 0 : 0;
  // ادمین محدودیت ندارد
  const limit = Number(userId) === Number(ADMIN_ID) ? 999999 : 3;
  return { count, limit };
}

async function incUserQuota(kv, userId, type) {
  const key = `quota:${type}:${userId}:${todayKey()}`;
  const raw = await kv.get(key);
  const count = raw ? Number(raw) || 0 : 0;
  const next = count + 1;
  await kv.put(key, String(next), { expirationTtl: 86400 });
  return next;
}

async function addUserHistory(kv, userId, type, item) {
  const key = `history:${type}:${userId}`;
  const raw = await kv.get(key);
  const arr = raw ? JSON.parse(raw) : [];
  arr.unshift({ item, ts: Date.now() });
  while (arr.length > 10) arr.pop();
  await kv.put(key, JSON.stringify(arr));
}

async function getUserHistory(kv, userId, type) {
  const key = `history:${type}:${userId}`;
  const raw = await kv.get(key);
  return raw ? JSON.parse(raw) : [];
}

const html = (s) =>
  new Response(s, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });

// ارسال فایل به تلگرام (sendDocument)
async function telegramUpload(env, method, formData) {
  try {
    const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/${method}`, {
      method: 'POST',
      body: formData
    });
    return await res.json();
  } catch (e) {
    console.error('خطا در Telegram Upload:', e);
    return {};
  }
}

// === WireGuard Helpers ===
const WG_MTUS = [1280, 1320, 1360, 1380, 1400, 1420, 1440, 1480, 1500];
const WG_FIXED_DNS = [
  '1.1.1.1','1.0.0.1','8.8.8.8','8.8.4.4','9.9.9.9','10.202.10.10','78.157.42.100','208.67.222.222','208.67.220.220','185.55.226.26','185.55.225.25','185.51.200.2'
];
const OPERATORS = {
  irancell: { title: 'ایرانسل', addresses: ['2.144.0.0/16'] },
  mci: { title: 'همراه اول', addresses: ['5.52.0.0/16'] },
  tci: { title: 'مخابرات', addresses: ['2.176.0.0/15','2.190.0.0/15'] },
  rightel: { title: 'رایتل', addresses: ['37.137.128.0/17','95.162.0.0/17'] },
  shatel: { title: 'شاتل موبایل', addresses: ['94.182.0.0/16','37.148.0.0/18'] }
};

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randName8() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function generateWgFilename() {
  const randomNum = String(randInt(10000, 99999));
  return `JOJO${randomNum}`;
}

function b64(bytes) {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  const base = btoa(bin);
  return base;
}

async function generateWireGuardKeys() {
  // Generate a WireGuard-compatible private key (32 random bytes, base64)
  const rawPriv = new Uint8Array(32);
  crypto.getRandomValues(rawPriv);
  
  // Apply WireGuard key clamping:
  // - Clear the 3 least significant bits of the first byte
  // - Clear the most significant bit of the last byte
  // - Set the second most significant bit of the last byte
  rawPriv[0] &= 248;  // 11111000 - clear bottom 3 bits
  rawPriv[31] &= 127; // 01111111 - clear top bit
  rawPriv[31] |= 64;  // 01000000 - set second top bit
  
  return { privateKey: b64(rawPriv), publicKey: null };
}

function buildWgConf({ privateKey, addresses, dns, mtu, listenPort }) {
  let addrLines = '';
  if (Array.isArray(addresses) && addresses.length > 0) {
    addrLines = `Address = ${addresses.join(', ')}`;
  } else if (addresses) {
    addrLines = `Address = ${addresses}`;
  } else {
    addrLines = '';
  }
  return `[Interface]
PrivateKey = ${privateKey}
ListenPort = ${listenPort}
${addrLines}
DNS = ${dns}
MTU = ${mtu}
`;
}

function buildWireguardOperatorKb() {
  const rows = [];
  const ops = [
    ['irancell','mci'],
    ['tci','rightel'],
    ['shatel']
  ];
  ops.forEach(pair => {
    const row = pair.map(code => ({ text: OPERATORS[code].title, callback_data: `wg_op:${code}` }));
    rows.push(row);
  });
  rows.push([{ text: '🔙 بازگشت', callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}

function buildWireguardDnsKb() {
  const rows = [];
  for (let i = 0; i < WG_FIXED_DNS.length; i += 2) {
    const a = WG_FIXED_DNS[i];
    const b = WG_FIXED_DNS[i+1];
    const row = [{ text: a, callback_data: `wg_dns_fixed:${a}` }];
    if (b) row.push({ text: b, callback_data: `wg_dns_fixed:${b}` });
    rows.push(row);
  }
  rows.push([{ text: '🔙 بازگشت', callback_data: 'wireguard' }]);
  return { inline_keyboard: rows };
}

async function setWgState(kv, userId, state) {
  await kv.put(`wg_state:${userId}`, JSON.stringify(state), { expirationTtl: 900 });
}
async function getWgState(kv, userId) {
  const raw = await kv.get(`wg_state:${userId}`);
  return raw ? JSON.parse(raw) : null;
}
async function clearWgState(kv, userId) { await kv.delete(`wg_state:${userId}`); }

function buildWireguardCountryKb(entries, page = 0) {
  const ITEMS_PER_PAGE = 12;
  const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentEntries = entries.slice(startIndex, endIndex);
  
  const rows = [];
  
  currentEntries.forEach(e => {
    const flag = countryCodeToFlag(e.code);
    const stock = e.stock ?? 0;
    // تبدیل نام کشور به فارسی
    const countryName = ensurePersianCountryName(e.country, e.code);

    let stockEmoji = '🔴';
    if (stock > 10) {
      stockEmoji = '🟢';
    } else if (stock > 5) {
      stockEmoji = '🟡';
    } else if (stock > 0) {
      stockEmoji = '🟡';
    }

    // سه دکمه در یک ردیف - دایره رنگی سمت چپ، تعداد وسط، کشور سمت راست
    rows.push([
      {
        text: `${stockEmoji}`,
        callback_data: `wg_stock:${e.code.toUpperCase()}`
      },
      {
        text: `${stock}`,
        callback_data: `wg_stock:${e.code.toUpperCase()}`
      },
      {
        text: `${flag} ${countryName}`,
        callback_data: `wg_dns_country_pick:${e.code.toUpperCase()}`
      }
    ]);
  });

  // اضافه کردن دکمه‌های صفحه‌بندی
  if (totalPages > 1) {
    const paginationRow = [];

    // دکمه صفحه قبل
    if (page > 0) {
      paginationRow.push({
        text: '⬅️ قبلی',
        callback_data: `wg_page:${page - 1}`
      });
    }

    // نمایش شماره صفحه فعلی
    paginationRow.push({
      text: `${page + 1}/${totalPages}`,
      callback_data: `wg_current_page`
    });

    // دکمه صفحه بعد
    if (page < totalPages - 1) {
      paginationRow.push({
        text: 'بعدی ➡️',
        callback_data: `wg_page:${page + 1}`
      });
    }

    rows.push(paginationRow);
  }

  rows.push([{ text: '🔙 بازگشت', callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}

// تبدیل کد کشور به پرچم
function countryCodeToFlag(code) {
  if (!code || code.length !== 2) return '🌐';
  const A = 0x1F1E6;
  return Array.from(code.toUpperCase())
    .map(c => String.fromCodePoint(A + c.charCodeAt(0) - 65))
    .join('');
}

// انتخاب رندوم از آرایه
function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// === KV Helpers ===
async function listDnsEntries(kv) {
  const res = await kv.list({ prefix: 'dns:' });
  // بارگذاری موازی برای سرعت بیشتر
  const promises = res.keys.map(async k => {
    const raw = await kv.get(k.name);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
    return null;
  });
  const results = await Promise.all(promises);
  const entries = results.filter(e => e !== null);
  entries.sort((a, b) => (a.country || '').localeCompare(b.country || ''));
  return entries;
}

async function getDnsEntry(kv, code) {
  const raw = await kv.get(`dns:${code.toUpperCase()}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putDnsEntry(kv, entry) {
  await kv.put(`dns:${entry.code.toUpperCase()}`, JSON.stringify(entry));
}

async function deleteDnsEntry(kv, code) {
  await kv.delete(`dns:${code.toUpperCase()}`);
}

// حذف یک آدرس از لیست آدرس‌های کشور و بروزرسانی موجودی
async function removeAddressFromEntry(kv, code, address) {
  const entry = await getDnsEntry(kv, code);
  if (!entry) return false;

  if (Array.isArray(entry.addresses)) {
    // حذف آدرس از لیست
    entry.addresses = entry.addresses.filter(addr => addr !== address);
    // بروزرسانی خودکار موجودی بر اساس تعداد آدرس‌های باقیمانده
    entry.stock = entry.addresses.length;
    await putDnsEntry(kv, entry);
    return true;
  }
  return false;
}

async function saveUser(kv, from) {
  if (!from || !from.id) return;
  const data = {
    id: from.id,
    first_name: from.first_name || '',
    last_name: from.last_name || '',
    username: from.username || ''
  };
  await kv.put(`users:${from.id}`, JSON.stringify(data));
}

// انتخاب یک DNS رندوم از لیست
function getRandomDns(entry) {
  if (!Array.isArray(entry.addresses) || entry.addresses.length === 0) {
    return null;
  }
  return entry.addresses[Math.floor(Math.random() * entry.addresses.length)];
}

// Cache برای تشخیص کشور IP ها (برای جلوگیری از درخواست‌های تکراری)
const ipCountryCache = new Map();

// تشخیص کشور از IP با استفاده از API (با timeout و cache برای سرعت بیشتر)
async function detectCountryFromIP(ip) {
  // بررسی cache
  if (ipCountryCache.has(ip)) {
    return ipCountryCache.get(ip);
  }
  
  try {
    // timeout 5 ثانیه برای جلوگیری از تاخیر زیاد
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`https://api.iplocation.net/?cmd=ip-country&ip=${ip}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    const data = await res.json();
    
    if (data && data.country_code2) {
      const result = {
        code: data.country_code2.toUpperCase(),
        name: getCountryNameFromCode(data.country_code2.toUpperCase())
      };
      // ذخیره در cache
      ipCountryCache.set(ip, result);
      return result;
    }
    
    // ذخیره null در cache برای جلوگیری از تلاش مجدد
    ipCountryCache.set(ip, null);
    return null;
  } catch (e) {
    if (e.name === 'AbortError') {
      console.error('Timeout در تشخیص کشور:', ip);
    } else {
      console.error('خطا در تشخیص کشور:', e);
    }
    // ذخیره null در cache
    ipCountryCache.set(ip, null);
    return null;
  }
}

// تبدیل نام کشور به فارسی (اگر انگلیسی باشد از کد آن استفاده می‌کند)
function ensurePersianCountryName(countryName, countryCode) {
  // اگر نام فارسی است (شامل حروف فارسی)، همان را برگردان
  if (/[\u0600-\u06FF]/.test(countryName)) {
    return countryName;
  }
  // اگر انگلیسی است، از کد کشور نام فارسی بگیر
  return getCountryNameFromCode(countryCode);
}

// نقشه نام کشورها به فارسی
function getCountryNameFromCode(code) {
  const map = {
// آمریکا و کانادا
'US': 'ایالات متحده آمریکا', 'CA': 'کانادا', 'MX': 'مکزیک',

// اروپای غربی
'GB': 'بریتانیا', 'DE': 'آلمان', 'FR': 'فرانسه', 'NL': 'هلند', 'BE': 'بلژیک',
'CH': 'سوئیس', 'AT': 'اتریش', 'IE': 'ایرلند', 'LU': 'لوکزامبورگ',
'LI': 'لیختن‌اشتاین', 'MC': 'موناکو',

// اروپای جنوبی
'IT': 'ایتالیا', 'ES': 'اسپانیا', 'PT': 'پرتغال', 'GR': 'یونان', 'MT': 'مالت',
'SM': 'سان مارینو', 'VA': 'واتیکان', 'AD': 'آندورا',

// اروپای شمالی
'SE': 'سوئد', 'NO': 'نروژ', 'DK': 'دانمارک', 'FI': 'فنلاند', 'IS': 'ایسلند',
'EE': 'استونی', 'LV': 'لتونی', 'LT': 'لیتوانی',

// اروپای شرقی
'PL': 'لهستان', 'CZ': 'جمهوری چک', 'SK': 'اسلواکی', 'HU': 'مجارستان', 'RO': 'رومانی',
'BG': 'بلغارستان', 'UA': 'اوکراین', 'BY': 'بلاروس', 'MD': 'مولداوی',
'RS': 'صربستان', 'HR': 'کرواسی', 'SI': 'اسلوونی', 'BA': 'بوسنی و هرزگوین',
'MK': 'مقدونیه شمالی', 'AL': 'آلبانی', 'ME': 'مونته‌نگرو', 'XK': 'کوزوو',

// روسیه و همسایگان
'RU': 'روسیه', 'KZ': 'قزاقستان', 'UZ': 'ازبکستان', 'TM': 'ترکمنستان',
'KG': 'قرقیزستان', 'TJ': 'تاجیکستان', 'AM': 'ارمنستان', 'AZ': 'آذربایجان', 'GE': 'گرجستان',

// خاورمیانه
'IR': 'ایران', 'TR': 'ترکیه', 'AE': 'امارات متحده عربی', 'SA': 'عربستان سعودی', 'IL': 'اسرائیل',
'IQ': 'عراق', 'SY': 'سوریه', 'JO': 'اردن', 'LB': 'لبنان', 'PS': 'فلسطین',
'KW': 'کویت', 'QA': 'قطر', 'BH': 'بحرین', 'OM': 'عمان', 'YE': 'یمن', 'CY': 'قبرس',

// آفریقا
'DZ': 'الجزایر', 'AO': 'آنگولا', 'BJ': 'بنین', 'BW': 'بوتسوانا', 'BF': 'بورکینافاسو',
'BI': 'بوروندی', 'CV': 'کیپ ورد', 'CM': 'کامرون', 'CF': 'جمهوری آفریقای مرکزی',
'TD': 'چاد', 'KM': 'کومور', 'CG': 'کنگو', 'CD': 'جمهوری دموکراتیک کنگو',
'CI': 'ساحل عاج', 'DJ': 'جیبوتی', 'EG': 'مصر', 'GQ': 'گینه استوایی', 'ER': 'اریتره',
'SZ': 'اسواتینی', 'ET': 'اتیوپی', 'GA': 'گابن', 'GM': 'گامبیا', 'GH': 'غنا',
'GN': 'گینه', 'GW': 'گینه بیسائو', 'KE': 'کنیا', 'LS': 'لسوتو', 'LR': 'لیبریا',
'LY': 'لیبی', 'MG': 'ماداگاسکار', 'MW': 'مالاوی', 'ML': 'مالی', 'MR': 'موریتانی',
'MU': 'موریس', 'MA': 'مراکش', 'MZ': 'موزامبیک', 'NA': 'نامیبیا', 'NE': 'نیجر',
'NG': 'نیجریه', 'RW': 'رواندا', 'ST': 'سائوتومه و پرنسیپ', 'SN': 'سنگال',
'SC': 'سیشل', 'SL': 'سیرالئون', 'SO': 'سومالی', 'ZA': 'آفریقای جنوبی',
'SS': 'سودان جنوبی', 'SD': 'سودان', 'TZ': 'تانزانیا', 'TG': 'توگو',
'TN': 'تونس', 'UG': 'اوگاندا', 'ZM': 'زامبیا', 'ZW': 'زیمبابوه',

// آسیای شرقی
'CN': 'چین', 'JP': 'ژاپن', 'KR': 'کره جنوبی', 'KP': 'کره شمالی', 'TW': 'تایوان',
'HK': 'هنگ‌کنگ', 'MO': 'ماکائو', 'MN': 'مغولستان',

// جنوب شرقی آسیا
'TH': 'تایلند', 'VN': 'ویتنام', 'SG': 'سنگاپور', 'MY': 'مالزی', 'ID': 'اندونزی',
'PH': 'فیلیپین', 'MM': 'میانمار', 'KH': 'کامبوج', 'LA': 'لائوس', 'BN': 'برونئی',
'TL': 'تیمور شرقی',

// جنوب آسیا
'IN': 'هند', 'PK': 'پاکستان', 'BD': 'بنگلادش', 'LK': 'سری‌لانکا', 'NP': 'نپال',
'BT': 'بوتان', 'MV': 'مالدیو', 'AF': 'افغانستان',

// آسیای مرکزی و قفقاز
'TM': 'ترکمنستان', 'KG': 'قرقیزستان', 'TJ': 'تاجیکستان', 'KZ': 'قزاقستان', 'UZ': 'ازبکستان',

// اقیانوسیه
'AU': 'استرالیا', 'NZ': 'نیوزیلند', 'FJ': 'فیجی', 'PG': 'پاپوآ گینه نو',
'SB': 'جزایر سلیمان', 'VU': 'وانواتو', 'WS': 'ساموآ', 'TO': 'تونگا', 'KI': 'کیریباتی',
'TV': 'تووالو', 'FM': 'میکرونزی', 'MH': 'جزایر مارشال', 'NR': 'نائورو', 'PW': 'پالائو',

// آمریکای جنوبی
'AR': 'آرژانتین', 'BO': 'بولیوی', 'BR': 'برزیل', 'CL': 'شیلی', 'CO': 'کلمبیا',
'EC': 'اکوادور', 'GY': 'گویان', 'PY': 'پاراگوئه', 'PE': 'پرو', 'SR': 'سورینام',
'UY': 'اروگوئه', 'VE': 'ونزوئلا',

// آمریکای مرکزی و کارائیب
'AG': 'آنتیگوا و باربودا', 'BS': 'باهاما', 'BB': 'باربادوس', 'BZ': 'بلیز',
'CR': 'کاستاریکا', 'CU': 'کوبا', 'DM': 'دومینیکا', 'DO': 'جمهوری دومینیکن',
'GD': 'گرانادا', 'GT': 'گواتمالا', 'HT': 'هائیتی', 'HN': 'هندوراس', 'JM': 'جامائیکا',
'KN': 'سنت کیتس و نویس', 'LC': 'سنت لوسیا', 'VC': 'سنت وینسنت و گرنادین‌ها',
'NI': 'نیکاراگوئه', 'PA': 'پاناما', 'SV': 'السالوادور', 'TT': 'ترینیداد و توباگو',

// سایر (به‌طور رسمی کشور مستقل ولی کوچک)
'QA': 'قطر', 'BH': 'بحرین', 'LU': 'لوکزامبورگ', 'MT': 'مالت', 'MC': 'موناکو',
'LI': 'لیختن‌اشتاین', 'SM': 'سان مارینو', 'VA': 'واتیکان'

  };
  return map[code.toUpperCase()] || code.toUpperCase();
}

// === Web UI ===
async function countUsers(kv) {
  try {
    const res = await kv.list({ prefix: 'users:' });
    return res.keys.length;
  } catch {
    return 0;
  }
}

// محاسبه آمار کاربران
async function getUserStats(kv) {
  try {
    const usersRes = await kv.list({ prefix: 'users:' });
    const totalUsers = usersRes.keys.length;
    
    // محاسبه بیشترین دریافت کننده DNS
    const historyRes = await kv.list({ prefix: 'history:dns:' });
    let topUser = null;
    let maxCount = 0;
    
    for (const key of historyRes.keys) {
      const userId = key.name.replace('history:dns:', '');
      const raw = await kv.get(key.name);
      if (raw) {
        try {
          const history = JSON.parse(raw);
          if (history.length > maxCount) {
            maxCount = history.length;
            // دریافت اطلاعات کاربر
            const userRaw = await kv.get(`users:${userId}`);
            if (userRaw) {
              const userData = JSON.parse(userRaw);
              topUser = {
                id: userId,
                name: userData.first_name || 'کاربر',
                username: userData.username || null,
                count: maxCount
              };
            }
          }
        } catch {}
      }
    }
    
    return {
      totalUsers,
      topUser
    };
  } catch (e) {
    console.error('خطا در محاسبه آمار:', e);
    return {
      totalUsers: 0,
      topUser: null
    };
  }
}

function renderMainPage(entries, userCount) {
  const rows = entries.map(e => {
    const flag = countryCodeToFlag(e.code);
    const count = Array.isArray(e.addresses) ? e.addresses.length : 0;
    const stockColor = (e.stock || 0) > 5 ? '#10b981' : (e.stock || 0) > 0 ? '#f59e0b' : '#ef4444';

    return `
    <div class="dns-card">
      <div class="card-header">
        <div class="country-info">
          <span class="country-flag">${flag}</span>
          <div class="country-details">
            <h3>${escapeHtml(e.country)}</h3>
            <span class="country-code">${escapeHtml(e.code)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-edit" onclick="editCountry('${escapeHtml(e.code)}', '${escapeHtml(e.country)}')" title="ویرایش نام">✏️</button>
          <form method="POST" action="/api/admin/delete-dns" style="display:inline;">
            <input type="hidden" name="code" value="${escapeHtml(e.code)}">
            <button type="submit" class="btn-delete" onclick="return confirm('آیا مطمئن هستید؟')" title="حذف">🗑️</button>
          </form>
        </div>
      </div>
      <div class="card-body">
        <div class="stat-item">
          <span class="stat-label">موجودی:</span>
          <span class="stat-value" style="color: ${stockColor};">${e.stock ?? 0}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">تعداد آدرس:</span>
          <span class="stat-value">${count}</span>
        </div>
      </div>
      <div class="card-footer">
        <details>
          <summary>مشاهده آدرس‌ها</summary>
          <div class="addresses-list">
            ${count > 0 ? e.addresses.map(addr => `<code>${escapeHtml(addr)}</code>`).join('') : '<span class="empty">هیچ آدرسی ثبت نشده</span>'}
          </div>
        </details>
      </div>
    </div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🌐 پنل مدیریت DNS</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>${getWebCss()}</style>
</head>
<body>
<div id="toast-container" class="toast-container"></div>
<div class="container">
  <header class="main-header">
    <div class="header-content">
      <h1>🌐 پنل مدیریت DNS</h1>
      <p class="subtitle">مدیریت و پیکربندی سرورهای DNS در سراسر دنیا</p>
    </div>
    <div class="header-actions">
      <div class="search-box">
        <input id="search" type="text" placeholder="جستجو: نام یا کد کشور..." autocomplete="off">
        <span class="search-icon">🔎</span>
      </div>
      <button id="theme-toggle" class="btn-toggle" aria-label="تغییر تم">🌙</button>
    </div>
    <div class="header-stats">
      <div class="stat-box">
        <span class="stat-number">${entries.length}</span>
        <span class="stat-text">کشور</span>
      </div>
      <div class="stat-box">
        <span class="stat-number">${entries.reduce((sum, e) => sum + (e.stock || 0), 0)}</span>
        <span class="stat-text">موجودی کل</span>
      </div>
      <div class="stat-box">
        <span class="stat-number">${userCount}</span>
        <span class="stat-text">کاربر ربات</span>
      </div>
    </div>
  </header>

  <section class="section">
    <div class="section-header">
      <h2>📋 لیست DNS‌های موجود</h2>
      <span class="badge">${entries.length} مورد</span>
    </div>
    <div id="dns-grid" class="dns-grid">
      ${rows || '<div class="empty-state">هنوز هیچ DNS ثبت نشده است</div>'}
    </div>
  </section>

  <section class="section">
    <div class="section-header">
      <h2>🚀 افزودن گروهی آدرس‌ها (تشخیص خودکار کشور)</h2>
    </div>
    <form method="POST" action="/api/admin/bulk-add" class="dns-form">
      <div class="form-group full-width">
        <label>📡 آدرس‌های IP (هر خط یک آدرس)</label>
        <textarea name="addresses" placeholder="1.1.1.1&#10;8.8.8.8&#10;185.55.226.26" rows="8" required></textarea>
        <small>هر آدرس IP را در یک خط جداگانه وارد کنید. کشور هر آدرس به‌صورت خودکار تشخیص داده می‌شود.</small>
      </div>
      <div id="bulk-progress" class="bulk-progress" style="display:none;">
        <div class="progress-bar"><div class="progress-fill"></div></div>
        <p class="progress-text">در حال پردازش...</p>
      </div>
      <button type="submit" class="btn-submit" id="bulk-submit">🔍 تشخیص و افزودن</button>
    </form>
  </section>

  <section class="section">
    <div class="section-header">
      <h2>🔧 ابزارهای مدیریت</h2>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 20px;">
      <div>
        <button onclick="fixCountryNames()" class="btn-submit" style="background: linear-gradient(135deg, #667eea, #764ba2); width: 100%;">
          🌍 تبدیل تمام اسم کشورها به فارسی
        </button>
        <small style="display: block; margin-top: 10px; color: #64748b;">
          تبدیل اسم‌های انگلیسی به فارسی
        </small>
      </div>
      <div>
        <button onclick="removeDuplicates()" class="btn-submit" style="background: linear-gradient(135deg, #f59e0b, #d97706); width: 100%;">
          🧹 حذف آدرس‌های تکراری
        </button>
        <small style="display: block; margin-top: 10px; color: #64748b;">
          حذف تمام آدرس‌های تکراری از همه کشورها
        </small>
      </div>
      <div>
        <button onclick="downloadJSON()" class="btn-submit" style="background: linear-gradient(135deg, #10b981, #059669); width: 100%;">
          📥 دانلود JSON تمام آدرس‌ها
        </button>
        <small style="display: block; margin-top: 10px; color: #64748b;">
          دانلود فایل JSON شامل تمام کشورها و آدرس‌ها
        </small>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section-header">
      <h2>➕ افزودن DNS جدید</h2>
    </div>
    <form method="POST" action="/api/admin/add-dns" class="dns-form">
      <div class="form-row">
        <div class="form-group">
          <label>🌍 نام کشور (فارسی)</label>
          <input name="country" placeholder="مثال: ایران" required autocomplete="off">
        </div>
        <div class="form-group">
          <label>🔤 کد کشور (2 حرفی)</label>
          <input name="code" placeholder="IR" maxlength="2" required autocomplete="off" style="text-transform:uppercase;">
        </div>
      </div>
      <div class="form-group full-width">
        <label>📡 آدرس‌های DNS (هر خط یک آدرس)</label>
        <textarea name="addresses" placeholder="1.1.1.1&#10;8.8.8.8&#10;8.8.4.4" rows="5" required></textarea>
        <small>هر آدرس DNS را در یک خط جداگانه وارد کنید. موجودی به صورت خودکار بر اساس تعداد آدرس‌ها محاسبه می‌شود.</small>
      </div>
      <button type="submit" class="btn-submit">💾 ذخیره اطلاعات</button>
    </form>
  </section>
</div>

<script>
// Toast Notification System
const Toast = {
  container: null,
  
  init() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  
  show(message, type = 'info', duration = 5000) {
    this.init();
    
    const icons = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };
    
    const titles = {
      success: 'موفقیت',
      error: 'خطا',
      warning: 'هشدار',
      info: 'اطلاعات'
    };
    
    const toast = document.createElement('div');
    toast.className = \`toast \${type}\`;
    
    toast.innerHTML = \`
      <div class="toast-icon">\${icons[type] || icons.info}</div>
      <div class="toast-content">
        <div class="toast-title">\${titles[type] || titles.info}</div>
        <div class="toast-message">\${message}</div>
      </div>
      <button class="toast-close">×</button>
    \`;
    
    this.container.appendChild(toast);
    
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.remove(toast));
    
    if (duration > 0) {
      setTimeout(() => this.remove(toast), duration);
    }
    
    return toast;
  },
  
  remove(toast) {
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  },
  
  success(message, duration) {
    return this.show(message, 'success', duration);
  },
  
  error(message, duration) {
    return this.show(message, 'error', duration);
  },
  
  warning(message, duration) {
    return this.show(message, 'warning', duration);
  },
  
  info(message, duration) {
    return this.show(message, 'info', duration);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const cards = document.querySelectorAll('.dns-card');
  cards.forEach((card, i) => { card.style.animationDelay = (i * 0.05) + 's'; });

  const toggleBtn = document.getElementById('theme-toggle');
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') { document.body.classList.add('dark'); toggleBtn.textContent = '☀️'; }
  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const dark = document.body.classList.contains('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    toggleBtn.textContent = dark ? '☀️' : '🌙';
  });

  const search = document.getElementById('search');
  const grid = document.getElementById('dns-grid');
  if (search && grid) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      grid.querySelectorAll('.dns-card').forEach(card => {
        const name = card.querySelector('.country-details h3')?.textContent?.toLowerCase() || '';
        const code = card.querySelector('.country-code')?.textContent?.toLowerCase() || '';
        const addrs = Array.from(card.querySelectorAll('.addresses-list code')).map(c => c.textContent.toLowerCase()).join(' ');
        const ok = !q || name.includes(q) || code.includes(q) || addrs.includes(q);
        card.style.display = ok ? '' : 'none';
      });
    });
  }

  // Bulk add form with live progress
  const bulkForm = document.querySelector('form[action="/api/admin/bulk-add"]');
  if (bulkForm) {
    bulkForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const progress = document.getElementById('bulk-progress');
      const progressFill = progress.querySelector('.progress-fill');
      const progressText = progress.querySelector('.progress-text');
      const btn = document.getElementById('bulk-submit');
      const textarea = bulkForm.querySelector('textarea[name="addresses"]');
      
      if (!textarea.value.trim()) {
        Toast.warning('لطفاً آدرس‌ها را وارد کنید');
        return;
      }
      
      const addresses = textarea.value.split('\n')
        .map(a => a.trim())
        .filter(a => a && /^\d+\.\d+\.\d+\.\d+$/.test(a));
      
      if (addresses.length === 0) {
        Toast.error('هیچ آدرس IP معتبری یافت نشد');
        return;
      }
      
      progress.style.display = 'block';
      btn.disabled = true;
      btn.textContent = '⏳ در حال پردازش...';
      
      let processed = 0;
      let success = 0;
      let failed = 0;
      const byCountry = {};
      
      // پردازش موازی با batch های 5 تایی برای سرعت بیشتر
      const BATCH_SIZE = 5;
      
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        const percent = Math.round((processed / addresses.length) * 100);
        progressText.textContent = \`⏳ در حال پردازش... (\${processed}/\${addresses.length}) - \${percent}% | ✅ \${success} | ❌ \${failed}\`;
        
        // پردازش همزمان 5 IP
        const promises = batch.map(async ip => {
          try {
            const res = await fetch('/api/admin/bulk-add-single', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ip })
            });
            
            const result = await res.json();
            return { ip, result };
          } catch (e) {
            return { ip, result: { success: false, error: e.message } };
          }
        });
        
        const results = await Promise.all(promises);
        
        // بروزرسانی آمار
        results.forEach(({ ip, result }) => {
          if (result.success) {
            success++;
            if (result.country) {
              byCountry[result.country] = (byCountry[result.country] || 0) + 1;
            }
          } else {
            failed++;
          }
          processed++;
        });
        
        const newPercent = Math.round((processed / addresses.length) * 100);
        progressFill.style.width = newPercent + '%';
        progressText.textContent = \`✨ پردازش شد: \${processed}/\${addresses.length} - \${newPercent}% | ✅ موفق: \${success} | ❌ ناموفق: \${failed}\`;
      }
      
      const summary = Object.entries(byCountry)
        .map(([code, count]) => \`\${code}: \${count}\`)
        .join(', ');
      
      progressText.textContent = \`✅ تکمیل شد! \${processed} آدرس پردازش شد | ✅ موفق: \${success} | ❌ ناموفق: \${failed}\`;
      btn.textContent = '✅ تکمیل شد';
      
      Toast.success(\`✅ \${success} آدرس با موفقیت اضافه شد\\n❌ \${failed} آدرس ناموفق\\n\\n📊 توزیع کشورها:\\n\${summary}\`, 8000);
      setTimeout(() => window.location.href = '/', 2000);
    });
  }
});

function showTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.querySelector(\`[onclick="showTab('\${tabName}')"]\`).classList.add('active');
  document.getElementById(\`\${tabName}-form\`).classList.add('active');
}

async function loadCountryData(code) {
  if (!code) {
    document.getElementById('current-addresses').innerHTML = 'انتخاب کشور را برای مشاهده آدرس‌های فعلی انجام دهید';
    document.getElementById('edit-stock').value = '0';
    return;
  }
  try {
    const response = await fetch('/api/dns');
    const entries = await response.json();
    const country = entries.find(e => e.code.toUpperCase() === code.toUpperCase());
    
    if (country) {
      document.getElementById('edit-stock').value = country.stock || 0;
      
      const addressesDiv = document.getElementById('current-addresses');
      if (country.addresses && country.addresses.length > 0) {
        addressesDiv.innerHTML = country.addresses.map(addr => 
          \`<code>\${addr}</code>\`
        ).join('');
      } else {
        addressesDiv.innerHTML = '<em style="color: #64748b;">هیچ آدرسی برای این کشور ثبت نشده</em>';
      }
    }
  } catch (error) {
    console.error('خطا در بارگذاری اطلاعات:', error);
  }
}

async function fixCountryNames() {
  if (!confirm('آیا مطمئن هستید که می‌خواهید تمام اسم کشورها را به فارسی تبدیل کنید؟')) {
    return;
  }
  
  try {
    const response = await fetch('/api/admin/fix-country-names');
    const result = await response.json();
    
    if (result.success) {
      Toast.success(result.message);
      setTimeout(() => window.location.reload(), 1500);
    } else {
      Toast.error('خطا: ' + result.error);
    }
  } catch (error) {
    Toast.error('خطا در ارتباط با سرور: ' + error.message);
  }
}

async function editCountry(code, currentName) {
  const newName = prompt('نام جدید کشور را وارد کنید:', currentName);
  
  if (!newName || newName === currentName) {
    return;
  }
  
  try {
    const formData = new FormData();
    formData.append('action', 'edit');
    formData.append('existing_code', code);
    formData.append('country', newName);
    formData.append('addresses', ''); // آدرس جدیدی اضافه نمی‌شود
    
    const response = await fetch('/api/admin/add-dns', {
      method: 'POST',
      body: formData
    });
    
    if (response.ok) {
      Toast.success('نام کشور با موفقیت تغییر کرد');
      setTimeout(() => window.location.reload(), 1500);
    } else {
      Toast.error('خطا در تغییر نام کشور');
    }
  } catch (error) {
    Toast.error('خطا: ' + error.message);
  }
}

async function removeDuplicates() {
  if (!confirm('آیا مطمئن هستید که می‌خواهید تمام آدرس‌های تکراری را از همه کشورها حذف کنید؟')) {
    return;
  }
  
  try {
    const response = await fetch('/api/admin/remove-duplicates');
    const result = await response.json();
    
    if (result.success) {
      Toast.success(result.message);
      setTimeout(() => window.location.reload(), 1500);
    } else {
      Toast.error('خطا: ' + result.error);
    }
  } catch (error) {
    Toast.error('خطا در ارتباط با سرور: ' + error.message);
  }
}

async function downloadJSON() {
  try {
    const response = await fetch('/api/dns');
    const data = await response.json();
    
    if (!data || data.length === 0) {
      Toast.warning('هیچ داده‌ای برای دانلود وجود ندارد');
      return;
    }
    
    // ساخت فایل JSON با فرمت زیبا
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // ساخت لینک دانلود
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().split('T')[0];
    a.download = \`dns-addresses-\${date}.json\`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    Toast.success(\`فایل JSON با موفقیت دانلود شد\\n📊 تعداد کشورها: \${data.length}\`);
  } catch (error) {
    Toast.error('خطا در دانلود فایل: ' + error.message);
  }
}
</script>
</body>
</html>`;
}

function getWebCss() {
  return `
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Vazirmatn', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 25%, #f093fb 50%, #ff9a9e 75%, #fecfef 100%);
  background-attachment: fixed;
  min-height: 100vh;
  padding: 20px;
  line-height: 1.6;
  animation: gradientShift 15s ease infinite;
}

@keyframes gradientShift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

.container {
  max-width: 1200px;
  margin: 0 auto;
}

.main-header {
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  padding: 40px;
  margin-bottom: 40px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12), 0 8px 32px rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  position: relative;
  overflow: hidden;
}

.main-header::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.8), transparent);
}

.header-actions {
  margin-top: 16px;
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-box {
  position: relative;
  flex: 1;
}

.search-box input {
  width: 100%;
  padding: 14px 45px 14px 16px;
  border: 2px solid rgba(226, 232, 240, 0.6);
  border-radius: 16px;
  font-size: 14px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;
}

.search-box input:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
  background: rgba(255, 255, 255, 0.95);
}

.search-box .search-icon {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: #64748b;
  pointer-events: none;
  font-size: 16px;
}

.btn-toggle {
  border: none;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  padding: 12px 16px;
  border-radius: 14px;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.3);
  transition: all 0.3s ease;
  font-size: 16px;
  min-width: 50px;
}

.btn-toggle:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
}

.header-content h1 {
  font-size: 36px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 8px;
}

.subtitle {
  color: #64748b;
  font-size: 16px;
}

.header-stats {
  display: flex;
  gap: 20px;
  margin-top: 20px;
}

.stat-box {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
  padding: 20px 30px;
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 140px;
  box-shadow: 0 8px 32px rgba(245, 87, 108, 0.25);
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  position: relative;
  overflow: hidden;
}

.stat-box::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.5s;
}

.stat-box:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: 0 16px 48px rgba(245, 87, 108, 0.35);
}

.stat-box:hover::before {
  left: 100%;
}

.stat-box:nth-child(1) {
  background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  box-shadow: 0 8px 32px rgba(79, 172, 254, 0.25);
}

.stat-box:nth-child(1):hover {
  box-shadow: 0 16px 48px rgba(79, 172, 254, 0.35);
}

.stat-box:nth-child(2) {
  background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
  box-shadow: 0 8px 32px rgba(67, 233, 123, 0.25);
}

.stat-box:nth-child(2):hover {
  box-shadow: 0 16px 48px rgba(67, 233, 123, 0.35);
}

.stat-box:nth-child(3) {
  background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
  box-shadow: 0 8px 32px rgba(250, 112, 154, 0.25);
}

.stat-box:nth-child(3):hover {
  box-shadow: 0 16px 48px rgba(250, 112, 154, 0.35);
}

.stat-number {
  font-size: 28px;
  font-weight: 700;
}

.stat-text {
  font-size: 14px;
  opacity: 0.9;
}

.section {
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(20px);
  border-radius: 24px;
  padding: 35px;
  margin-bottom: 35px;
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.1), 0 6px 20px rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.2);
  position: relative;
  overflow: hidden;
}

.section::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 25px;
  padding-bottom: 15px;
  border-bottom: 2px solid #e2e8f0;
}

.section-header h2 {
  font-size: 24px;
  font-weight: 600;
  color: #1e293b;
}

.badge {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 2px 10px rgba(102, 126, 234, 0.3);
}

.dns-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}

.dns-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  animation: slideIn 0.6s ease forwards;
  opacity: 0;
  border: 1px solid rgba(255, 255, 255, 0.3);
  position: relative;
}

@keyframes slideIn {
  to { opacity: 1; transform: translateY(0) scale(1); }
  from { opacity: 0; transform: translateY(30px) scale(0.95); }
}

.dns-card:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12);
}

.dns-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05));
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.dns-card:hover::after {
  opacity: 1;
}

.card-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.country-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.country-flag {
  font-size: 36px;
}

.country-details h3 {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 2px;
}

.country-code {
  font-size: 13px;
  color: #667eea;
  font-weight: 500;
  background: white;
  padding: 2px 8px;
  border-radius: 6px;
}

.btn-edit {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border: none;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
  margin-left: 8px;
}

.btn-edit:hover {
  background: linear-gradient(135deg, #764ba2, #667eea);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.btn-delete {
  background: linear-gradient(135deg, #ff6b6b, #ee5a6f);
  color: white;
  border: none;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
}

.btn-delete:hover {
  background: linear-gradient(135deg, #ee5a6f, #ff6b6b);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(255, 107, 107, 0.4);
}

.card-body {
  padding: 20px;
  display: flex;
  gap: 20px;
}

.stat-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 13px;
  color: #64748b;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
}

.card-footer {
  border-top: 1px solid #e2e8f0;
  padding: 15px 20px;
}

details summary {
  cursor: pointer;
  font-weight: 500;
  background: linear-gradient(135deg, #667eea, #764ba2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s;
}

details summary:hover {
  transform: translateX(5px);
}

details summary::-webkit-details-marker {
  display: none;
}

details summary::before {
  content: '◀';
  transition: transform 0.2s;
}

details[open] summary::before {
  transform: rotate(-90deg);
}

.addresses-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.addresses-list code {
  background: linear-gradient(135deg, #f8f9ff, #fff5f8);
  padding: 8px 12px;
  border-radius: 8px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  color: #1e293b;
  border-left: 3px solid;
  border-image: linear-gradient(135deg, #667eea, #f093fb) 1;
  transition: all 0.3s;
}

.addresses-list code:hover {
  transform: translateX(5px);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
}

.empty {
  color: #94a3b8;
  font-size: 14px;
  font-style: italic;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #64748b;
  font-size: 16px;
}

.dns-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 15px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group.full-width {
  grid-column: 1 / -1;
}

label {
  font-weight: 500;
  color: #334155;
  font-size: 14px;
}

input, textarea {
  padding: 16px 20px;
  border: 2px solid rgba(226, 232, 240, 0.6);
  border-radius: 16px;
  font-family: 'Vazirmatn', sans-serif;
  font-size: 15px;
  transition: all 0.3s ease;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
}

input:focus, textarea:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
  background: rgba(255, 255, 255, 0.98);
  transform: translateY(-1px);
}

textarea {
  resize: vertical;
  min-height: 100px;
  font-family: 'Courier New', monospace;
}

small {
  color: #64748b;
  font-size: 13px;
}

.btn-submit {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
  padding: 18px 36px;
  border: none;
  border-radius: 16px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  box-shadow: 0 8px 32px rgba(245, 87, 108, 0.3);
  position: relative;
  overflow: hidden;
}

.btn-submit::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.5s;
}

.btn-submit:hover {
  transform: translateY(-3px) scale(1.02);
  box-shadow: 0 12px 40px rgba(245, 87, 108, 0.4);
  background: linear-gradient(135deg, #f5576c 0%, #f093fb 100%);
}

.btn-submit:hover::before {
  left: 100%;
}

.btn-submit:active {
  transform: translateY(-1px) scale(1.01);
}

.form-tabs {
  display: flex;
  margin-bottom: 20px;
  border-bottom: 2px solid #e2e8f0;
}

.tab-btn {
  background: none;
  border: none;
  padding: 12px 24px;
  font-size: 16px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 3px solid transparent;
  font-family: 'Vazirmatn', sans-serif;
}

.tab-btn.active {
  color: #667eea;
  border-bottom-color: #667eea;
}

.tab-btn:hover:not(.active) {
  color: #475569;
  background: #f8fafc;
}

.tab-content {
  display: none;
}

.tab-content.active {
  display: block;
}

select {
  padding: 12px 16px;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  font-family: 'Vazirmatn', sans-serif;
  font-size: 15px;
  transition: all 0.2s;
  background: white;
  cursor: pointer;
}

select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.current-addresses {
  background: #f8fafc;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  padding: 15px;
  min-height: 60px;
  color: #64748b;
  font-size: 14px;
}

.current-addresses code {
  display: block;
  background: white;
  padding: 8px 12px;
  border-radius: 6px;
  margin: 4px 0;
  font-family: 'Courier New', monospace;
  color: #1e293b;
  border-left: 3px solid #667eea;
}

@media (max-width: 768px) {
  .dns-grid {
    grid-template-columns: 1fr;
  }
  
  .form-row {
    grid-template-columns: 1fr;
  }
  
  .header-stats {
    flex-direction: column;
  }
  
  .stat-box {
    width: 100%;
  }

  .form-tabs {
    flex-direction: column;
  }
  
  .tab-btn {
    text-align: center;
    border-bottom: none;
    border-right: 3px solid transparent;
  }
  
  .tab-btn.active {
    border-right-color: #667eea;
    border-bottom-color: transparent;
  }
}

/* Dark mode */
body.dark {
  background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 25%, #16213e 50%, #0f3460 75%, #533483 100%);
  animation: darkGradientShift 20s ease infinite;
}

@keyframes darkGradientShift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

body.dark .main-header,
body.dark .section {
  background: rgba(15, 23, 42, 0.95);
  color: #e2e8f0;
  border-color: rgba(51, 65, 85, 0.3);
}

body.dark .main-header::before,
body.dark .section::before {
  background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.2), transparent);
}

body.dark .header-content h1 {
  color: #f1f5f9;
}

body.dark .subtitle,
body.dark .stat-text,
body.dark .empty,
body.dark small,
body.dark label {
  color: #94a3b8;
}

body.dark .dns-card { 
  background: rgba(15, 23, 42, 0.9);
  border-color: rgba(51, 65, 85, 0.3);
}
body.dark .card-body { color: #e2e8f0; }
body.dark .country-details h3 { color: #f1f5f9; }
body.dark .country-code { background: #1e293b; color: #93c5fd; }
body.dark .card-footer { border-top-color: #334155; }
body.dark .addresses-list code { background: #1e293b; color: #e2e8f0; border-color: #475569; }

body.dark input,
body.dark textarea,
body.dark select,
body.dark .current-addresses,
body.dark .search-box input {
  background: rgba(15, 23, 42, 0.9);
  color: #e2e8f0;
  border-color: rgba(51, 65, 85, 0.6);
}

body.dark input:focus,
body.dark textarea:focus,
body.dark .search-box input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
  background: rgba(15, 23, 42, 0.95);
}

body.dark .search-box .search-icon {
  color: #94a3b8;
}

body.dark .section-header {
  border-bottom-color: #334155;
}

body.dark .bulk-progress {
  background: rgba(15, 23, 42, 0.9);
  border-color: #334155;
}

body.dark .progress-bar {
  background: #334155;
}

.bulk-progress {
  margin: 15px 0;
  padding: 20px;
  background: linear-gradient(135deg, #f8fafc, #ffffff);
  border-radius: 16px;
  border: 2px solid #e2e8f0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.progress-bar {
  width: 100%;
  height: 12px;
  background: #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 12px;
  position: relative;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2, #f093fb);
  background-size: 200% 100%;
  width: 0%;
  transition: width 0.4s ease;
  animation: shimmer 2s infinite;
  position: relative;
}

.progress-fill::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
  animation: shine 1.5s infinite;
}

@keyframes shimmer {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

@keyframes shine {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.progress-text {
  font-size: 14px;
  color: #475569;
  text-align: center;
  margin: 0;
  font-weight: 500;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

body.dark .bulk-progress {
  background: #0f172a;
  border-color: #1f2937;
}

body.dark .progress-bar {
  background: #1f2937;
}

body.dark .progress-text {
  color: #94a3b8;
}

/* Toast Notifications */
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 400px;
}

.toast {
  background: white;
  border-radius: 16px;
  padding: 18px 24px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 14px;
  animation: slideInRight 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
  border-left: 4px solid;
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(10px);
  min-width: 320px;
}

@keyframes slideInRight {
  from {
    transform: translateX(120%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.toast.removing {
  animation: slideOutRight 0.3s ease-out forwards;
}

@keyframes slideOutRight {
  to {
    transform: translateX(120%);
    opacity: 0;
  }
}

.toast::before {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  background: currentColor;
  animation: progress 5s linear forwards;
}

@keyframes progress {
  from { width: 100%; }
  to { width: 0%; }
}

.toast-icon {
  font-size: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
}

.toast-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toast-title {
  font-weight: 600;
  font-size: 15px;
  color: #1e293b;
}

.toast-message {
  font-size: 13px;
  color: #64748b;
  line-height: 1.5;
  white-space: pre-line;
}

.toast-close {
  background: none;
  border: none;
  font-size: 20px;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s;
  flex-shrink: 0;
}

.toast-close:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #64748b;
}

.toast.success {
  border-left-color: #10b981;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(255, 255, 255, 0.98));
}

.toast.success .toast-icon {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.toast.error {
  border-left-color: #ef4444;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.05), rgba(255, 255, 255, 0.98));
}

.toast.error .toast-icon {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.toast.warning {
  border-left-color: #f59e0b;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.05), rgba(255, 255, 255, 0.98));
}

.toast.warning .toast-icon {
  background: rgba(245, 158, 11, 0.1);
  color: #f59e0b;
}

.toast.info {
  border-left-color: #3b82f6;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.05), rgba(255, 255, 255, 0.98));
}

.toast.info .toast-icon {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

/* Dark mode toast styles */
body.dark .toast {
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.98));
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.3);
}

body.dark .toast-title {
  color: #f1f5f9;
}

body.dark .toast-message {
  color: #94a3b8;
}

body.dark .toast-close {
  color: #64748b;
}

body.dark .toast-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #94a3b8;
}

body.dark .toast.success {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(15, 23, 42, 0.98));
}

body.dark .toast.error {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(15, 23, 42, 0.98));
}

body.dark .toast.warning {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(15, 23, 42, 0.98));
}

body.dark .toast.info {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(15, 23, 42, 0.98));
}
`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

// === Telegram Bot ===
async function telegramApi(env, path, body) {
  try {
    const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    console.error('خطا در Telegram API:', e);
    return {};
  }
}

// Cache برای لیست DNS (5 دقیقه)
let dnsListCache = { data: null, timestamp: 0 };
const DNS_CACHE_TTL = 300000; // 5 minutes

async function getCachedDnsList(kv) {
  const now = Date.now();
  if (dnsListCache.data && (now - dnsListCache.timestamp) < DNS_CACHE_TTL) {
    return dnsListCache.data;
  }
  const entries = await listDnsEntries(kv);
  dnsListCache = { data: entries, timestamp: now };
  return entries;
}

function invalidateDnsCache() {
  dnsListCache = { data: null, timestamp: 0 };
}

// ساخت کیبورد اصلی
function buildMainKeyboard(userId) {
  const rows = [];
  // سطر اول: وایرگارد و دی ان اس کنار هم
  rows.push([
    { text: '🛰️ وایرگارد', callback_data: 'wireguard' },
    { text: '🧭 دی ان اس', callback_data: 'show_dns' }
  ]);
  // سطر دوم: حساب کاربری
  rows.push([{ text: '👤 حساب کاربری', callback_data: 'account' }]);
  // سطر سوم: ادمین (در صورت نیاز)
  if (Number(userId) === Number(ADMIN_ID)) {
    rows.push([
      { text: '📢 پیام همگانی', callback_data: 'broadcast' },
      { text: '🎁 ریست محدودیت', callback_data: 'reset_quota' }
    ]);
    rows.push([{ text: '📊 آمار ربات', callback_data: 'stats' }]);
  }
  return { inline_keyboard: rows };
}

// ساخت کیبورد لیست کشورها با صفحه‌بندی
function buildDnsKeyboard(entries, page = 0) {
  const ITEMS_PER_PAGE = 12;
  const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
  const startIndex = page * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentEntries = entries.slice(startIndex, endIndex);

  const rows = [];

  currentEntries.forEach(e => {
    const flag = countryCodeToFlag(e.code);
    const stock = e.stock ?? 0;
    const totalAddresses = Array.isArray(e.addresses) ? e.addresses.length : 0;
    // تبدیل نام کشور به فارسی
    const countryName = ensurePersianCountryName(e.country, e.code);

    let stockEmoji = '🔴';

    if (stock > 10) {
      stockEmoji = '🟢';
    } else if (stock > 5) {
      stockEmoji = '🟡';
    } else if (stock > 0) {
      stockEmoji = '🟡';
    }

    // سه دکمه در یک ردیف - دایره رنگی سمت چپ، تعداد وسط، کشور سمت راست
    rows.push([
      {
        text: `${stockEmoji}`,
        callback_data: `stock:${e.code.toUpperCase()}`
      },
      {
        text: `${stock}`,
        callback_data: `stock:${e.code.toUpperCase()}`
      },
      {
        text: `${flag} ${countryName}`,
        callback_data: `dns:${e.code.toUpperCase()}`
      }
    ]);
  });

  // اضافه کردن دکمه‌های صفحه‌بندی
  if (totalPages > 1) {
    const paginationRow = [];

    // دکمه صفحه قبل
    if (page > 0) {
      paginationRow.push({
        text: '⬅️ قبلی',
        callback_data: `page:${page - 1}`
      });
    }

    // نمایش شماره صفحه فعلی
    paginationRow.push({
      text: `${page + 1}/${totalPages}`,
      callback_data: `current_page`
    });

    // دکمه صفحه بعد
    if (page < totalPages - 1) {
      paginationRow.push({
        text: 'بعدی ➡️',
        callback_data: `page:${page + 1}`
      });
    }

    rows.push(paginationRow);
  }

  rows.push([{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]);

  return { inline_keyboard: rows };
}

// نمایش یک DNS رندوم از کشور انتخابی
async function handleDnsSelection(chat, messageId, code, env, userId) {
  const entry = await getDnsEntry(env.DB, code);

  if (!entry) {
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: '❌ هیچ DNSی برای این کشور یافت نشد.',
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  // تبدیل نام کشور به فارسی (اگر انگلیسی باشد)
  const countryName = ensurePersianCountryName(entry.country, entry.code);

  // بررسی موجودی
  if (!entry.stock || entry.stock <= 0) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} دی ان اس ${countryName}\n\nناموجود. کشور دیگری را انتخاب کنید.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  // بررسی وجود آدرس
  if (!Array.isArray(entry.addresses) || entry.addresses.length === 0) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} دی ان اس ${countryName}\n\nهیچ آدرسی ثبت نشده است.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  // محدودیت روزانه کاربر برای دریافت DNS
  const quota = await getUserQuota(env.DB, userId, 'dns');
  if (quota.count >= quota.limit) {
    const timeLeft = getTimeUntilReset();
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `⏳ محدودیت روزانه دریافت DNS شما به پایان رسیده است.\n\n📊 امروز مجاز: ${quota.limit} مورد\n⏰ زمان باقی‌مانده تا ریست: ${timeLeft}`,
      reply_markup: { inline_keyboard: [[{ text: '👤 حساب کاربری', callback_data: 'account' }],[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  // انتخاب یک DNS رندوم
  const selectedDns = getRandomDns(entry);

  if (!selectedDns) {
    const flag = countryCodeToFlag(entry.code);
    return telegramApi(env, '/editMessageText', {
      chat_id: chat,
      message_id: messageId,
      text: `${flag} دی ان اس ${countryName}\n\nهیچ آدرسی موجود نیست.`,
      reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'show_dns' }]] }
    });
  }

  const flag = countryCodeToFlag(entry.code);

  // افزایش مصرف کاربر و حذف آدرس از لیست
  await incUserQuota(env.DB, userId, 'dns');
  const newQuota = await getUserQuota(env.DB, userId, 'dns');
  await addUserHistory(env.DB, userId, 'dns', `${entry.code}:${selectedDns}`);
  // حذف آدرس استفاده شده از لیست و بروزرسانی خودکار موجودی
  await removeAddressFromEntry(env.DB, code, selectedDns);
  
  // دریافت موجودی جدید
  const updatedEntry = await getDnsEntry(env.DB, code);
  const remainingStock = updatedEntry ? updatedEntry.stock : 0;

  // پیام مینیمال
  let msg = `${flag} دی ان اس ${countryName}\n\n`;
  msg += `آدرس اختصاصی شما:\n\`${selectedDns}\`\n\n`;
  msg += `📊 سهمیه امروز شما: ${newQuota.count}/${newQuota.limit}\n`;
  msg += `📦 موجودی باقی‌مانده ${countryName}: ${remainingStock}\n\n`;
  msg += `🎮 DNS‌های پیشنهادی برای تانل:\n`;
  msg += `• \`178.22.122.100\` - شاتل\n`;
  msg += `• \`185.51.200.2\` - ایرانسل\n`;
  msg += `• \`10.202.10.10\` - رادار\n`;
  msg += `• \`8.8.8.8\` - گوگل\n`;
  msg += `• \`1.1.1.1\` - کلودفلر\n`;
  msg += `• \`4.2.2.4\` - لول 3\n`;
  msg += `• \`78.157.42.100\` - الکترو\n\n`;
  msg += `💡 *نکته مهم:* برای بررسی فیلتر، فقط سرورهای ایران را چک کنید و باید 4/4 باشد.`;

  const checkUrl = `https://check-host.net/check-ping?host=${selectedDns}`;

  return telegramApi(env, '/editMessageText', {
    chat_id: chat,
    message_id: messageId,
    text: msg,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔍 بررسی فیلتر آدرس', url: checkUrl }],
        [{ text: '🔄 دریافت DNS جدید', callback_data: `dns:${code}` }],
        [{ text: '🔙 بازگشت', callback_data: 'show_dns' }]
      ]
    }
  });
}

// مدیریت آپدیت‌های تلگرام
export async function handleUpdate(update, env) {
  try {
    // پیام‌های عادی
    if (update.message) {
      const msg = update.message;
      const chat = msg.chat.id;
      const text = msg.text || '';
      const from = msg.from || {};

      await saveUser(env.DB, from);

      if (Number(from.id) === Number(ADMIN_ID)) {
        const state = await env.DB.get(`admin_state:${ADMIN_ID}`);
        
        // ارسال پیام همگانی (متن، عکس، ویدیو، فایل با کپشن)
        if (state === 'broadcast_waiting') {
          const res = await env.DB.list({ prefix: 'users:' });
          const totalUsers = res.keys.filter(k => {
            const userId = Number(k.name.split(':')[1]);
            return userId && userId !== ADMIN_ID;
          }).length;
          
          let sent = 0;
          let failed = 0;
          
          // ارسال پیام شروع
          const progressMsg = await telegramApi(env, '/sendMessage', { 
            chat_id: chat, 
            text: `⏳ در حال ارسال به ${totalUsers} کاربر...\n\n✅ موفق: 0\n❌ ناموفق: 0`
          });
          const progressMsgId = progressMsg?.result?.message_id;
          
          // بررسی عکس
          if (msg.photo && msg.photo.length > 0) {
            const photo = msg.photo[msg.photo.length - 1]; // بزرگترین سایز
            const caption = msg.caption || '';
            
            for (const k of res.keys) {
              const userId = Number(k.name.split(':')[1]);
              if (!userId || userId === ADMIN_ID) continue;
              try {
                await telegramApi(env, '/sendPhoto', {
                  chat_id: userId,
                  photo: photo.file_id,
                  caption: caption,
                  parse_mode: caption ? 'Markdown' : undefined
                });
                sent++;
                
                // بروزرسانی پیشرفت هر 5 ارسال
                if (progressMsgId && (sent + failed) % 5 === 0) {
                  await telegramApi(env, '/editMessageText', {
                    chat_id: chat,
                    message_id: progressMsgId,
                    text: `⏳ در حال ارسال عکس...\n\n📊 پیشرفت: ${sent + failed}/${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`
                  });
                }
                
                await new Promise(r => setTimeout(r, 50));
              } catch (e) {
                failed++;
                console.error('خطا در ارسال به کاربر:', userId, e);
              }
            }
            await env.DB.delete(`admin_state:${ADMIN_ID}`);
            
            // پیام نهایی
            if (progressMsgId) {
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: progressMsgId,
                text: `✅ *ارسال عکس تکمیل شد!*\n\n📊 کل کاربران: ${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`,
                parse_mode: 'Markdown'
              });
            }
            return;
          }
          // بررسی ویدیو
          else if (msg.video) {
            const caption = msg.caption || '';
            
            for (const k of res.keys) {
              const userId = Number(k.name.split(':')[1]);
              if (!userId || userId === ADMIN_ID) continue;
              try {
                await telegramApi(env, '/sendVideo', {
                  chat_id: userId,
                  video: msg.video.file_id,
                  caption: caption,
                  parse_mode: caption ? 'Markdown' : undefined
                });
                sent++;
                
                if (progressMsgId && (sent + failed) % 5 === 0) {
                  await telegramApi(env, '/editMessageText', {
                    chat_id: chat,
                    message_id: progressMsgId,
                    text: `⏳ در حال ارسال ویدیو...\n\n📊 پیشرفت: ${sent + failed}/${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`
                  });
                }
                
                await new Promise(r => setTimeout(r, 50));
              } catch (e) {
                failed++;
                console.error('خطا در ارسال به کاربر:', userId, e);
              }
            }
            await env.DB.delete(`admin_state:${ADMIN_ID}`);
            
            if (progressMsgId) {
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: progressMsgId,
                text: `✅ *ارسال ویدیو تکمیل شد!*\n\n📊 کل کاربران: ${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`,
                parse_mode: 'Markdown'
              });
            }
            return;
          }
          // بررسی فایل
          else if (msg.document) {
            const caption = msg.caption || '';
            
            for (const k of res.keys) {
              const userId = Number(k.name.split(':')[1]);
              if (!userId || userId === ADMIN_ID) continue;
              try {
                await telegramApi(env, '/sendDocument', {
                  chat_id: userId,
                  document: msg.document.file_id,
                  caption: caption,
                  parse_mode: caption ? 'Markdown' : undefined
                });
                sent++;
                
                if (progressMsgId && (sent + failed) % 5 === 0) {
                  await telegramApi(env, '/editMessageText', {
                    chat_id: chat,
                    message_id: progressMsgId,
                    text: `⏳ در حال ارسال فایل...\n\n📊 پیشرفت: ${sent + failed}/${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`
                  });
                }
                
                await new Promise(r => setTimeout(r, 50));
              } catch (e) {
                failed++;
                console.error('خطا در ارسال به کاربر:', userId, e);
              }
            }
            await env.DB.delete(`admin_state:${ADMIN_ID}`);
            
            if (progressMsgId) {
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: progressMsgId,
                text: `✅ *ارسال فایل تکمیل شد!*\n\n📊 کل کاربران: ${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`,
                parse_mode: 'Markdown'
              });
            }
            return;
          }
          // ارسال متن ساده
          else if (text && !text.startsWith('/start')) {
            for (const k of res.keys) {
              const userId = Number(k.name.split(':')[1]);
              if (!userId || userId === ADMIN_ID) continue;
              try {
                await telegramApi(env, '/sendMessage', { chat_id: userId, text, parse_mode: 'Markdown' });
                sent++;
                
                if (progressMsgId && (sent + failed) % 5 === 0) {
                  await telegramApi(env, '/editMessageText', {
                    chat_id: chat,
                    message_id: progressMsgId,
                    text: `⏳ در حال ارسال پیام...\n\n📊 پیشرفت: ${sent + failed}/${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`
                  });
                }
                
                await new Promise(r => setTimeout(r, 50));
              } catch (e) {
                failed++;
                console.error('خطا در ارسال به کاربر:', userId, e);
              }
            }
            await env.DB.delete(`admin_state:${ADMIN_ID}`);
            
            if (progressMsgId) {
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: progressMsgId,
                text: `✅ *ارسال پیام تکمیل شد!*\n\n📊 کل کاربران: ${totalUsers}\n✅ موفق: ${sent}\n❌ ناموفق: ${failed}`,
                parse_mode: 'Markdown'
              });
            }
            return;
          }
        }
      }

      if (text.startsWith('/start')) {
        const kb = buildMainKeyboard(from.id);
        await telegramApi(env, '/sendMessage', {
          chat_id: chat,
          text: '🌍 *به ربات دسترسی جهانی خوش آمدید*\n\n🛡️ دریافت سرورهای DNS و WireGuard از لوکیشن‌های مختلف جهان\n\n🔻 لطفاً سرویس موردنظر خود را انتخاب کنید:',
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      } else {
        await telegramApi(env, '/sendMessage', {
          chat_id: chat,
          text: '❌ دستور نامعتبر است.\n\nلطفاً /start را ارسال کنید.'
        });
      }
    }

    // Callback Query
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || '';
      const chat = cb.message.chat.id;
      const messageId = cb.message.message_id;
      const from = cb.from || {};

      await saveUser(env.DB, from);

      await telegramApi(env, '/answerCallbackQuery', {
        callback_query_id: cb.id
      });

      // نمایش منوی اصلی
      if (data === 'back_main') {
        const kb = buildMainKeyboard(from.id);
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '🌍 *به ربات دسترسی جهانی خوش آمدید*\n\n🛡️ دریافت سرورهای DNS و WireGuard از لوکیشن‌های مختلف جهان\n\n🔻 لطفاً سرویس موردنظر خود را انتخاب کنید:',
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // نمایش لیست DNS
      else if (data === 'show_dns' || data.startsWith('page:')) {
        const entries = await getCachedDnsList(env.DB);
        if (entries.length === 0) {
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: '❌ *هیچ DNSی موجود نیست*\n\nلطفاً ابتدا از پنل مدیریت، DNS‌های موردنظر را اضافه کنید.',
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]] }
          });
        } else {
          // تعیین شماره صفحه
          const page = data.startsWith('page:') ? parseInt(data.split(':')[1]) || 0 : 0;
          const kb = buildDnsKeyboard(entries, page);
          const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
          const totalPages = Math.ceil(entries.length / 12);
          const currentPage = page + 1;

          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `🌍 *لیست کشورهای موجود*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *${currentPage}/${totalPages}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
            parse_mode: 'Markdown',
            reply_markup: kb
          });
        }
      }

      // انتخاب یک کشور و دریافت DNS رندوم
      else if (data.startsWith('dns:')) {
        const code = data.split(':')[1];
        await handleDnsSelection(chat, messageId, code, env, from.id);
      }

      // کلیک روی موجودی DNS (راهنمایی کاربر)
      else if (data.startsWith('stock:')) {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'برای دریافت آدرس، روی دکمه اسم کشور کلیک کنید',
          show_alert: true
        });
      }

      // کلیک روی موجودی WireGuard (راهنمایی کاربر)
      else if (data.startsWith('wg_stock:')) {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'برای انتخاب کشور، روی دکمه اسم کشور کلیک کنید',
          show_alert: true
        });
      }

      // کلیک روی شماره صفحه فعلی
      else if (data === 'current_page' || data === 'wg_current_page') {
        await telegramApi(env, '/answerCallbackQuery', {
          callback_query_id: cb.id,
          text: 'این صفحه فعلی است',
          show_alert: false
        });
      }

      // وایرگارد: شروع => انتخاب کشور
      else if (data === 'wireguard' || data.startsWith('wg_page:')) {
        await clearWgState(env.DB, from.id);
        const entries = await getCachedDnsList(env.DB);
        
        // تعیین شماره صفحه
        const page = data.startsWith('wg_page:') ? parseInt(data.split(':')[1]) || 0 : 0;
        const kb = buildWireguardCountryKb(entries, page);
        const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
        const totalPages = Math.ceil(entries.length / 12);
        const currentPage = page + 1;
        
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `🛰️ *وایرگارد*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *${currentPage}/${totalPages}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // وایرگارد: انتخاب اپراتور => ساخت فایل (باید DNS و کشور از قبل انتخاب شده باشد)
      else if (data.startsWith('wg_op:')) {
        const opCode = data.split(':')[1];
        if (!OPERATORS[opCode]) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اپراتور نامعتبر', show_alert: true });
        } else {
          const state = await getWgState(env.DB, from.id);
          if (!state || !state.dns || !state.country) {
            await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'ابتدا کشور و دی ان اس را انتخاب کنید', show_alert: true });
          } else {
            // کوئوتا وایرگارد
            const quota = await getUserQuota(env.DB, from.id, 'wg');
            if (quota.count >= quota.limit) {
              const timeLeft = getTimeUntilReset();
              await telegramApi(env, '/editMessageText', {
                chat_id: chat,
                message_id: messageId,
                text: `⏳ سهمیه امروز وایرگارد شما تمام شد\n\n📊 امروز مجاز: ${quota.limit} مورد\n⏰ زمان باقی‌مانده تا ریست: ${timeLeft}`,
                reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]] }
              });
            } else {
              // پاسخ به callback
              await telegramApi(env, '/answerCallbackQuery', { 
                callback_query_id: cb.id, 
                text: 'در حال ساخت فایل...' 
              });

              // ساخت و ارسال فایل
              const keys = await generateWireGuardKeys();
              const addresses = OPERATORS[opCode].addresses;
              const mtu = randItem(WG_MTUS);
              const listenPort = randInt(40000, 60000);
              const dnsList = Array.isArray(state.dns) ? state.dns : [state.dns];
              const conf = buildWgConf({ privateKey: keys.privateKey, addresses, dns: dnsList.join(', '), mtu, listenPort });
              const filename = `${generateWgFilename()}.conf`;
              
              const fd = new FormData();
              fd.append('chat_id', String(chat));
              const captionText = `📄 <b>نام:</b> ${filename}\n• <b>اپراتور:</b> ${OPERATORS[opCode].title}\n• <b>دی ان اس:</b> ${dnsList.join(' , ')}\n• <b>MTU:</b> ${mtu}\n• <b>پورت شنونده:</b> ${listenPort}\n\n💡 <i>نکته:</i> ListenPort بین 40000 تا 60000 باشد.`;
              fd.append('caption', captionText);
              fd.append('parse_mode', 'HTML');
              
              // استفاده از File برای اطمینان از وجود نام فایل در multipart
              const file = new File([conf], filename, { type: 'text/plain' });
              fd.append('document', file);
              
              const uploadRes = await telegramUpload(env, 'sendDocument', fd);
              if (!uploadRes || uploadRes.ok !== true) {
                const err = uploadRes && uploadRes.description ? uploadRes.description : 'ارسال فایل ناموفق بود';
                await telegramApi(env, '/editMessageText', {
                  chat_id: chat,
                  message_id: messageId,
                  text: `❌ ارسال فایل انجام نشد\n\n${err}`,
                  reply_markup: { inline_keyboard: [[{ text: '🔁 تلاش مجدد', callback_data: `wg_op:${opCode}` }], [{ text: '🔙 بازگشت', callback_data: 'wireguard' }]] }
                });
              } else {
                await incUserQuota(env.DB, from.id, 'wg');
                const newQuota = await getUserQuota(env.DB, from.id, 'wg');
                await addUserHistory(env.DB, from.id, 'wg', `${state.country}|${dnsList.join('+')}|${mtu}|${listenPort}`);
                
                // حذف DNS استفاده شده از لیست (اگر از کشور انتخاب شده بود)
                if (dnsList.length > 1) {
                  // DNS دوم (randomDns) را حذف می‌کنیم
                  const usedDns = dnsList[1];
                  await removeAddressFromEntry(env.DB, state.country, usedDns);
                }
                
                await clearWgState(env.DB, from.id);
                
                // پیام موفقیت
                await telegramApi(env, '/editMessageText', {
                  chat_id: chat,
                  message_id: messageId,
                  text: `✅ فایل وایرگارد با موفقیت ارسال شد!\n\n📊 سهمیه امروز شما: ${newQuota.count}/${newQuota.limit}`,
                  parse_mode: 'Markdown',
                  reply_markup: { 
                    inline_keyboard: [
                      [{ text: '🔄 دریافت فایل جدید', callback_data: 'wireguard' }],
                      [{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]
                    ]
                  }
                });
              }
            }
          }
        }
      }

      // وایرگارد: بازگشت از انتخاب DNS به لیست کشورها
      else if (data === 'wireguard_dns_back') {
        const entries = await getCachedDnsList(env.DB);
        const kb = buildWireguardCountryKb(entries, 0);
        const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
        const totalPages = Math.ceil(entries.length / 12);
        
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `🛰️ *وایرگارد*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *1/${totalPages}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // وایرگارد: نمایش کشورها (میانبر)
      else if (data === 'wg_dns_country') {
        const entries = await getCachedDnsList(env.DB);
        const kb = buildWireguardCountryKb(entries, 0);
        const totalStock = entries.reduce((sum, e) => sum + (e.stock || 0), 0);
        const totalPages = Math.ceil(entries.length / 12);
        
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `🛰️ *وایرگارد*\n━━━━━━━━━━━━━━━━━━━━\n\n📊 تعداد کشورها: *${entries.length}*\n📦 موجودی کل: *${totalStock}*\n📄 صفحه: *1/${totalPages}*\n\n💡 کشور موردنظر را انتخاب کنید:\n\n🟢 موجودی زیاد (10+)\n🟡 موجودی متوسط (1-10)\n🔴 ناموجود`,
          parse_mode: 'Markdown',
          reply_markup: kb
        });
      }

      // وایرگارد: انتخاب کشور => ذخیره و نمایش دی ان اس‌های ثابت برای انتخاب
      else if (data.startsWith('wg_dns_country_pick:')) {
        // پاسخ سریع به callback
        await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id });
        
        const code = data.split(':')[1];
        const entry = await getDnsEntry(env.DB, code);
        const flag = countryCodeToFlag(code);
        // تبدیل نام کشور به فارسی
        const countryName = entry ? ensurePersianCountryName(entry.country, entry.code) : getCountryNameFromCode(code);
        
        await setWgState(env.DB, from.id, { country: code, step: 'dns' });
        const kb = buildWireguardDnsKb();
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: `کشور انتخابی: ${flag} ${countryName} (${code})\n\nیکی از دی ان اس‌های زیر را انتخاب کنید:`,
          reply_markup: kb
        });
      }

      // وایرگارد: انتخاب DNS ثابت => اضافه‌کردن یک DNS رندوم از کشور (در صورت وجود) و سپس انتخاب اپراتور
      else if (data.startsWith('wg_dns_fixed:')) {
        const fixedDns = data.split(':')[1];
        const state = await getWgState(env.DB, from.id);
        if (!state || !state.country) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'ابتدا کشور را انتخاب کنید', show_alert: true });
        } else {
          const entry = await getDnsEntry(env.DB, state.country);
          let randomDns = null;
          if (entry) {
            randomDns = getRandomDns(entry);
          }
          const dnsList = randomDns && randomDns !== fixedDns ? [fixedDns, randomDns] : [fixedDns];
          await setWgState(env.DB, from.id, { country: state.country, dns: dnsList, step: 'op' });
          const kb = buildWireguardOperatorKb();
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `اپراتور خود را انتخاب کنید:`,
            reply_markup: kb
          });
        }
      }

      // حساب کاربری
      else if (data === 'account') {
        const dnsQuota = await getUserQuota(env.DB, from.id, 'dns');
        const wgQuota = await getUserQuota(env.DB, from.id, 'wg');
        const dnsHistory = await getUserHistory(env.DB, from.id, 'dns');
        const wgHistory = await getUserHistory(env.DB, from.id, 'wg');

        let msg = '👤 *حساب کاربری*\n';
        msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
        msg += `👋 نام: ${from.first_name || 'کاربر'}\n`;
        if (from.username) msg += `🆔 یوزرنیم: @${from.username}\n`;
        msg += `🔢 شناسه: \`${from.id}\`\n\n`;
        
        msg += '📊 *سهمیه روزانه:*\n';
        msg += `🧭 DNS: ${dnsQuota.count}/${dnsQuota.limit}\n`;
        msg += `🛰️ WireGuard: ${wgQuota.count}/${wgQuota.limit}\n\n`;

        if (dnsHistory.length > 0) {
          msg += '📜 *آخرین دریافت‌های DNS:*\n';
          dnsHistory.slice(0, 5).forEach((h, i) => {
            const parts = h.item.split(':');
            msg += `${i + 1}. ${parts[0]} - \`${parts[1]}\`\n`;
          });
          msg += '\n';
        }

        if (wgHistory.length > 0) {
          msg += '📜 *آخرین فایل‌های WireGuard:*\n';
          wgHistory.slice(0, 3).forEach((h, i) => {
            const parts = h.item.split('|');
            msg += `${i + 1}. ${parts[0]} - MTU: ${parts[2]}\n`;
          });
        }

        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: msg,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به منو اصلی', callback_data: 'back_main' }]] }
        });
      }

      // پیام همگانی (فقط ادمین)
      else if (data === 'broadcast') {
        if (Number(from.id) !== Number(ADMIN_ID)) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          await env.DB.put(`admin_state:${ADMIN_ID}`, 'broadcast_waiting');
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: '📢 *پیام همگانی*\n━━━━━━━━━━━━━━━━━━━━\n\n✍️ پیام خود را ارسال کنید:\n\n📝 *انواع پشتیبانی شده:*\n• متن ساده\n• 🖼️ عکس (با یا بدون کپشن)\n• 🎬 ویدیو (با یا بدون کپشن)\n• 📎 فایل (با یا بدون کپشن)\n\n💡 *نکات:*\n• از Markdown پشتیبانی می‌شود\n• ادمین پیام دریافت نمی‌کند\n• آمار ارسال موفق/ناموفق نمایش داده می‌شود',
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_broadcast' }]] }
          });
        }
      }

      else if (data === 'cancel_broadcast') {
        if (Number(from.id) === Number(ADMIN_ID)) {
          await env.DB.delete(`admin_state:${ADMIN_ID}`);
        }
        await telegramApi(env, '/editMessageText', {
          chat_id: chat,
          message_id: messageId,
          text: '❌ لغو شد',
          reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_main' }]] }
        });
      }

      // ریست محدودیت (فقط ادمین)
      else if (data === 'reset_quota') {
        if (Number(from.id) !== Number(ADMIN_ID)) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: '🎁 *ریست محدودیت کاربران*\n\nآیا مطمئن هستید که می‌خواهید محدودیت روزانه تمام کاربران را صفر کنید؟\n\n⚠️ این عمل قابل بازگشت نیست و به همه کاربران اطلاع داده می‌شود.',
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [
              [{ text: '✅ بله، ریست کن', callback_data: 'confirm_reset_quota' }],
              [{ text: '❌ لغو', callback_data: 'back_main' }]
            ]}
          });
        }
      }

      // نمایش آمار (فقط ادمین)
      else if (data === 'stats') {
        if (Number(from.id) !== Number(ADMIN_ID)) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          const stats = await getUserStats(env.DB);
          
          let msg = '📊 *آمار ربات*\n';
          msg += '━━━━━━━━━━━━━━━━━━━━\n\n';
          msg += `👥 *تعداد کل کاربران:* ${stats.totalUsers}\n\n`;
          
          if (stats.topUser) {
            msg += '🏆 *بیشترین دریافت کننده DNS:*\n';
            msg += `👤 نام: ${stats.topUser.name}\n`;
            if (stats.topUser.username) {
              msg += `🆔 یوزرنیم: @${stats.topUser.username}\n`;
            }
            msg += `🎯 تعداد دریافتی: ${stats.topUser.count} آدرس\n`;
            msg += `🆔 شناسه: \`${stats.topUser.id}\``;
          } else {
            msg += '⚠️ هنوز هیچ کاربری DNS دریافت نکرده است.';
          }
          
          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: msg,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_main' }]] }
          });
        }
      }

      // تایید ریست محدودیت
      else if (data === 'confirm_reset_quota') {
        if (Number(from.id) !== Number(ADMIN_ID)) {
          await telegramApi(env, '/answerCallbackQuery', { callback_query_id: cb.id, text: 'اجازه دسترسی ندارید', show_alert: true });
        } else {
          // حذف تمام کلیدهای quota
          const today = todayKey();
          const dnsKeys = await env.DB.list({ prefix: `quota:dns:` });
          const wgKeys = await env.DB.list({ prefix: `quota:wg:` });
          
          let deleted = 0;
          for (const k of dnsKeys.keys) {
            if (k.name.includes(today)) {
              await env.DB.delete(k.name);
              deleted++;
            }
          }
          for (const k of wgKeys.keys) {
            if (k.name.includes(today)) {
              await env.DB.delete(k.name);
              deleted++;
            }
          }

          // ارسال پیام به همه کاربران
          const users = await env.DB.list({ prefix: 'users:' });
          let notified = 0;
          const giftMsg = '🎁 *خبر خوش!*\n\nمحدودیت روزانه شما توسط مدیریت ربات ریست شد!\n\n✨ می‌توانید مجدداً از خدمات استفاده کنید.\n\n💝 از صبر و همراهی شما سپاسگزاریم.';
          
          for (const k of users.keys) {
            try {
              const userId = k.name.replace('users:', '');
              if (Number(userId) !== Number(ADMIN_ID)) {
                await telegramApi(env, '/sendMessage', {
                  chat_id: userId,
                  text: giftMsg,
                  parse_mode: 'Markdown'
                });
                notified++;
                await new Promise(r => setTimeout(r, 50)); // جلوگیری از rate limit
              }
            } catch (e) {
              console.error('خطا در ارسال به کاربر:', e);
            }
          }

          await telegramApi(env, '/editMessageText', {
            chat_id: chat,
            message_id: messageId,
            text: `✅ *ریست محدودیت انجام شد*\n\n🗑️ ${deleted} محدودیت حذف شد\n📨 ${notified} کاربر مطلع شدند`,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'back_main' }]] }
          });
        }
      }
    }
  } catch (e) {
    console.error('خطا در handleUpdate:', e);
  }
}

// === Fetch Handler ===
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // صفحه اصلی
    if (url.pathname === '/' && req.method === 'GET') {
      const entries = await listDnsEntries(env.DB);
      const userCount = await countUsers(env.DB);
      return html(renderMainPage(entries, userCount));
    }

    // API: لیست DNS‌ها
    if (url.pathname === '/api/dns' && req.method === 'GET') {
      const entries = await listDnsEntries(env.DB);
      return json(entries);
    }

    // API: افزودن/ویرایش DNS
    if (url.pathname === '/api/admin/add-dns' && req.method === 'POST') {
      const form = await req.formData();
      const action = form.get('action') || 'new';

      if (action === 'new') {
        // ایجاد کشور جدید
        const addresses = (form.get('addresses') || '')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);

        const code = (form.get('code') || '').toUpperCase().trim();
        let countryName = (form.get('country') || '').trim();
        
        // اگر نام خالی است، از نام فارسی پیش‌فرض استفاده کن
        if (!countryName && code) {
          countryName = getCountryNameFromCode(code);
        }

        const entry = {
          country: countryName,
          code: code,
          addresses: addresses,
          stock: addresses.length  // موجودی خودکار بر اساس تعداد آدرس‌ها
        };

        if (!entry.country || !entry.code || entry.code.length !== 2) {
          return html('<script>alert("اطلاعات نامعتبر است");setTimeout(() => history.back(), 1500);</script>');
        }

        // بررسی عدم تکرار کد کشور
        const existing = await getDnsEntry(env.DB, entry.code);
        if (existing) {
          return html('<script>alert("این کد کشور قبلاً ثبت شده است");setTimeout(() => history.back(), 1500);</script>');
        }

        await putDnsEntry(env.DB, entry);
        invalidateDnsCache();
      }
      else if (action === 'edit') {
        // ویرایش کشور موجود - اضافه کردن آدرس‌های جدید
        const code = (form.get('existing_code') || '').toUpperCase().trim();
        const newAddresses = (form.get('addresses') || '')
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);
        const newCountryName = form.get('country') ? form.get('country').trim() : null;

        if (!code || code.length !== 2) {
          return html('<script>alert("کد کشور نامعتبر است");setTimeout(() => history.back(), 1500);</script>');
        }

        // دریافت اطلاعات فعلی
        const existing = await getDnsEntry(env.DB, code);
        if (!existing) {
          return html('<script>alert("کشور انتخابی یافت نشد");setTimeout(() => history.back(), 1500);</script>');
        }

        // بروزرسانی نام کشور (در صورت وجود)
        if (newCountryName) {
          existing.country = newCountryName;
        }

        // اضافه کردن آدرس‌های جدید به آدرس‌های موجود
        if (newAddresses.length > 0) {
          const currentAddresses = Array.isArray(existing.addresses) ? existing.addresses : [];
          const combinedAddresses = [...currentAddresses, ...newAddresses];
          // حذف آدرس‌های تکراری
          existing.addresses = [...new Set(combinedAddresses)];
          // بروزرسانی خودکار موجودی بر اساس تعداد کل آدرس‌ها
          existing.stock = existing.addresses.length;
        }

        await putDnsEntry(env.DB, existing);
        invalidateDnsCache(); // بروزرسانی cache
      }

      return html('<script>window.location.href="/";</script>');
    }

    // API: حذف DNS
    if (url.pathname === '/api/admin/delete-dns' && req.method === 'POST') {
      const form = await req.formData();
      const code = form.get('code');

      if (code) {
        await deleteDnsEntry(env.DB, code);
        invalidateDnsCache(); // بروزرسانی cache
      }

      return html('<script>window.location.href="/";</script>');
    }

    // API: افزودن تک IP (برای نمایش پیشرفت زنده)
    if (url.pathname === '/api/admin/bulk-add-single' && req.method === 'POST') {
      try {
        const body = await req.json();
        const ip = body.ip;
        
        if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
          return json({ success: false, error: 'IP نامعتبر' });
        }
        
        const country = await detectCountryFromIP(ip);
        if (!country || !country.code) {
          return json({ success: false, error: 'تشخیص کشور ناموفق' });
        }
        
        const code = country.code.toUpperCase();
        const existing = await getDnsEntry(env.DB, code);
        
        if (existing) {
          // حذف آدرس‌های تکراری از لیست موجود
          existing.addresses = [...new Set(existing.addresses)];
          
          if (!existing.addresses.includes(ip)) {
            existing.addresses.push(ip);
            existing.stock = existing.addresses.length;
            await putDnsEntry(env.DB, existing);
            invalidateDnsCache();
            return json({ success: true, country: code, action: 'updated' });
          } else {
            // آدرس تکراری است، ولی موفقیت برمی‌گردانیم
            return json({ success: true, country: code, action: 'duplicate' });
          }
        } else {
          const newEntry = {
            code: code,
            country: country.name,
            addresses: [ip],
            stock: 1
          };
          await putDnsEntry(env.DB, newEntry);
          invalidateDnsCache();
          return json({ success: true, country: code, action: 'created' });
        }
      } catch (e) {
        return json({ success: false, error: e.message });
      }
    }

    // API: افزودن گروهی با تشخیص خودکار کشور (legacy - برای فرم‌های قدیمی)
    if (url.pathname === '/api/admin/bulk-add' && req.method === 'POST') {
      const form = await req.formData();
      const addressesRaw = form.get('addresses');
      
      if (!addressesRaw) {
        return html('<script>alert("لطفاً آدرس‌ها را وارد کنید");setTimeout(() => history.back(), 1500);</script>');
      }

      const addresses = addressesRaw.split('\n')
        .map(a => a.trim())
        .filter(a => a && /^\d+\.\d+\.\d+\.\d+$/.test(a));

      if (addresses.length === 0) {
        return html('<script>alert("هیچ آدرس IP معتبری یافت نشد");setTimeout(() => history.back(), 1500);</script>');
      }

      const results = { success: 0, failed: 0, byCountry: {} };

      for (const ip of addresses) {
        const country = await detectCountryFromIP(ip);
        if (!country || !country.code) {
          results.failed++;
          continue;
        }

        const code = country.code.toUpperCase();
        const existing = await getDnsEntry(env.DB, code);

        if (existing) {
          // حذف آدرس‌های تکراری از لیست موجود
          existing.addresses = [...new Set(existing.addresses)];
          
          // اضافه کردن به کشور موجود
          if (!existing.addresses.includes(ip)) {
            existing.addresses.push(ip);
            existing.stock = existing.addresses.length;
            await putDnsEntry(env.DB, existing);
            results.success++;
            results.byCountry[code] = (results.byCountry[code] || 0) + 1;
          } else {
            // آدرس تکراری است، ولی به عنوان موفق حساب می‌شود
            results.success++;
          }
        } else {
          // ایجاد کشور جدید
          const newEntry = {
            code: code,
            country: country.name,
            addresses: [ip],
            stock: 1
          };
          await putDnsEntry(env.DB, newEntry);
          results.success++;
          results.byCountry[code] = 1;
        }
      }

      invalidateDnsCache(); // بروزرسانی cache
      const summary = Object.entries(results.byCountry)
        .map(([code, count]) => `${code}: ${count}`)
        .join(', ');
      const msg = `${results.success} آدرس اضافه شد\\n${results.failed} آدرس ناموفق\\n\\n📊 ${summary}`;
      return html(`<script>alert("${msg}");setTimeout(() => window.location.href="/", 1500);</script>`);
    }

    // Webhook تلگرام
    if (url.pathname === '/webhook' && req.method === 'POST') {
      try {
        const update = await req.json();
        await handleUpdate(update, env);
        return json({ ok: true });
      } catch (e) {
        console.error('خطا در webhook:', e);
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // تنظیم webhook
    if (url.pathname === '/api/set-webhook' && req.method === 'GET') {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl })
      });
      const result = await res.json();
      return json(result);
    }

    // حذف webhook
    if (url.pathname === '/api/delete-webhook' && req.method === 'GET') {
      const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/deleteWebhook`, {
        method: 'POST'
      });
      const result = await res.json();
      return json(result);
    }

    // وضعیت webhook
    if (url.pathname === '/api/webhook-info' && req.method === 'GET') {
      const res = await fetch(`${TELEGRAM_BASE(env.BOT_TOKEN)}/getWebhookInfo`);
      const result = await res.json();
      return json(result);
    }

    // تبدیل تمام اسم کشورها به فارسی
    if (url.pathname === '/api/admin/fix-country-names' && req.method === 'GET') {
      try {
        const entries = await listDnsEntries(env.DB);
        let updated = 0;
        let skipped = 0;
        
        for (const entry of entries) {
          const persianName = getCountryNameFromCode(entry.code);
          
          // اگر اسم فعلی با اسم فارسی متفاوت است، بروزرسانی کن
          if (entry.country !== persianName) {
            entry.country = persianName;
            await putDnsEntry(env.DB, entry);
            updated++;
          } else {
            skipped++;
          }
        }
        
        invalidateDnsCache();
        
        return json({
          success: true,
          message: `✅ ${updated} کشور بروزرسانی شد، ${skipped} کشور نیازی به تغییر نداشت`,
          updated,
          skipped,
          total: entries.length
        });
      } catch (e) {
        return json({ success: false, error: e.message }, 500);
      }
    }

    // حذف آدرس‌های تکراری از تمام کشورها
    if (url.pathname === '/api/admin/remove-duplicates' && req.method === 'GET') {
      try {
        const entries = await listDnsEntries(env.DB);
        let totalRemoved = 0;
        let countriesUpdated = 0;
        
        for (const entry of entries) {
          if (Array.isArray(entry.addresses)) {
            const originalCount = entry.addresses.length;
            // حذف تکراری‌ها با استفاده از Set
            entry.addresses = [...new Set(entry.addresses)];
            const newCount = entry.addresses.length;
            const removed = originalCount - newCount;
            
            if (removed > 0) {
              entry.stock = entry.addresses.length;
              await putDnsEntry(env.DB, entry);
              totalRemoved += removed;
              countriesUpdated++;
            }
          }
        }
        
        invalidateDnsCache();
        
        return json({
          success: true,
          message: `✅ ${totalRemoved} آدرس تکراری از ${countriesUpdated} کشور حذف شد`,
          totalRemoved,
          countriesUpdated,
          totalCountries: entries.length
        });
      } catch (e) {
        return json({ success: false, error: e.message }, 500);
      }
    }

    // 404
    return html('<h1>404 - صفحه یافت نشد</h1>');
  }
};
