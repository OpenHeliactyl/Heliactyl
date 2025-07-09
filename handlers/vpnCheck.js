const fetch = require('node-fetch');
const settings = require('../handlers/readSettings').settings();
const getTemplate = require('../handlers/getTemplate').template;

/**
 * This function performs a VPN check using the proxycheck.io API.
 * 
 * @param {string} key - The API key for proxycheck.io.
 * @param {object} db - The database object.
 * @param {string} ip - The IP address to check.
 * @param {object} res - The response object.
 * @returns {Promise<boolean>} - A promise that resolves to a boolean indicating whether the IP is a VPN/proxy or not.
 */
async function vpnCheck(key, prisma, ip, res) { // db is now prisma
  return new Promise(async (resolve) => {
    try {
      const now = new Date();
      let cacheEntry = await prisma.vpnCheckCache.findUnique({
        where: { ipAddress: ip }
      });

      // Check if cache entry exists and is still valid
      if (cacheEntry && cacheEntry.expiresAt > now) {
        if (cacheEntry.isVpn) {
          res.send(getTemplate("Detected VPN", `${settings.name} detected that you are using a VPN; Please turn it off to continue.`, true));
          return resolve(true);
        }
        return resolve(false);
      }

      // If not cached or expired, fetch from API
      const apiResponse = await fetch(`https://proxycheck.io/v2/${ip}?key=${key}&vpn=1`);
      if (!apiResponse.ok) {
        console.error(`VPN Check API Error for IP ${ip}: ${apiResponse.status} ${apiResponse.statusText}`);
        // Decide how to handle API errors: fail open (assume not VPN) or closed (block)
        // For now, fail open:
        return resolve(false);
      }

      const vpnData = await apiResponse.json();

      if (vpnData && vpnData[ip]) {
        const isProxy = vpnData[ip].proxy === "yes";
        const expiryTimeMs = 172800000; // 2 days
        const expiresAt = new Date(now.getTime() + expiryTimeMs);

        await prisma.vpnCheckCache.upsert({
          where: { ipAddress: ip },
          update: { isVpn: isProxy, checkedAt: now, expiresAt: expiresAt },
          create: { ipAddress: ip, isVpn: isProxy, checkedAt: now, expiresAt: expiresAt }
        });

        if (isProxy) {
          res.send(getTemplate("Detected VPN", `${settings.name} detected that you are using a VPN; Please turn it off to continue.`, true));
          return resolve(true);
        }
        return resolve(false);
      } else {
        // API did not return expected data for the IP
        console.warn(`VPN Check: No data for IP ${ip} in API response.`, vpnData);
        return resolve(false); // Fail open
      }
    } catch (error) {
      console.error(`Error during VPN check for IP ${ip}:`, error);
      resolve(false); // Fail open on any other error
    }
  });
}

module.exports = { vpnCheck };