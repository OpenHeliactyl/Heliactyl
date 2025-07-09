const indexjs = require("../index");
const ejs = require("ejs");
const express = require("express");
const { getPteroUser } = require('../handlers/getPteroUser'); // Updated import
const { renderDataEval } = require('../handlers/dataRenderer');

module.exports.load = function(app, db) { // db is Prisma Client
  app.use('/assets', express.static('./assets'));

  // Handle requests to the root path
  app.all("/", async (req, res) => {
    const theme = indexjs.get(req);

    if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname) && (!req.session || !req.session.pterodactyl || !req.session.userinfo)) {
      return res.redirect("/login");
    }

    const filePath = `./themes/${theme.name}/index.ejs`;
    renderPage(filePath, await renderDataEval(req), req, res);
  });

  // Handle all other requests
  app.all("*", async (req, res) => {
    if (req.session.pterodactyl && req.session.userinfo && req.session.userinfo.id) {
      const userFromDb = await db.user.findUnique({
        where: { id: req.session.userinfo.id },
        select: { pterodactylId: true }
      });
      const pterodactylIdFromDb = userFromDb ? userFromDb.pterodactylId : null;

      if (req.session.pterodactyl.id !== pterodactylIdFromDb) {
        // Pterodactyl ID in session does not match the one in DB for this Discord user.
        // This could indicate a session issue or that the link has changed.
        // Forcing re-login is a safe default.
        return res.redirect("/login?prompt=none&reason=ptero_id_mismatch");
      }
    } else if (req.session.pterodactyl && (!req.session.userinfo || !req.session.userinfo.id)) {
      // Has Pterodactyl session but no Discord userinfo session, indicates an inconsistent state.
      return res.redirect("/login?prompt=none&reason=missing_userinfo");
    }

    const theme = indexjs.get(req);

    if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname) && (!req.session || !req.session.pterodactyl || !req.session.userinfo)) {
      return res.redirect("/login" + (req._parsedUrl.pathname.startsWith("/") ? "?redirect=" + req._parsedUrl.pathname.slice(1) : ""));
    }

    if (req._parsedUrl.pathname === "/admin") {
      renderAdminPage(req, res, theme, db);
      return;
    }

    const filePath = `./themes/${theme.name}/${theme.settings.pages[req._parsedUrl.pathname.slice(1)] || "404.ejs"}`;
    renderPage(filePath, await renderDataEval(req), req, res);
  });
};

async function renderAdminPage(req, res, theme, db) {
  const data = await renderDataEval(req);
  ejs.renderFile(`./themes/${theme.name}/404.ejs`, data, null, async (error, str) => {
    delete req.session.newaccount;
    if (!req.session || !req.session.pterodactyl || !req.session.userinfo || error) {
      console.error(`[WEBSITE] An error occurred on path ${req._parsedUrl.pathname}:`, error);
      return res.render("404.ejs", { error });
    }

    const cacheAccount = await getPteroUser(req.session.userinfo.id, db);
    if (!cacheAccount) return res.send(str);

    req.session.pterodactyl = cacheAccount.attributes;
    if (!cacheAccount.attributes.root_admin) return res.send(str);

    renderPage(`./themes/${theme.name}/index.ejs`, await renderDataEval(req), req, res);
  });
}

function renderPage(filePath, data, req, res) {
  ejs.renderFile(filePath, data, null, (error, str) => {
    if (error) {
      console.error(`[WEBSITE] An error occurred on path ${req._parsedUrl.pathname}:`, error);
      return res.render("404.ejs", { error });
    }
    delete req.session.newaccount;
    res.send(str);
  });
}