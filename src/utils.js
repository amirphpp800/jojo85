// === Utility Functions ===

// Response Helpers
export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

export const html = (s) =>
  new Response(s, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });

// Random Generators
export function randInt(min, max) { 
  return Math.floor(Math.random() * (max - min + 1)) + min; 
}

export function randItem(arr) { 
  return arr[Math.floor(Math.random() * arr.length)]; 
}

export function randName8() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// Date & Time Helpers
export function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

export function getTimeUntilReset() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  
  const diff = tomorrow - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  return `${hours} ساعت و ${minutes} دقیقه`;
}

// IP Validation
export function isValidIPv4(ip) {
  const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipv4Regex.test(ip);
}

export function isPublicIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts[0] === 10) return false;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  if (parts[0] === 192 && parts[1] === 168) return false;
  if (parts[0] === 127) return false;
  if (parts[0] === 0) return false;
  if (parts[0] >= 224) return false;
  return true;
}

export function isValidIPv6(ip) {
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  return ipv6Regex.test(ip);
}

export function isPublicIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::1')) return false; // loopback
  if (lower.startsWith('fe80:')) return false; // link-local
  if (lower.startsWith('fc00:') || lower.startsWith('fd00:')) return false; // unique local
  if (lower.startsWith('::ffff:')) return false; // IPv4-mapped
  return true;
}

// Telegram API Helper
export async function telegramApi(env, method, body) {
  try {
    const TELEGRAM_BASE = `https://api.telegram.org/bot${env.BOT_TOKEN}`;
    const res = await fetch(`${TELEGRAM_BASE}${method}`, {
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

export async function telegramUpload(env, method, formData) {
  try {
    const TELEGRAM_BASE = `https://api.telegram.org/bot${env.BOT_TOKEN}`;
    const res = await fetch(`${TELEGRAM_BASE}/${method}`, {
      method: 'POST',
      body: formData
    });
    return await res.json();
  } catch (e) {
    console.error('خطا در Telegram Upload:', e);
    return {};
  }
}
