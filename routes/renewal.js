const settings = require('../handlers/readSettings').settings(); 
const { CronJob } = require("cron");
const getAllServers = require("../handlers/getAllServers");
const fetch = require("node-fetch");
const chalk = require("chalk");

module.exports.load = async (app, db) => { // db is Prisma Client

    app.get(`/api/renewalstatus`, async (req, res) => {
        const serverId = req.query.id;
        if (
             !settings.renewals.status
          || !serverId
          || !req.session
          || !req.session.pterodactyl
          || !req.session.userinfo
          // Ensure the server ID from query params belongs to the logged-in user's servers
          || !req.session.pterodactyl.relationships.servers.data.find(server => server.attributes.id.toString() === serverId)
        ) {
          return res.json({ error: true, message: "Invalid request or server not found for user." });
        }

        const renewalRecord = await db.serverRenewal.findUnique({
          where: { pterodactylServerId: serverId }
        });

        if (!renewalRecord || !renewalRecord.lastRenewedAt) {
          // If no record, or lastRenewedAt is null, perhaps it's "Disabled" or "Not yet renewed"
          // Original logic: if (!lastRenewal) return res.json({ text: "Disabled" });
          // For a server that *should* be renewable, this might mean it's overdue from the start.
          // Let's consider a server that exists but has no renewal record as needing renewal if renewals are active.
          // This part needs careful thought based on desired system behavior for new servers.
          // For now, sticking close to original: if no record, "Disabled".
           return res.json({ text: "Renewal not tracked", renewable: false }); // Modified "Disabled"
        }

        // The original logic `if (!lastRenewal < Date.now())` is confusing.
        // It seems to intend `if (lastRenewal >= Date.now())` for "Renewed" or future renewal.
        // Or `if (!(lastRenewal < Date.now()))` which is `lastRenewal >= Date.now()`.
        // Let's clarify: if lastRenewedAt is in the future, it's an anomaly. If in past, calculate time to renew or if overdue.

        const lastRenewedAtTime = renewalRecord.lastRenewedAt.getTime();
        const now = Date.now();
        const renewalDelayMs = settings.renewals.delay * 86400000;

        if (lastRenewedAtTime > now) { // Should not happen if logic is correct elsewhere
            return res.json({ text: "Renewed (future date anomaly)", success: true, renewable: false });
        }

        if ((now - lastRenewedAtTime) > renewalDelayMs) {
            return res.json({ text: "Time to renew", renewable: true });
        }

        const timeRemainingMs = renewalDelayMs - (now - lastRenewedAtTime);
        const time = msToDaysAndHours(timeRemainingMs);
        return res.json({ text: time, renewable: false });
    });

    app.get(`/renew`, async (req, res) => {
      if (!settings.renewals.status) return res.redirect("/dashboard?err=RENEWALSDISABLED");

      const serverId = req.query.id;
      const discordUserId = req.session.userinfo ? req.session.userinfo.id : null;

      if (!serverId) return res.send("Missing server ID.");
      if (!discordUserId) return res.redirect("/login?err=SESSIONEXPIRED"); // Should be caught by session check too
      if (!req.session || !req.session.pterodactyl || !req.session.userinfo) return res.redirect("/login");
      
      const serverDetails = req.session.pterodactyl.relationships.servers.data.find(s => s.attributes.id.toString() === serverId);
      if (!serverDetails) return res.send(`Server with ID ${serverId} not found or not associated with your account.`);
  
      const user = await db.user.findUnique({ where: { id: discordUserId } });
      if (!user) return res.redirect("/login?err=USERNOTFOUNDDB"); // Should not happen

      const renewalRecord = await db.serverRenewal.findUnique({
          where: { pterodactylServerId: serverId }
      });

      const currentTime = Date.now();
      const renewCost = settings.renewals.cost;

      if (!renewalRecord || !renewalRecord.lastRenewedAt) {
          // No existing renewal record, or lastRenewedAt is null.
          // This is the first time this server is being "renewed" or its record initialized.
          // Original: await db.set(`lastrenewal-${req.query.id}`, currentTime); return res.redirect("/dashboard?err=NORENEWRECORD");
          // We should charge for this first "renewal" if that's the intent.
          if (renewCost > (user.coins || 0)) return res.redirect("/dashboard?err=CANNOTAFFORDFIRSTRENEWAL");

          try {
            await db.$transaction([
                db.user.update({
                    where: { id: discordUserId },
                    data: { coins: { decrement: renewCost } }
                }),
                db.serverRenewal.upsert({
                    where: { pterodactylServerId: serverId },
                    update: { lastRenewedAt: new Date(currentTime), userId: discordUserId },
                    create: { pterodactylServerId: serverId, lastRenewedAt: new Date(currentTime), userId: discordUserId }
                })
            ]);
            return res.redirect("/dashboard?success=SERVERRENEWEDFIRST");
          } catch (error) {
            console.error(`Error during first renewal for server ${serverId}, user ${discordUserId}:`, error);
            return res.redirect("/dashboard?err=RENEWALFAILED");
          }
      }
  
      const lastRenewedAtTime = renewalRecord.lastRenewedAt.getTime();
      const nextEligibleRenewalTime = lastRenewedAtTime + (settings.renewals.delay * 86400000);
  
      if (currentTime < nextEligibleRenewalTime) {
        const timeRemaining = msToDaysAndHours(nextEligibleRenewalTime - currentTime);
        return res.redirect(`/dashboard?err=NOTYETELIGIBLE&timeleft=${encodeURIComponent(timeRemaining)}`);
      }
  
      if (renewCost > (user.coins || 0)) return res.redirect("/dashboard?err=CANNOTAFFORDRENEWAL");
      
      try {
        await db.$transaction([
            db.user.update({
                where: { id: discordUserId },
                data: { coins: { decrement: renewCost } }
            }),
            db.serverRenewal.update({ // Record must exist here
                where: { pterodactylServerId: serverId },
                data: { lastRenewedAt: new Date(currentTime) }
            })
        ]);
        return res.redirect("/dashboard?success=RENEWED");
      } catch (error) {
        console.error(`Error during renewal for server ${serverId}, user ${discordUserId}:`, error);
        return res.redirect("/dashboard?err=RENEWALFAILED");
      }
  });

    new CronJob(`0 0 * * *`, async () => {
        if (settings.renewals.status) {
          console.log(`${chalk.cyan("[heliactyl]")}${chalk.white(" Checking renewal servers... ")}`);
            getAllServers().then(async servers => { // getAllServers might need to be adapted if it uses db
                for (const server of servers) {
                    const serverId = server.attributes.id.toString(); // Ensure string for consistency
                    const renewalRecord = await db.serverRenewal.findUnique({
                         where: { pterodactylServerId: serverId }
                    });

                    if (!renewalRecord || !renewalRecord.lastRenewedAt) continue; // No renewal record or not yet renewed

                    // lastRenewal > Date.now() was original check, seems like an error, should be lastRenewedAt <= now
                    if (renewalRecord.lastRenewedAt.getTime() > Date.now()) continue;

                    if ((Date.now() - renewalRecord.lastRenewedAt.getTime()) > (settings.renewals.delay * 86400000)) {
                        // Server hasn't paid for renewal and gets suspended
                        let suspensionResult = await fetch(`${settings.pterodactyl.domain}/api/application/servers/${serverId}/suspend`, {
                            method: "POST",
                            headers: {
                                'Content-Type': 'application/json',
                                "Authorization": `Bearer ${settings.pterodactyl.key}`
                            }
                          });
                        if (!suspensionResult.ok) {
                            console.error(`Failed to suspend server ${serverId} during cron renewal check. Status: ${suspensionResult.status}`);
                            continue; // Don't delete record if suspension failed
                        }
                        console.log(`Server with ID ${serverId} failed renewal and was suspended.`);
                        // Deleting the renewal record means it won't be checked again until manually renewed.
                        // This matches original logic of db.delete(`lastrenewal-${id}`);
                        await db.serverRenewal.delete({
                            where: { pterodactylServerId: serverId }
                        });
                    }
                }
            }).catch(err => {
                console.error(`${chalk.cyan("[Heliactyl]")}${chalk.red(" Error during renewal cron job server processing: ")}`, err);
            });
            console.log(`${chalk.cyan("[Heliactyl]")}${chalk.white("The renewal check-over is now complete.")}`);
        }
    }, null, true, settings.timezone).start()
};

function msToDaysAndHours(ms) {
  const msInDay = 86400000;
  const msInHour = 3600000;

  const days = Math.floor(ms / msInDay);
  const hours = Math.round((ms - days * msInDay) / msInHour * 100) / 100;

  const pluralDays = days === 1 ? "" : "s";
  const pluralHours = hours === 1 ? "" : "s";

  return `${days} day${pluralDays} and ${hours} hour${pluralHours}`;
};