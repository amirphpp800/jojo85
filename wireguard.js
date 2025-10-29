// WireGuard key generation and configuration utilities
// Uses Web Crypto API available in Cloudflare Workers

/**
 * Generate a WireGuard private key (32 random bytes, base64 encoded)
 */
export async function generatePrivateKey() {
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  
  // Clamp the key as per Curve25519 requirements
  keyBytes[0] &= 248;
  keyBytes[31] &= 127;
  keyBytes[31] |= 64;
  
  return base64Encode(keyBytes);
}

/**
 * Derive public key from private key using Curve25519
 */
export async function derivePublicKey(privateKeyB64) {
  const privateKeyBytes = base64Decode(privateKeyB64);
  
  // Import private key for ECDH
  const privateKey = await crypto.subtle.importKey(
    'raw',
    privateKeyBytes,
    { name: 'X25519', namedCurve: 'X25519' },
    true,
    ['deriveBits']
  );
  
  // Generate corresponding public key
  // For X25519, we need to perform scalar multiplication with base point
  const publicKeyBytes = await x25519ScalarMultBase(privateKeyBytes);
  
  return base64Encode(publicKeyBytes);
}

/**
 * X25519 scalar multiplication with base point (simplified implementation)
 * Note: This uses a workaround since Web Crypto doesn't directly expose X25519 key generation
 */
async function x25519ScalarMultBase(scalar) {
  try {
    // Try to use SubtleCrypto if X25519 is available
    const keyPair = await crypto.subtle.generateKey(
      { name: 'X25519' },
      true,
      ['deriveBits']
    );
    
    // Export the private key and replace with our scalar
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    jwk.d = base64UrlEncode(scalar);
    
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'X25519' },
      true,
      ['deriveBits']
    );
    
    // Export public key
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    return base64UrlDecode(publicJwk.x);
  } catch (e) {
    // Fallback: use a simplified curve25519 implementation
    return curve25519(scalar, curve25519BasePoint());
  }
}

/**
 * Simplified Curve25519 implementation (for fallback)
 */
