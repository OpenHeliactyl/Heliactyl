const settings = require('../handlers/readSettings').settings(); 
const adminjs = require("./admin.js");
const { getPteroUser } = require('../handlers/getPteroUser'); // Updated import
const logToDiscord = require("../handlers/log");
const fetch = require("node-fetch");

module.exports.load = async (app, db) => {
  app.get("/create", async (req, res) => {
      try {
          if (!req.session || !req.session.pterodactyl || !req.session.userinfo) return res.redirect("/login");
          if (!req.query.name || !req.query.cpu || !req.query.ram || !req.query.disk || !req.query.egg || !req.query.location) return res.redirect("/servers?err=MISSINGVARIABLE");
      
          if (!settings.allow.server.create) return res.redirect("/servers/new?err=disabled");
      
          const cacheAccount = await getPteroUser(req.session.userinfo.id, db);
          if (!cacheAccount) return;
      
          req.session.pterodactyl = cacheAccount.attributes;
            
          const name = decodeURIComponent(req.query.name);
      
          if (name.length < 1) return res.redirect("/servers?err=LITTLESERVERNAME");
      
          if (name.length > 191) return res.redirect("/servers?err=BIGSERVERNAME");
      
          const discordUserId = req.session.userinfo.id;
          const user = await db.user.findUnique({ where: { id: discordUserId } });

          if (!user) {
              console.error(`Create server error: User ${discordUserId} not found in DB.`);
              return res.redirect("/login?err=USERNOTFOUND");
          }

          const userPackageName = user.packageName || settings.packages.default;
          const currentPackageDetails = settings.packages.list[userPackageName];
          if (!currentPackageDetails) {
              console.error(`Create server error: Package ${userPackageName} not found in settings for user ${discordUserId}.`);
              return res.redirect("/servers?err=PACKAGENOTFOUND");
          }

          const userExtraResources = {
            ram: user.extraRam || 0,
            disk: user.extraDisk || 0,
            cpu: user.extraCpu || 0,
            servers: user.extraServers || 0
          };
      
          let currentTotalRamUsage = 0;
          let currentTotalDiskUsage = 0;
          let currentTotalCpuUsage = 0;
          const serversData = req.session.pterodactyl.relationships.servers.data;
      
          serversData.forEach(server => {
               currentTotalRamUsage += server.attributes.limits.memory;
               currentTotalDiskUsage += server.attributes.limits.disk;
               currentTotalCpuUsage += server.attributes.limits.cpu;
          });
        
          if (serversData.length >= currentPackageDetails.servers + userExtraResources.servers) return res.redirect("/servers?err=TOOMUCHSERVERS");
          
          const location = req.query.location;
          if (!Object.prototype.hasOwnProperty.call(settings.locations, location)) return res.redirect("/servers?err=INVALIDLOCATION");
          
          const requiredpackage = settings.locations[location].package;
          if (requiredpackage && !requiredpackage.includes(userPackageName)) return res.redirect("/servers?err=PREMIUMLOCATION");
          
          const egg = req.query.egg;
          const egginfo = settings.eggs[egg];
          if (!egginfo) return res.redirect("/servers?err=INVALIDEGG");    

          const cpu = parseFloat(req.query.cpu);
          const ram = parseFloat(req.query.ram);
          const disk = parseFloat(req.query.disk);
        
          if (isNaN(cpu) || isNaN(ram) || isNaN(disk)) return res.redirect("/servers?err=NOTANUMBER");

          // Exceed resources
          if (currentTotalRamUsage + ram > currentPackageDetails.ram + userExtraResources.ram)
              return res.redirect(`/servers?err=EXCEEDRAM&num=${currentPackageDetails.ram + userExtraResources.ram - currentTotalRamUsage}`);
          
          if (currentTotalDiskUsage + disk > currentPackageDetails.disk + userExtraResources.disk)
              return res.redirect(`/servers?err=EXCEEDDISK&num=${currentPackageDetails.disk + userExtraResources.disk - currentTotalDiskUsage}`);
          
          if (currentTotalCpuUsage + cpu > currentPackageDetails.cpu + userExtraResources.cpu)
              return res.redirect(`/servers?err=EXCEEDCPU&num=${currentPackageDetails.cpu + userExtraResources.cpu - currentTotalCpuUsage}`);
          
          // Little resources
          if (egginfo.minimum && egginfo.minimum.ram && ram < egginfo.minimum.ram)
              return res.redirect(`/servers?err=TOOLITTLERAM&num=${egginfo.minimum.ram}`);
        
          if (egginfo.minimum && egginfo.minimum.disk && disk < egginfo.minimum.disk)
              return res.redirect(`/servers?err=TOOLITTLEDISK&num=${egginfo.minimum.disk}`);
        
          if (egginfo.minimum && egginfo.minimum.cpu && cpu < egginfo.minimum.cpu)
              return res.redirect(`/servers?err=TOOLITTLECPU&num=${egginfo.minimum.cpu}`);
          
          // Too Much resources
          if (egginfo.maximum && egginfo.maximum.ram && ram > egginfo.maximum.ram)
              return res.redirect(`/servers?err=TOOMUCHRAM&num=${egginfo.maximum.ram}`);

          if (egginfo.maximum && egginfo.maximum.disk && disk > egginfo.maximum.disk)
              return res.redirect(`/servers?err=TOOMUCHDISK&num=${egginfo.maximum.disk}`);
          
          if (egginfo.maximum && egginfo.maximum.cpu && cpu > egginfo.maximum.cpu)
              return res.redirect(`/servers?err=TOOMUCHCPU&num=${egginfo.maximum.cpu}`);
        
          let specs = egginfo.info;
          // specs.user should be the Pterodactyl User ID
          if (!user.pterodactylId) {
            console.error(`Create server error: User ${discordUserId} does not have a Pterodactyl ID linked.`);
            return res.redirect("/servers?err=NOPTEROID");
          }
          specs.user = user.pterodactylId;
          specs.limits = specs.limits || {
            swap: 0,
            io: 500,
            backups: 0 
          };
          specs.name = name;
          specs.limits.swap = -1;
          specs.limits.memory = ram;
          specs.limits.disk = disk;
          specs.limits.cpu = cpu;
          specs.deploy = specs.deploy || {
            locations: [],
            dedicated_ip: false,
            port_range: [] 
          };
          specs.deploy.locations = [location];
        
          const serverCreationCost = settings.servercreation.cost;
          let userCoins = user.coins || 0;
        
          // Charge for server creation if user has created a server before and cost is applicable
          if (user.hasCreatedServer && serverCreationCost > 0) {
            if (userCoins < serverCreationCost) {
              return res.redirect("/servers/new?err=TOOLITTLECOINSFORCREATION");
            }
            userCoins -= serverCreationCost; // Deduct coins, will be part of the user update transaction
          }
        
          const pterodactylResponse = await fetch(`${settings.pterodactyl.domain}/api/application/servers`, {
              method: "POST",
              headers: {
                  'Content-Type': 'application/json',
                  "Authorization": `Bearer ${settings.pterodactyl.key}`,
                  "Accept": "application/json"
              },
              body: JSON.stringify(specs)
          });
        
          if (!pterodactylResponse.ok) {
              const errorBody = await pterodactylResponse.text();
              console.error("Pterodactyl API Error on server creation:", errorBody);
              return res.redirect("/servers?err=ERRORONCREATE");
          }
        
          const newPterodactylServerInfo = await pterodactylResponse.json();
          req.session.pterodactyl.relationships.servers.data.push(newPterodactylServerInfo);

          // Update user and create server renewal record in a transaction
          try {
            await db.$transaction([
              db.user.update({
                where: { id: discordUserId },
                data: {
                  coins: userCoins, // Updated coin balance
                  hasCreatedServer: true
                }
              }),
              db.serverRenewal.create({
                data: {
                  pterodactylServerId: newPterodactylServerInfo.attributes.id.toString(),
                  userId: discordUserId,
                  lastRenewedAt: new Date() // Set initial renewal date
                }
              })
            ]);
          } catch (transactionError) {
            console.error("Transaction error during server creation (DB update):", transactionError);
            // Potentially try to delete the server from Pterodactyl if DB update fails to prevent orphans
            // This is complex recovery logic. For now, log and error out.
            await fetch(`${settings.pterodactyl.domain}/api/application/servers/${newPterodactylServerInfo.attributes.id}`, { method: "DELETE", headers: { "Authorization": `Bearer ${settings.pterodactyl.key}` } });
            return res.redirect("/servers?err=DBERRORONCREATE");
          }
        
          logToDiscord(
            "created server",
            `${req.session.userinfo.username} created a new server named \`${name}\` with the following specs:\n\`\`\`Memory: ${ram} MB\nCPU: ${cpu}%\nDisk: ${disk}\nLocation ID: ${location}\nEgg: ${egg}\`\`\``
          );
          return res.redirect("/servers?err=CREATEDSERVER");
      } catch (error) {
          console.error("An error occurred:", error);
          return res.redirect('/dashboard?err=INTERNALERROR')
      }
    });

    app.get("/modify", async (req, res) => {
      try {
        if (!req.session || !req.session.pterodactyl || !req.session.userinfo) return res.redirect("/login");
         
        if (!settings.allow.server.modify) return res.redirect("/servers/modify?err=disabled");

        if (!req.query.id) return res.send("Missing server id.");
        
        const cacheAccount = await getPteroUser(req.session.userinfo.id, db);
        if (!cacheAccount) return;

        req.session.pterodactyl = cacheAccount.attributes;
        
        const serverId = req.query.id;
        const serverData = req.session.pterodactyl.relationships.servers.data;
        
        const serverToModify = serverData.find(server => server.attributes.id == serverId);
        if (!serverToModify) return res.send("Invalid server id.");
        
        let cpu = parseFloat(req.query.cpu);
        let ram = parseFloat(req.query.ram);
        let disk = parseFloat(req.query.disk);
        
        if (isNaN(cpu) || isNaN(ram) || isNaN(disk)) return res.redirect(`/servers/edit?id=${serverId}&err=MISSINGVARIABLE`);
        
        const discordUserId = req.session.userinfo.id;
        const user = await db.user.findUnique({ where: { id: discordUserId } });

        if (!user) {
            console.error(`Modify server error: User ${discordUserId} not found in DB.`);
            return res.redirect("/login?err=USERNOTFOUND");
        }

        const userPackageName = user.packageName || settings.packages.default;
        const currentPackageDetails = settings.packages.list[userPackageName];
        if (!currentPackageDetails) {
            console.error(`Modify server error: Package ${userPackageName} not found in settings for user ${discordUserId}.`);
            return res.redirect(`/servers/edit?id=${serverId}&err=PACKAGENOTFOUND`);
        }
        
        const userExtraResources = {
            ram: user.extraRam || 0,
            disk: user.extraDisk || 0,
            cpu: user.extraCpu || 0,
            // servers: user.extraServers || 0 // Not directly used for modify checks other than total count
        };

        let serverDataExceptCurrent = serverData.filter(server => server.attributes.id.toString() !== serverId);
        
        let otherServersRamUsage = 0;
        let otherServersDiskUsage = 0;
        let otherServersCpuUsage = 0;
        serverDataExceptCurrent.forEach(server => {
          otherServersCpuUsage += server.attributes.limits.cpu;
          otherServersRamUsage += server.attributes.limits.memory;
          otherServersDiskUsage += server.attributes.limits.disk;
        });
        
        let egginfo = Object.values(settings.eggs).find(egg => egg.info.egg === serverToModify.attributes.egg);
        if (!egginfo) return res.redirect(`/servers/edit?id=${serverId}&err=MISSINGEGG`);
        
        // Exceed resources (comparing requested new values for *this* server + usage of *other* servers against total limits)
        if (otherServersRamUsage + ram > currentPackageDetails.ram + userExtraResources.ram)
          return res.redirect(`/servers/edit?id=${serverId}&err=EXCEEDRAM&num=${currentPackageDetails.ram + userExtraResources.ram - otherServersRamUsage}`);
        
        if (otherServersDiskUsage + disk > currentPackageDetails.disk + userExtraResources.disk)
          return res.redirect(`/servers/edit?id=${serverId}&err=EXCEEDDISK&num=${currentPackageDetails.disk + userExtraResources.disk - otherServersDiskUsage}`);
        
        if (otherServersCpuUsage + cpu > currentPackageDetails.cpu + userExtraResources.cpu)
          return res.redirect(`/servers/edit?id=${serverId}&err=EXCEEDCPU&num=${currentPackageDetails.cpu + userExtraResources.cpu - otherServersCpuUsage}`);
        
        // Little resources
        if (egginfo.minimum.ram && ram < egginfo.minimum.ram) 
          return res.redirect(`/servers/edit?id=${serverId}&err=TOOLITTLERAM&num=${egginfo.minimum.ram}`);
        
        if (egginfo.minimum.disk && disk < egginfo.minimum.disk) 
          return res.redirect(`/servers/edit?id=${serverId}&err=TOOLITTLEDISK&num=${egginfo.minimum.disk}`);
        
        if (egginfo.minimum.cpu && cpu < egginfo.minimum.cpu) 
          return res.redirect(`/servers/edit?id=${serverId}&err=TOOLITTLECPU&num=${egginfo.minimum.cpu}`);
        
        // Too Much resources
        if (egginfo.maximum) {
          if (egginfo.maximum.ram && ram > egginfo.maximum.ram) 
            return res.redirect(`/servers/edit?id=${serverId}&err=TOOMUCHRAM&num=${egginfo.maximum.ram}`);
          
          if (egginfo.maximum.disk && disk > egginfo.maximum.disk) 
            return res.redirect(`/servers/edit?id=${serverId}&err=TOOMUCHDISK&num=${egginfo.maximum.disk}`);

          if (egginfo.maximum.cpu && cpu > egginfo.maximum.cpu) 
            return res.redirect(`/servers/edit?id=${serverId}&err=TOOMUCHCPU&num=${egginfo.maximum.cpu}`);
        }
        
        let limits = {
          memory: ram,
          disk: disk,
          cpu: cpu,
          swap: egginfo ? serverToModify.attributes.limits.swap : 0,
          io: egginfo ? serverToModify.attributes.limits.io : 500
        };
        
        let serverinfo = await fetch(`${settings.pterodactyl.domain}/api/application/servers/${serverId}/build`, {
          method: "PATCH",
          headers: {
            'Content-Type': 'application/json',
            "Authorization": `Bearer ${settings.pterodactyl.key}`,
            "Accept": "application/json"
          },
          body: JSON.stringify({
            limits: limits,
            feature_limits: serverToModify.attributes.feature_limits,
            allocation: serverToModify.attributes.allocation
          })
        });
        
        if (!serverinfo.ok) return res.redirect(`/servers/edit?id=${serverId}&err=ERRORONMODIFY`);
        
        let serverInfoText = await serverinfo.json();
        
        logToDiscord(
          "modify server",
          `${req.session.userinfo.username} modified the server called \`${serverInfoText.attributes.name}\` to have the following specs:\n\`\`\`Memory: ${ram} MB\nCPU: ${cpu}%\nDisk: ${disk}\`\`\``
        );
        
        // G
        serverDataExceptCurrent.push(serverInfoText);
        req.session.pterodactyl.relationships.servers.data = serverDataExceptCurrent;
        adminjs.suspend(req.session.userinfo.id, db); // Pass db instance
        
        res.redirect("/servers?err=MODIFYSERVER");
      } catch (error) {
        console.error("Error modifing server:", error);
        return res.redirect('/dashboard?err=INTERNALERROR')
      }
    });

  app.get("/delete", async (req, res) => {
    if (!req.session || !req.session.pterodactyl || !req.session.userinfo) return res.redirect("/login");
    if (!req.query.id) return res.send("Missing id.");
  
    if (!settings.allow.server.delete) return res.redirect("/servers");
  
    let server = req.session.pterodactyl.relationships.servers.data.find(server => server.attributes.id == req.query.id);
    if (!server) return res.send("Could not find server with that ID.");
  
    let serverName = server.attributes.name; // Get the server name before deletion
  
    try {
      let deletionResults = await fetch(`${settings.pterodactyl.domain}/api/application/servers/${req.query.id}`, {
        method: "delete",
        headers: {
          'Content-Type': 'application/json',
          "Authorization": `Bearer ${settings.pterodactyl.key}`
        }
      });
    
      if (!deletionResults.ok) return res.send("An error has occurred while attempting to delete the server.");
    
      req.session.pterodactyl.relationships.servers.data = req.session.pterodactyl.relationships.servers.data.filter(server => server.attributes.id.toString() !== req.query.id);

      // Delete server renewal record
      await db.serverRenewal.deleteMany({
        where: { pterodactylServerId: req.query.id }
      });
    
      adminjs.suspend(req.session.userinfo.id, db); // Pass db instance
    
      logToDiscord(
        "deleted server",
        `${req.session.userinfo.username} deleted server ${serverName}.`
      );
    
      return res.redirect('/servers?err=DELETEDSERVER');
    } catch (error) {
      console.error("Error deleting server:", error);
      return res.redirect('/dashboard?err=INTERNALERROR')
    }
  });

  // A
  
  app.get(`/api/createdServer`, async (req, res) => {
    if (!req.session.pterodactyl || !req.session.userinfo || !req.session.userinfo.id) {
      return res.json({ error: true, message: `You must be logged in and have a valid session.` });
    }

    const discordUserId = req.session.userinfo.id;
    const user = await db.user.findUnique({
      where: { id: discordUserId },
      select: { hasCreatedServer: true }
    });

    if (!user) {
      // This case should ideally not be reached if the user has a pterodactyl session.
      return res.json({ error: true, message: "User not found in database." });
    }
    // The 'cost' here was settings.renewals.cost in original, but servercreation.cost seems more appropriate if it's about first server.
    // Sticking to original for now, but this might be a point of confusion.
    return res.json({ created: user.hasCreatedServer || false, cost: settings.servercreation.cost });
  })
};