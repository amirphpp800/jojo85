
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // Helper function to check admin
    function isAdminReq(request, env) {
        if (!env.ADMIN_ID) return false;
        const q = url.searchParams.get("admin");
        const header = request.headers.get("x-admin-id");
        const adminId = String(env.ADMIN_ID);
        return String(q) === adminId || String(header) === adminId;
    }

    // Add users to KV endpoint
    if (path === "/api/users/kv/add" && method === "POST") {
        if (!isAdminReq(request, env)) {
            return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
                status: 403,
                headers: { "Content-Type": "application/json" }
            });
        }

        try {
            const body = await request.json();
            const userIds = body.userIds || [];

            if (!Array.isArray(userIds) || userIds.length === 0) {
                return new Response(JSON.stringify({ ok: false, error: "Invalid userIds array" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }

            // Get current allusers list
            const allUsersRaw = await env.DB.get("allusers");
            const allUsersList = allUsersRaw ? JSON.parse(allUsersRaw) : [];

            let added = 0;
            let skipped = 0;

            for (const userId of userIds) {
                if (!allUsersList.includes(userId)) {
                    allUsersList.push(userId);
                    added++;

                    // Also create user:{id} entry
                    const userKey = `user:${userId}`;
                    const exists = await env.DB.get(userKey);
                    if (!exists) {
                        await env.DB.put(userKey, JSON.stringify({
                            id: userId,
                            addedAt: new Date().toISOString()
                        }));
                    }
                } else {
                    skipped++;
                }
            }

            // Save updated list
            await env.DB.put("allusers", JSON.stringify(allUsersList));

            return new Response(JSON.stringify({
                ok: true,
                total: userIds.length,
                added: added,
                skipped: skipped
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });

        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
    }

    // Check users endpoint
    if (path === "/api/users/check" && method === "GET") {
        if (!isAdminReq(request, env)) {
            return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
                status: 403,
                headers: { "Content-Type": "application/json" }
            });
        }

        try {
            // Get all users from user:* prefix
            const usersFromPrefix = new Set();
            let cursor = undefined;

            do {
                const result = await env.DB.list({
                    prefix: "user:",
                    limit: 1000,
                    cursor: cursor
                });

                for (const key of result.keys || []) {
                    const userId = key.name.replace('user:', '');
                    if (userId) {
                        usersFromPrefix.add(userId);
                    }
                }

                cursor = result.cursor;
            } while (cursor);

            // Get all users from allusers
            const allUsersRaw = await env.DB.get("allusers");
            const allUsersList = allUsersRaw ? JSON.parse(allUsersRaw) : [];
            const usersFromAllUsers = new Set(allUsersList);

            // Find differences
            const onlyInUserPrefix = [...usersFromPrefix].filter(id => !usersFromAllUsers.has(id));
            const onlyInAllUsers = [...usersFromAllUsers].filter(id => !usersFromPrefix.has(id));
            const inBoth = [...usersFromPrefix].filter(id => usersFromAllUsers.has(id));

            return new Response(JSON.stringify({
                ok: true,
                userPrefix: usersFromPrefix.size,
                allUsers: usersFromAllUsers.size,
                onlyInUserPrefix: onlyInUserPrefix,
                onlyInAllUsers: onlyInAllUsers,
                inBoth: inBoth.length,
                missingInAllUsers: onlyInUserPrefix,
                missingInUserPrefix: onlyInAllUsers
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });

        } catch (e) {
            return new Response(JSON.stringify({ ok: false, error: e.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
    }

    // Return 404 for unhandled paths
    return new Response("Not Found", { status: 404 });
}
