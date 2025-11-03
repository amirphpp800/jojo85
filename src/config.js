// === Configuration & Constants ===

export const TELEGRAM_BASE = (token) => `https://api.telegram.org/bot${token}`;
export const ADMIN_ID = 7240662021;

// WireGuard Configuration
export const WG_MTUS = [1280, 1320, 1360, 1380, 1400, 1420, 1440, 1480, 1500];

export const WG_FIXED_DNS = [
  '1.1.1.1',
  '1.0.0.1',
  '8.8.8.8',
  '8.8.4.4',
  '9.9.9.9',
  '10.202.10.10',
  '78.157.42.100',
  '208.67.222.222',
  '208.67.220.220',
  '185.55.226.26',
  '185.55.225.25',
  '185.51.200.2'
];

export const OPERATORS = {
  irancell: { 
    title: 'ایرانسل', 
    addresses: ['2.144.0.0/16'] 
  },
  mci: { 
    title: 'همراه اول', 
    addresses: ['5.52.0.0/16'] 
  },
  tci: { 
    title: 'مخابرات', 
    addresses: ['2.176.0.0/15', '2.190.0.0/15'] 
  },
  rightel: { 
    title: 'رایتل', 
    addresses: ['37.137.128.0/17', '95.162.0.0/17'] 
  },
  shatel: { 
    title: 'شاتل موبایل', 
    addresses: ['94.182.0.0/16', '37.148.0.0/18'] 
  }
};

// DNS Cache TTL (5 minutes)
export const DNS_CACHE_TTL = 300000;

// User Quota Limits
export const DAILY_QUOTA_LIMIT = 3;
export const ADMIN_QUOTA_LIMIT = 999999;

// History Settings
export const MAX_HISTORY_ITEMS = 10;
export const QUOTA_EXPIRATION_TTL = 86400; // 24 hours in seconds
