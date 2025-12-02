
/**
 * VIP user management system
 * Handles VIP users with expiration, usage tracking, and statistics
 */

/**
 * Check if a user is VIP and not expired
 */
export async function isVIPUser(env, userId) {
    const raw = await env.DB.get(`vip:user:${userId}`);
    if (!raw) return false;

    try {
        const userData = JSON.parse(raw);
        // If no expiration date, user has permanent VIP
        if (!userData.expiresAt) return true;

        // Check if VIP has expired
        const expiryDate = new Date(userData.expiresAt);
        const now = new Date();
        return expiryDate > now;
    } catch (e) {
        return false;
    }
}

/**
 * Get all VIP user IDs (simple list)
 */
export async function getAllVIPUsers(env) {
    const raw = await env.DB.get('vip:users:list');
    return raw ? JSON.parse(raw) : [];
}

/**
 * Get all VIP users with detailed information
 */
export async function getAllVIPUsersWithDetails(env) {
    const vipList = await getAllVIPUsers(env);
    const details = [];

    for (const userId of vipList) {
        const userData = await getVIPUserData(env, userId);
        if (userData) {
            details.push({
                id: userId,
                ...userData
            });
        }
    }

    return details;
}

/**
 * Add a user to VIP list
 * @param {Object} options - { expiresAt: ISO string (optional), notes: string (optional) }
 * @returns {boolean} true if newly added, false if already existed
 */
export async function addVIPUser(env, userId, options = {}) {
    const vipList = await getAllVIPUsers(env);
    const isNew = !vipList.includes(userId);

    // Add to list if not already there
    if (isNew) {
        vipList.push(userId);
        await env.DB.put('vip:users:list', JSON.stringify(vipList));
    }

    // Create or update user data
    const userData = {
        addedAt: new Date().toISOString(),
        expiresAt: options.expiresAt || null,
        notes: options.notes || '',
        totalDnsUsed: 0,
        totalWgUsed: 0,
        lastActivity: new Date().toISOString()
    };

    // If user already exists, preserve their usage stats
    if (!isNew) {
        const existingData = await getVIPUserData(env, userId);
        if (existingData) {
            userData.addedAt = existingData.addedAt || userData.addedAt;
            userData.totalDnsUsed = existingData.totalDnsUsed || 0;
            userData.totalWgUsed = existingData.totalWgUsed || 0;
        }
    }

    await env.DB.put(`vip:user:${userId}`, JSON.stringify(userData));
    return isNew;
}

/**
 * Remove a user from VIP list
 */
export async function removeVIPUser(env, userId) {
    const vipList = await getAllVIPUsers(env);
    const filtered = vipList.filter(id => id !== userId);

    if (filtered.length === vipList.length) {
        return false; // User wasn't in the list
    }

    await env.DB.put('vip:users:list', JSON.stringify(filtered));
    await env.DB.delete(`vip:user:${userId}`);
    return true;
}

/**
 * Get VIP user data
 */
export async function getVIPUserData(env, userId) {
    const raw = await env.DB.get(`vip:user:${userId}`);
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

/**
 * Update VIP usage statistics
 */
export async function updateVIPUsage(env, userId, type) {
    const userData = await getVIPUserData(env, userId);
    if (!userData) return false;

    if (type === 'dns') {
        userData.totalDnsUsed = (userData.totalDnsUsed || 0) + 1;
    } else if (type === 'wg') {
        userData.totalWgUsed = (userData.totalWgUsed || 0) + 1;
    }

    userData.lastActivity = new Date().toISOString();
    await env.DB.put(`vip:user:${userId}`, JSON.stringify(userData));
    return true;
}

/**
 * Update VIP user expiration date
 */
export async function updateVIPExpiration(env, userId, expiresAt) {
    const userData = await getVIPUserData(env, userId);
    if (!userData) return false;

    userData.expiresAt = expiresAt;
    await env.DB.put(`vip:user:${userId}`, JSON.stringify(userData));
    return true;
}

/**
 * Update VIP user notes
 */
export async function updateVIPNotes(env, userId, notes) {
    const userData = await getVIPUserData(env, userId);
    if (!userData) return false;

    userData.notes = notes;
    await env.DB.put(`vip:user:${userId}`, JSON.stringify(userData));
    return true;
}

/**
 * Get VIP statistics
 */
export async function getVIPStats(env) {
    const vipList = await getAllVIPUsers(env);
    let totalDns = 0;
    let totalWg = 0;
    let permanent = 0;
    let expiring = 0;
    let expired = 0;

    for (const userId of vipList) {
        const userData = await getVIPUserData(env, userId);
        if (userData) {
            totalDns += userData.totalDnsUsed || 0;
            totalWg += userData.totalWgUsed || 0;

            if (!userData.expiresAt) {
                permanent++;
            } else {
                const expiryDate = new Date(userData.expiresAt);
                const now = new Date();
                if (expiryDate < now) {
                    expired++;
                } else {
                    expiring++;
                }
            }
        }
    }

    return {
        total: vipList.length,
        permanent,
        expiring,
        expired,
        totalDnsUsed: totalDns,
        totalWgUsed: totalWg
    };
}

/**
 * Calculate VIP expiration date based on days
 * @param {number} days - Number of days from now (0 or null for permanent)
 * @returns {string|null} ISO date string or null for permanent
 */
export function calculateVIPExpiry(days) {
    if (!days || days <= 0 || isNaN(days)) return null; // Permanent VIP

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(days));
    expiryDate.setHours(23, 59, 59, 999); // End of day
    return expiryDate.toISOString();
}

/**
 * VIP-specific WireGuard configuration settings
 */
export const VIP_WG_CONFIG = {
    // MTU range for VIP configs (higher values for better performance)
    MTU_OPTIONS: [1420, 1440, 1480, 1500],

    // Recommended DNS servers for VIP (faster and more reliable)
    PREMIUM_DNS: [
        "1.1.1.1",      // Cloudflare Primary
        "1.0.0.1",      // Cloudflare Secondary
        "8.8.8.8",      // Google Primary
        "8.8.4.4",      // Google Secondary
        "9.9.9.9",      // Quad9
    ],

    // VIP-specific AllowedIPs (full tunnel by default for VIP users)
    ALLOWED_IPS: "0.0.0.0/0, ::/0",

    // PersistentKeepalive for better connection stability
    KEEPALIVE: 25,
};

/**
 * Generate random value from array
 */
function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate random base64 string
 */
function randBase64(len = 32) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr));
}

/**
 * Build VIP WireGuard configuration
 * VIP configs have optimized settings for better performance
 */
export function buildVIPWireGuardConfig({
    privateKey = null,
    address = "10.66.66.2/32",
    dns = null,
    operatorAddress = null,
}) {
    const priv = privateKey || randBase64(32);
    const mtu = pickRandom(VIP_WG_CONFIG.MTU_OPTIONS);
    const finalDns = dns || pickRandom(VIP_WG_CONFIG.PREMIUM_DNS);
    const finalAddress = operatorAddress || address;

    return [
        "[Interface]",
        `PrivateKey = ${priv}`,
        `Address = ${finalAddress}`,
        `DNS = ${finalDns}`,
        `MTU = ${mtu}`,
        "",
        "# VIP Configuration - Optimized for Performance",
        "# تنظیمات VIP - بهینه‌سازی شده برای عملکرد بهتر",
        "",
    ].join("\n");
}
