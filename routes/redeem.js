const logToDiscord = require('../handlers/log');

    /*
    {
      ram: x,
      disk: x,
      cpu: x,
      servers: x,
      coins: x
    }
    */

module.exports.load = async function(app, db) { // db is Prisma Client
  app.get("/coupon_redeem", async (req, res) => {
    if (!req.session || !req.session.pterodactyl || !req.session.userinfo) return res.redirect("/login");

    const discordUserId = req.session.userinfo.id;
    const code = req.query.code ? req.query.code.trim().slice(0, 200) : null;

    if (!code) return res.redirect(`/redeem?err=MISSINGCOUPONCODE`);

    const coupon = await db.coupon.findUnique({ where: { code: code } });

    if (!coupon) return res.redirect(`/redeem?err=INVALIDCOUPONCODE`);

    // Implement usage limit if desired (our schema has maxUses and usedCount)
    // For now, replicating original behavior: delete after one use.
    // If (coupon.usedCount >= coupon.maxUses && coupon.maxUses !== null) {
    //   return res.redirect(`/redeem?err=COUPONEXPIREDORMAXED`);
    // }

    const user = await db.user.findUnique({ where: { id: discordUserId } });
    if (!user) {
      // Should not happen if user is logged in, but good to check.
      console.error(`Redeem Error: User ${discordUserId} not found in DB.`);
      return res.redirect('/login?err=USERNOTFOUND');
    }

    // Prepare updates for user resources
    const currentExtraRam = user.extraRam || 0;
    const currentExtraDisk = user.extraDisk || 0;
    const currentExtraCpu = user.extraCpu || 0;
    const currentExtraServers = user.extraServers || 0;
    const currentCoins = user.coins || 0;

    const couponRam = coupon.ram || 0;
    const couponDisk = coupon.disk || 0;
    const couponCpu = coupon.cpu || 0;
    const couponServers = coupon.servers || 0;
    const couponCoins = coupon.coins || 0;

    const newExtraRam = Math.min(currentExtraRam + couponRam, 999999999999999); // Max limits from original code
    const newExtraDisk = Math.min(currentExtraDisk + couponDisk, 999999999999999);
    const newExtraCpu = Math.min(currentExtraCpu + couponCpu, 999999999999999);
    const newExtraServers = Math.min(currentExtraServers + couponServers, 999999999999999);
    const newCoins = currentCoins + couponCoins;

    try {
      // Transaction to update user and delete coupon
      await db.$transaction([
        db.user.update({
          where: { id: discordUserId },
          data: {
            extraRam: newExtraRam,
            extraDisk: newExtraDisk,
            extraCpu: newExtraCpu,
            extraServers: newExtraServers,
            coins: newCoins
          }
        }),
        // If implementing usage counts:
        // db.coupon.update({ where: { code: code }, data: { usedCount: { increment: 1 } } })
        // And then check if coupon should be deleted:
        // if (coupon.maxUses !== null && (coupon.usedCount + 1) >= coupon.maxUses) {
        //   await db.coupon.delete({ where: { code: code } });
        // } else if (coupon.maxUses === null) { // Or if coupon is single use by design (maxUses is null or 1 and it's the first use)
             await db.coupon.delete({ where: { code: code } }) // Original behavior: delete after use
        // }
      ]);

      logToDiscord(
        "coupon redeemed",
        `${req.session.userinfo.username} redeemed the coupon code \`${code}\` which gives:\`\`\`coins: ${couponCoins}\nMemory: ${couponRam} MB\nDisk: ${couponDisk} MB\nCPU: ${couponCpu}%\nServers: ${couponServers}\`\`\``
      );
      res.redirect(`/redeem?success=SUCCESSCOUPONCODE`); // Changed to success= for consistency
    } catch (error) {
      console.error(`Error redeeming coupon ${code} for user ${discordUserId}:`, error);
      // Potentially revert coupon deletion or user update if transaction fails partially, though $transaction handles rollback.
      return res.redirect(`/redeem?err=COUPONREDEMPTIONFAILED`);
    }
  });
}
    );

    res.redirect(`/redeem?err=SUCCESSCOUPONCODE`);
  });
}