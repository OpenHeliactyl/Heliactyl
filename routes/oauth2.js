"use strict";

const settings = require('../handlers/readSettings').settings();
const log = require('../handlers/log');
const getTemplate = require('../handlers/getTemplate').template;
const fetch = require('node-fetch');
const { getPteroUser } = require('../handlers/getPteroUser'); // Updated import
const { vpnCheck } = require("../handlers/vpnCheck");

module.exports.load = async (app, db) => { // db is Prisma Client here
  app.get("/login", async (req, res) => {
    if (req.query.redirect) {
      req.session.redirect = `/${req.query.redirect}`;
    }

    res.redirect(
      `https://discord.com/api/oauth2/authorize?client_id=${settings.oauth2.id}&redirect_uri=${encodeURIComponent(settings.oauth2.link + settings.oauth2.callbackpath)}&response_type=code&scope=identify%20email${
        settings.bot.joinguild.enabled ? "%20guilds.join" : ""
      }${
        settings.j4r.enabled ? "%20guilds" : ""
      }${
        settings.oauth2.prompt === false ? "&prompt=none" : (req.query.prompt === "none" ? "&prompt=none" : "")
      }`
    );
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
  });

  app.get(settings.oauth2.callbackpath, async (req, res) => {
    if (!req.query.code) return res.redirect("/login");

    const code = encodeURIComponent(req.query.code.replace(/'/g, ''));
    res.send(getTemplate("Please wait...", "Logging in... Please wait, you'll be redirected soon") + `
      <script type="text/javascript" defer>
        history.pushState('/login', 'Logging in...', '/login');
        window.location.replace('/submitlogin?code=${code}');
      </script>
    `);
  });

  app.get("/submitlogin", async (req, res) => {
    if (!req.query.code) return res.send("Missing code.");
    delete req.session.redirect;

    let ip = (settings.oauth2.ip["trust x-forwarded-for"] ? (req.headers['x-forwarded-for'] || req.connection.remoteAddress) : req.connection.remoteAddress) || "::1";
    ip = ip.replace(/::1/g, "::ffff:127.0.0.1").replace(/^.*:/, '');

    if (settings.antivpn.status && ip !== '127.0.0.1' && !settings.antivpn.whitelistedIPs.includes(ip)) {
      const vpn = await vpnCheck(settings.antivpn.APIKey, db, ip, res);
      if (vpn) return;  
    }

    let body = 
      "client_id=" + encodeURIComponent(settings.oauth2.id) +
      "&client_secret=" + encodeURIComponent(settings.oauth2.secret) +
      "&grant_type=authorization_code" +
      "&code=" + encodeURIComponent(req.query.code) +
      "&redirect_uri=" + encodeURIComponent(settings.oauth2.link + settings.oauth2.callbackpath);

    let tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: "POST",
      body: body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!tokenResponse.ok) return res.redirect("/login");

    let codeinfo = await tokenResponse.json();
    let scopes = codeinfo.scope;
    let missingScopes = [];

    if (!scopes.includes("identify")) missingScopes.push("identify");
    if (!scopes.includes("email")) missingScopes.push("email");
    if (settings.bot.joinguild.enabled && !scopes.includes("guilds.join")) missingScopes.push("guilds.join");
    if (settings.j4r.enabled && !scopes.includes("guilds")) missingScopes.push("guilds");

    if (missingScopes.length) return res.send("Missing scopes: " + missingScopes.join(", "));

    let userinfoResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { "Authorization": `Bearer ${codeinfo.access_token}` }
    });

    if (!userinfoResponse.ok) return res.send("Failed to fetch user info.");    

    let userinfo = await userinfoResponse.json();

    if (!userinfo.verified) return res.send("Not verified a Discord account. Please verify the email on your Discord account.");

    // Check if whitelist is enabled and if the user is whitelisted
    if (settings.oauth2.whitelist.status && !settings.oauth2.whitelist.users.includes(userinfo.id)) 
      return res.send(getTemplate("Whitelisted", "You are not whitelisted. Please contact the administrator for more information.", true));

    // Check if blacklist is enabled and if the user is blacklisted
    if (settings.oauth2.blacklist.status && settings.oauth2.blacklist.users.includes(userinfo.id)) 
      return res.send(getTemplate("Blacklisted", "You are blacklisted. Please contact the administrator for more information.", true));

    // Check if the user is "blacklisted" ip
    if (settings.oauth2.ip.block.includes(ip)) 
      return res.send(getTemplate("IP Blacklisted", "You could not sign in, because your IP has been blocked from signing in.", true));
    
    // Duplicate account check based on IP
    // TODO: Refactor IP-based alt account check. The current key-value `ipuser-${ip}` store
    // does not directly map to existing Prisma models without adding a new one or complex logic.
    // For now, this check is commented out. A new model `SingleUserIP` might be needed.
    /*
    if (settings.oauth2.ip["duplicate check"] && ip !== '127.0.0.1') {
      const ipuser = await db.get(`ipuser-${ip}`); // Needs replacement
      if (ipuser && ipuser !== userinfo.id) {
        return res.status(200).send(getTemplate("Alt Account Detected", `${settings.name} detected that you have multiple accounts with us. We do not allow the use of multiple accounts on our services.`, true));
      } else if (!ipuser) {
        await db.set(`ipuser-${ip}`, userinfo.id); // Needs replacement
      }
    }
    */

    // Ensure user record exists to associate J4R entries and coins
    // This will also be used later for package assignments and Pterodactyl account linking.
    let localUser = await db.user.findUnique({ where: { id: userinfo.id } });
    if (!localUser) {
        // Create a basic user entry if it doesn't exist. More details might be added later.
        // Pterodactyl ID is not known yet. IP address will be set during Pterodactyl account creation/linking.
        try {
            localUser = await db.user.create({
                data: {
                    id: userinfo.id,
                    email: userinfo.email,
                    username: userinfo.username,
                    // ipAddress will be set later if a new Ptero account is made or linked.
                    // Default values for coins, package, extraResources will be applied by Prisma schema.
                }
            });
        } catch (e) {
            if (e.code === 'P2002') { // Unique constraint failed (e.g. email if we made it unique and it somehow conflicts)
                 console.error(`Error creating user due to unique constraint: ${userinfo.id} - ${userinfo.email}`, e);
                 return res.send("Error processing your login. Potential account conflict.");
            }
            throw e; // Re-throw other errors
        }
    }


    // J4R system integration
    if (settings.j4r.enabled) {
      let guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { "Authorization": `Bearer ${codeinfo.access_token}` }
      });

      if (!guildsResponse.ok) return res.send(getTemplate("J4R system", "Please allow us to know what servers you are in to let the J4R system work properly.", true));

      const guildsinfo = await guildsResponse.json();
      const currentJ4REntries = await db.userJ4REntry.findMany({ where: { userId: userinfo.id } });
      let currentCoins = localUser.coins || 0;

      const newJ4RServerIdsToAdd = [];
      const j4rEntriesToCreate = [];

      for (const ad of settings.j4r.ads) {
        const isInDiscordGuild = guildsinfo.find(g => g.id === ad.id);
        const alreadyHasEntry = currentJ4REntries.find(e => e.j4rServerId === ad.id);

        if (isInDiscordGuild && !alreadyHasEntry) {
          j4rEntriesToCreate.push({
            userId: userinfo.id,
            j4rServerId: ad.id,
            // claimedAt: new Date() // Prisma default
          });
          currentCoins += ad.coins;
          newJ4RServerIdsToAdd.push(ad.id);
        }
      }
      if (j4rEntriesToCreate.length > 0) {
        await db.userJ4REntry.createMany({
          data: j4rEntriesToCreate,
          skipDuplicates: true, // Just in case, though logic should prevent it
        });
      }

      const j4rServerIdsToRemove = [];
      for (const entry of currentJ4REntries) {
        const stillInDiscordGuild = guildsinfo.find(g => g.id === entry.j4rServerId);
        // Also ensure it wasn't just added in this same transaction if logic was more complex
        const wasJustAdded = newJ4RServerIdsToAdd.includes(entry.j4rServerId);

        if (!stillInDiscordGuild && !wasJustAdded) {
          j4rServerIdsToRemove.push(entry.j4rServerId);
          // Find the original coin value for this J4R ad to subtract
          const adDetails = settings.j4r.ads.find(ad => ad.id === entry.j4rServerId);
          if (adDetails) {
            currentCoins -= adDetails.coins;
          }
        }
      }

      if (j4rServerIdsToRemove.length > 0) {
        await db.userJ4REntry.deleteMany({
          where: {
            userId: userinfo.id,
            j4rServerId: { in: j4rServerIdsToRemove }
          }
        });
      }

      // Update coins if they changed
      if (currentCoins !== (localUser.coins || 0)) {
        await db.user.update({
          where: { id: userinfo.id },
          data: { coins: Math.max(0, currentCoins) } // Ensure coins don't go negative
        });
        localUser.coins = Math.max(0, currentCoins); // Update localUser variable
      }
    }

    // Join specified guilds
    if (settings.bot.joinguild.enabled) {
      const guildids = Array.isArray(settings.bot.joinguild.guildid) ? settings.bot.joinguild.guildid : [settings.bot.joinguild.guildid];
      for (let guild of guildids) {
        await fetch(`https://discord.com/api/guilds/${guild}/members/${userinfo.id}`, {
          method: "PUT",
          headers: {
            'Content-Type': 'application/json',
            "Authorization": `Bot ${settings.bot.token}`
          },
          body: JSON.stringify({ access_token: codeinfo.access_token })
        });
      }
    }

    // Give a discord role on login
    if (settings.bot.giverole.enabled) {
      if (typeof settings.bot.giverole.guildid === "string" && typeof settings.bot.giverole.roleid === "string") {
        await fetch(`https://discord.com/api/guilds/${settings.bot.giverole.guildid}/members/${userinfo.id}/roles/${settings.bot.giverole.roleid}`, {
          method: "PUT",
          headers: {
            'Content-Type': 'application/json',
            "Authorization": `Bot ${settings.bot.token}`
          }
        });
      } else {
        return res.send("bot.giverole.guildid or roleid is not a string.");
      }
    }

    // Apply role packages
    if (settings.packages.rolePackages.roles && localUser) { // Ensure localUser is available
      let memberResponse = await fetch(`https://discord.com/api/v9/guilds/${settings.packages.rolePackages.roleServer}/members/${userinfo.id}`, {
        headers: { "Authorization": `Bot ${settings.bot.token}` }
      });

      if (memberResponse.ok) {
        let memberInfo = await memberResponse.json();
        let currentPackageName = localUser.packageName || settings.packages.default;
        let finalPackageName = currentPackageName; // Start with current/default
        let rolePackages = settings.packages.rolePackages.roles;

        // If current package is a role package, but user no longer has the role, revert to default
        let currentPackageIsFromRole = false;
        for (const roleId in rolePackages) {
            if (rolePackages[roleId] === currentPackageName) {
                currentPackageIsFromRole = true;
                if (!memberInfo.roles.includes(roleId)) {
                    finalPackageName = settings.packages.default;
                    break;
                }
            }
        }

        // Apply the highest priority role package if user has multiple roles that grant packages
        // Assuming priority might be implicit in settings.packages.rolePackages.roles definition or just take the last one found
        let appliedRolePackage = false;
        for (const role of memberInfo.roles) {
          if (rolePackages[role]) {
            // Potentially add priority logic here if multiple roles could grant packages
            finalPackageName = rolePackages[role];
            appliedRolePackage = true;
          }
        }

        // If no role package was applied and current package was not from a (now missing) role, it remains unchanged.
        // If a role package was applied, or current package was from a missing role (reverted to default), update.
        if (finalPackageName !== currentPackageName || appliedRolePackage || (currentPackageIsFromRole && finalPackageName === settings.packages.default) ) {
          if (localUser.packageName !== finalPackageName) { // Only update if changed
            await db.user.update({
              where: { id: userinfo.id },
              data: { packageName: finalPackageName }
            });
            localUser.packageName = finalPackageName; // Update localUser variable
          }
        }
      }
    }

    // Create Pterodactyl account if not exists OR if localUser exists but pterodactylId is not set
    if (!localUser.pterodactylId) {
      if (!settings.allow.newusers && !localUser.pterodactylId) { // Only block truly new signups if new users not allowed
          // If user exists locally but somehow lost pteroID, this might need different handling or admin intervention.
          // For now, if new users are disallowed and pteroID is missing, effectively blocks linking too.
          return res.send("New user signups are currently disabled, and your account is not linked to a Pterodactyl ID.");
      }
      
      let genpassword = null;
      if (settings.passwordgenerator.signup) genpassword = makeid(settings.passwordgenerator.length);

      // Attempt to create Pterodactyl account
      let accountResponse = await fetch(`${settings.pterodactyl.domain}/api/application/users`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          "Authorization": `Bearer ${settings.pterodactyl.key}`
        },
        body: JSON.stringify({
          username: userinfo.id, // Use Discord ID as Pterodactyl username
          email: userinfo.email,
          first_name: userinfo.username,
          last_name: "#" + userinfo.discriminator, // Using discriminator as last name
          password: genpassword,
          external_id: userinfo.id // Store Discord ID as external_id on Pterodactyl
        })
      });

      if (accountResponse.status === 201) { // Pterodactyl account created successfully
        let accountinfo = await accountResponse.json();
        await db.user.update({
          where: { id: userinfo.id },
          data: {
            pterodactylId: accountinfo.attributes.id,
            ipAddress: ip // Set IP address on successful account creation/linking
          }
        });
        localUser.pterodactylId = accountinfo.attributes.id; // Update localUser object
        localUser.ipAddress = ip;

        req.session.newaccount = true;
        req.session.password = genpassword;
        log('signup', `${userinfo.username} created a new Pterodactyl account and logged in for the first time! Ptero ID: ${accountinfo.attributes.id}`);

      } else { // Pterodactyl account creation failed, try to find existing by email
        let accountListResponse = await fetch(`${settings.pterodactyl.domain}/api/application/users?include=servers&filter[email]=${encodeURIComponent(userinfo.email)}`, {
          method: "GET",
          headers: {
            'Content-Type': 'application/json',
            "Authorization": `Bearer ${settings.pterodactyl.key}`
          }
        });

        if (!accountListResponse.ok) {
            const errorBody = await accountListResponse.text();
            console.error("Pterodactyl API error (listing users by email):", errorBody);
            return res.send("An error occurred while trying to find your Pterodactyl account by email.");
        }
        
        let accountlist = await accountListResponse.json();
        let pteroUserAccount = accountlist.data.find(acc => acc.attributes.email.toLowerCase() === userinfo.email.toLowerCase());

        if (pteroUserAccount) {
          // Found Pterodactyl account with this email. Check if it's already linked to another Discord User in our DB.
          const existingLink = await db.user.findFirst({
            where: {
              pterodactylId: pteroUserAccount.attributes.id,
              NOT: { id: userinfo.id } // Exclude current Discord user
            }
          });

          if (existingLink) {
            return res.send("A Pterodactyl account with your email is already linked to a different Discord account in our system.");
          }

          // Link this Pterodactyl account to the current Discord user
          await db.user.update({
            where: { id: userinfo.id },
            data: {
                pterodactylId: pteroUserAccount.attributes.id,
                // Update email and username from Discord if they were different, or keep Ptero's? For now, assume Discord is source of truth for name/email on our User model.
                email: userinfo.email,
                username: userinfo.username,
                ipAddress: ip // Set IP address
            }
          });
          localUser.pterodactylId = pteroUserAccount.attributes.id; // Update localUser object
          localUser.ipAddress = ip;
          req.session.pterodactyl = pteroUserAccount.attributes; // For immediate session use
          log('link', `${userinfo.username} linked to existing Pterodactyl account ID ${pteroUserAccount.attributes.id} via email.`);

        } else {
          // Pterodactyl account creation failed AND no account found with that email
          const errorBody = await accountResponse.text(); // Get error from the initial creation attempt
          console.error("Pterodactyl account creation failed:", errorBody);
          return res.send("Failed to create your Pterodactyl account, and no existing account found with your email. Please contact support.");
        }
      }
    }

    // Final fetch of Pterodactyl user data for the session, using the now confirmed localUser.pterodactylId
    if (!localUser.pterodactylId) {
        // This should ideally not be reached if logic above is correct
        console.error("Error: Pterodactyl ID still not set for user:", userinfo.id);
        return res.send("Could not link your account to Pterodactyl. Please try again or contact support.");
    }

    const pterodactylUserDetails = await getPteroUser(userinfo.id, db); // db is PrismaClient
    if (!pterodactylUserDetails) {
        log('pterofetch_fail', `Failed to fetch Pterodactyl details for user ${userinfo.id} (Ptero ID: ${localUser.pterodactylId}) after login/linking.`);
        return res.send("Could not fetch your Pterodactyl account details. Please try logging in again.");
    }

    req.session.pterodactyl = pterodactylUserDetails.attributes;
    req.session.userinfo = userinfo;
    return res.redirect("/dashboard");
  });
};

function makeid(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  let result = Array.from({ length }, () => characters.charAt(Math.floor(Math.random() * charactersLength))).join('');
  return result;
};