function curve25519(n, base) {
  const gf = (init = []) => {
    const r = new Float64Array(16);
    if (init) for (let i = 0; i < init.length; i++) r[i] = init[i];
    return r;
  };
  
  const gf0 = gf();
  const gf1 = gf([1]);
  const D = gf([0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203]);
  
  const unpack25519 = (o) => {
    const r = gf();
    for (let i = 0; i < 16; i++) r[i] = o[2*i] + (o[2*i+1] << 8);
    r[15] &= 0x7fff;
    return r;
  };
  
  const pack25519 = (o, n) => {
    const m = gf(), t = gf();
    for (let i = 0; i < 16; i++) t[i] = n[i];
    
    for (let i = 0; i < 2; i++) {
      m[0] = t[0] - 0xffed;
      for (let j = 1; j < 15; j++) {
        m[j] = t[j] - 0xffff - ((m[j-1]>>16) & 1);
        m[j-1] &= 0xffff;
      }
      m[15] = t[15] - 0x7fff - ((m[14]>>16) & 1);
      const b = (m[15]>>16) & 1;
      m[14] &= 0xffff;
      sel25519(t, m, 1-b);
    }
    
    for (let i = 0; i < 16; i++) {
      o[2*i] = t[i] & 0xff;
      o[2*i+1] = t[i]>>8;
    }
  };
  
  const sel25519 = (p, q, b) => {
    const c = ~(b-1);
    for (let i = 0; i < 16; i++) {
      const t = c & (p[i] ^ q[i]);
      p[i] ^= t;
      q[i] ^= t;
    }
  };
  
  const A = (o, a, b) => { for (let i = 0; i < 16; i++) o[i] = a[i] + b[i]; };
  const Z = (o, a, b) => { for (let i = 0; i < 16; i++) o[i] = a[i] - b[i]; };
  const M = (o, a, b) => {
    const t = new Float64Array(31);
    for (let i = 0; i < 16; i++) {
      for (let j = 0; j < 16; j++) {
        t[i+j] += a[i] * b[j];
      }
    }
    for (let i = 0; i < 15; i++) t[i] += 38 * t[i+16];
    for (let i = 0; i < 16; i++) o[i] = t[i];
    sel25519(o, gf0, 0);
    sel25519(o, gf0, 0);
  };
  
  const S = (o, a) => M(o, a, a);
  
  const inv25519 = (o, i) => {
    const c = gf();
    for (let a = 0; a < 16; a++) c[a] = i[a];
    for (let a = 253; a >= 0; a--) {
      S(c, c);
      if (a !== 2 && a !== 4) M(c, c, i);
    }
    for (let a = 0; a < 16; a++) o[a] = c[a];
  };
  
  const crypto_scalarmult = (q, n, p) => {
    const z = new Uint8Array(32);
    const x = new Float64Array(80);
    let r;
    
    for (let i = 0; i < 31; i++) z[i] = n[i];
    z[31] = (n[31] & 127) | 64;
    z[0] &= 248;
    
    const a = gf([1]), b = gf([0]), c = gf([0]), d = gf([1]);
    const e = gf(), f = gf();
    
    for (let i = 0; i < 16; i++) {
      b[i] = unpack25519(p)[i];
      a[i] = d[i] = 0;
    }
    a[0] = d[0] = 1;
    
    for (let i = 254; i >= 0; --i) {
      r = (z[i >>> 3] >>> (i & 7)) & 1;
      sel25519(a, b, r);
      sel25519(c, d, r);
      A(e, a, c);
      Z(a, a, c);
      A(c, b, d);
      Z(b, b, d);
      S(d, e);
      S(f, a);
      M(a, c, a);
      M(c, b, e);
      A(e, a, c);
      Z(a, a, c);
      S(b, a);
      Z(c, d, f);
      M(a, c, gf([0xdb41, 1]));
      A(a, a, d);
      M(c, c, a);
      M(a, d, f);
      M(d, b, unpack25519(p));
      S(b, e);
      sel25519(a, b, r);
      sel25519(c, d, r);
    }
    
    inv25519(c, c);
    M(a, a, c);
    pack25519(q, a);
    
    return 0;
  };
  
  const result = new Uint8Array(32);
  crypto_scalarmult(result, n, base);
  return result;
}

function curve25519BasePoint() {
  const base = new Uint8Array(32);
  base[0] = 9;
  return base;
}

/**
 * Base64 encoding (standard, not URL-safe)
 */
function base64Encode(bytes) {
  const binString = Array.from(bytes, (x) => String.fromCharCode(x)).join('');
  return btoa(binString);
}

/**
 * Base64 decoding
 */
function base64Decode(str) {
  const binString = atob(str);
  return Uint8Array.from(binString, (m) => m.charCodeAt(0));
}

/**
 * Base64 URL-safe encoding
 */
function base64UrlEncode(bytes) {
  return base64Encode(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64 URL-safe decoding
 */
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return base64Decode(str);
}

/**
 * Generate a complete WireGuard configuration
 */
export async function generateWireGuardConfig(endpoint, dns, serverPublicKey = null) {
  const privateKey = await generatePrivateKey();
  const publicKey = await derivePublicKey(privateKey);
  
  // Generate a random IP in 10.0.0.0/24 range
  const clientIP = `10.0.0.${Math.floor(Math.random() * 254) + 2}`;
  
  const config = `[Interface]
PrivateKey = ${privateKey}
Address = ${clientIP}/24
DNS = ${dns}

[Peer]
PublicKey = ${serverPublicKey || 'SERVER_PUBLIC_KEY_HERE'}
Endpoint = ${endpoint}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25`;
  
  return {
    privateKey,
    publicKey,
    clientIP,
    config
  };
}
