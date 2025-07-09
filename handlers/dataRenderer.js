const settings = require('./readSettings').settings(); 
const indexjs = require('../index');
const db = require('./db');

async function renderDataEval(req) {
  const theme = indexjs.get(req);
  const userinfo = req.session.userinfo; // Discord user info object
  let userData = null;
  let packagenameFromDb = settings.packages.default; // Default package
  let extraResources = { ram: 0, disk: 0, cpu: 0, servers: 0 };
  let userCoins = 0;

  if (userinfo && userinfo.id) {
    userData = await db.user.findUnique({
      where: { id: userinfo.id }
    });

    if (userData) {
      packagenameFromDb = userData.packageName || settings.packages.default;
      extraResources = {
        ram: userData.extraRam || 0,
        disk: userData.extraDisk || 0,
        cpu: userData.extraCpu || 0,
        servers: userData.extraServers || 0,
      };
      userCoins = userData.coins || 0;
    }
  }

  // This 'packages' variable refers to the definition of the user's current package from settings.yml
  const currentPackageDetails = settings.packages.list[packagenameFromDb] ||
                               settings.packages.list[settings.packages.default] ||
                               { ram: 0, disk: 0, cpu: 0, servers: 0 }; // Fallback if package not in settings

  return {
      req: req,
      settings: settings, // Global settings
      userinfo: userinfo, // Discord user info
      packagename: packagenameFromDb, // User's current package name
      extraresources: extraResources, // User's extra resources
      packages: currentPackageDetails, // Details of the user's current package from settings.yml
      coins: settings.coins.enabled ? userCoins : null, // User's coin balance
      pterodactyl: req.session.pterodactyl, // Pterodactyl session data
      theme: theme.name || "default", // Current theme name
      db: db // Prisma client instance (though typically not directly used in EJS)
  };
}

module.exports = { renderDataEval };