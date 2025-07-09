const settings = require('../handlers/readSettings').settings(); 
const fetch = require('node-fetch');

/**
 * This function retrieves account information from the Pterodactyl API.
 * 
 * @param {string} userid - The user ID to lookup.
 * @param {object} db - The database object.
 * @returns {Promise<object>} - A promise that resolves to the account information.
 */
const PTERO_USER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getPteroUser(discordUserId, prisma) {
    return new Promise(async (resolve, reject) => {
        try {
            const user = await prisma.user.findUnique({
                where: { id: discordUserId },
                select: { pterodactylId: true }
            });

            if (!user || !user.pterodactylId) {
                return reject(`Pterodactyl ID not found in database for Discord user ${discordUserId}`);
            }

            const pterodactylPanelId = user.pterodactylId;
            const cacheKey = `pteroUserCache:${pterodactylPanelId}`;
            const now = new Date();

            // Try fetching from cache
            const cachedData = await prisma.pterodactylCache.findUnique({
                where: { key: cacheKey }
            });

            if (cachedData && cachedData.expiresAt > now) {
                // console.log(`[Cache HIT] Pterodactyl user ${pterodactylPanelId}`);
                return resolve(cachedData.value); // Value is already JSON
            }
            // console.log(`[Cache MISS] Pterodactyl user ${pterodactylPanelId}`);

            // If not cached or expired, fetch from API
            const pterodactylUserResponse = await fetch(`${settings.pterodactyl.domain}/api/application/users/${pterodactylPanelId}?include=servers`, {
                method: "GET",
                headers: { 
                    'Content-Type': 'application/json', 
                    "Authorization": `Bearer ${settings.pterodactyl.key}` 
                }
            });

            if (pterodactylUserResponse.status === 404) {
                return reject(`Pterodactyl account not found on panel for Ptero ID ${pterodactylPanelId} (Discord User: ${discordUserId})`);
            }

            if (!pterodactylUserResponse.ok) {
                const errorBody = await pterodactylUserResponse.text();
                // Potentially clear cache for this key if API returns an error for a previously valid user?
                // await prisma.pterodactylCache.deleteMany({ where: { key: cacheKey }});
                return reject(`Pterodactyl API error: ${pterodactylUserResponse.status} ${pterodactylUserResponse.statusText} - ${errorBody}`);
            }

            const pterodactylUserInfo = await pterodactylUserResponse.json();

            // Store in cache
            const expiresAt = new Date(now.getTime() + PTERO_USER_CACHE_TTL_MS);
            await prisma.pterodactylCache.upsert({
                where: { key: cacheKey },
                update: { value: pterodactylUserInfo, expiresAt: expiresAt, updatedAt: now },
                create: { key: cacheKey, value: pterodactylUserInfo, expiresAt: expiresAt, createdAt: now, updatedAt: now }
            });

            resolve(pterodactylUserInfo);

        } catch (err) {
            console.error(`Error in getPteroUser for Discord ID ${discordUserId}:`, err);
            reject(err);
        }
    });
}

module.exports = { getPteroUser };