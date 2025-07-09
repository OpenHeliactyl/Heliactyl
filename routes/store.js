const adminjs = require("./admin.js");
const logToDiscord = require('../handlers/log');
const settings = require('../handlers/readSettings').settings(); 

module.exports.load = async function(app, db) { // db is Prisma Client
  const buyResource = async (req, res, resourceType, resourceName) => {
    if (!req.session || !req.session.pterodactyl || !req.session.userinfo) return res.redirect("/login");

    if (!settings.coins.store.enabled) {
      return res.redirect("/dashboard?err=STOREDISABLED");
    }

    const amountOfPackagesToBuy = parseInt(req.query.amount); // This is the number of "packages" of the resource
    if (!amountOfPackagesToBuy || isNaN(amountOfPackagesToBuy) || amountOfPackagesToBuy < 1 || amountOfPackagesToBuy > 10) { // Assuming max 10 packages at a time
        return res.send("Invalid amount of packages selected.");
    }

    const discordUserId = req.session.userinfo.id;
    const user = await db.user.findUnique({ where: { id: discordUserId } });

    if (!user) {
      console.error(`Store Error: User ${discordUserId} not found in DB.`);
      return res.redirect("/login?err=USERNOTFOUND");
    }

    const storeConfigForResource = settings.coins.store[resourceType];
    if (!storeConfigForResource) {
        console.error(`Store Error: Configuration for resourceType '${resourceType}' not found.`);
        return res.redirect("/store?err=INVALIDRESOURCECONFIG");
    }

    const valuePerPackage = storeConfigForResource.per; // e.g., 1024 for RAM (MB per package)
    const costPerPackage = storeConfigForResource.cost;
    const storeLimitForResourceValue = settings.coins.store.storelimits[resourceType]; // e.g., 8192 for RAM (total MB limit)

    let currentUserExtraValue;
    let extraFieldToUpdate;

    switch (resourceType) {
        case "ram": currentUserExtraValue = user.extraRam || 0; extraFieldToUpdate = "extraRam"; break;
        case "disk": currentUserExtraValue = user.extraDisk || 0; extraFieldToUpdate = "extraDisk"; break;
        case "cpu": currentUserExtraValue = user.extraCpu || 0; extraFieldToUpdate = "extraCpu"; break;
        case "servers": currentUserExtraValue = user.extraServers || 0; extraFieldToUpdate = "extraServers"; break;
        default:
            console.error(`Store Error: Unknown resourceType '${resourceType}'.`);
            return res.redirect("/store?err=INVALIDRESOURCETYPE");
    }

    const totalResourceValueToBuy = valuePerPackage * amountOfPackagesToBuy;

    // Check against store limits (for total accumulated value of this resource type)
    if (currentUserExtraValue + totalResourceValueToBuy > storeLimitForResourceValue) {
      const resourceNameUpper = resourceType.toUpperCase();
      return res.redirect(`/store?err=MAX${resourceNameUpper}EXCEEDED&limit=${storeLimitForResourceValue}&current=${currentUserExtraValue}&needed=${totalResourceValueToBuy}`);
    }

    const totalCost = costPerPackage * amountOfPackagesToBuy;
    const currentUserCoins = user.coins || 0;

    if (currentUserCoins < totalCost) return res.redirect(`/store?err=CANNOTAFFORD`);

    const finalUserCoins = currentUserCoins - totalCost;
    const finalUserExtraValueForType = currentUserExtraValue + totalResourceValueToBuy;

    try {
        await db.user.update({
            where: { id: discordUserId },
            data: {
                coins: finalUserCoins,
                [extraFieldToUpdate]: finalUserExtraValueForType
            }
        });

        adminjs.suspend(discordUserId, db); // Pass db instance

        logToDiscord(
          "resources purchased",
          `${req.session.userinfo.username} bought ${amountOfPackagesToBuy} package(s) of ${resourceName} (total ${totalResourceValueToBuy} units) from the store for \`${totalCost}\` Credits.`
        );
        res.redirect("/store?success=PURCHASECOMPLETE");
    } catch (error) {
        console.error(`Store Error: Failed to update user ${discordUserId} for ${resourceType} purchase:`, error);
        return res.redirect("/store?err=PURCHASEFAILED");
    }
  };

  app.get("/buyram", async (req, res) => buyResource(req, res, "ram", "RAM"));
  app.get("/buydisk", async (req, res) => buyResource(req, res, "disk", "Disk"));
  app.get("/buycpu", async (req, res) => buyResource(req, res, "cpu", "CPU"));
  app.get("/buyservers", async (req, res) => buyResource(req, res, "servers", "Servers"));
};
// Removed duplicated/erroneous lines from the end of the file.