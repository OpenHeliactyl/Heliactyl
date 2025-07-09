> [!CAUTION]
> Overnode no longer recommends using Heliactyl, Heliactyl is a piece of old software and as such contains multiple security vulnerabilities.
> What to do? Use [Fixed Palladium](https://github.com/OvernodeProjets/Fixed-Palladium) or [Plexactyl](https://github.com/Plexactyl/panel).<br>
> Is Fixed Heliactyl still updated? Yes, but not fully, as Heliactyl contains security vulnerabilities, Overnode no longer prioritizes Fixed Heliactyl for support.
# Fixed Heliactyl • The Modern Client Panel for Pterodactyl

![Heliactyl](https://github.com/OvernodeProjets/Fixed-Heliactyl/assets/73477238/fe5aaf5c-1c01-4145-b37a-b91b184354b5)

## Features

- **Resource Management**: Create servers, manage resources.
- **Coins**: Earn through AFK pages, J4R, Coupon.
- **Renewal**: Use coins for server renewal.
- **Coupons**: Distribute resources and coins.
- **Servers**: Create, view, and edit servers.
- **Payments**: Stripe integration for purchases.
- **User System**: Authentication, password regeneration, etc.
- **Store**: Purchase resources with coins.
- **Dashboard**: Overview of resources.
- **Join for Rewards**: Earn coins by joining Discord servers.
- **Admin Panel**: Manage coins, resources, coupons.
- **API**: For bots and other integrations.

## Install Guide

### 1. Configuring Heliactyl

#### Pterodactyl Method (Easiest)

1. **Upload File**: Upload the Heliactyl file to a Pterodactyl NodeJS server. [Download the egg from Pelican Eggs Library](https://github.com/pelican-eggs/generic/blob/main/nodejs/egg-pterodactyl-node-js-generic.json)
2. **Setup NodeJS**: Unarchive the file and set the server to use NodeJS 16.

#### Direct Method

1. **Install Node.js 16 or newer it's recommended to install it with nvm**:

- `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash`
- reopen a new ssh session (e.g., restart putty)
- `nvm install 16`
- check the node version with `node -v` and switch between versions with `nvm use <version>`

2. **Download heliactyl files in /var/www/heliactyl**:

- `git clone https://github.com/OvernodeProjets/Fixed-Heliactyl.git /var/www/heliactyl`

3. **Installing required node modules (and build dependencies to avoid errors)**:

- `apt-get update && apt-get install libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev build-essential`
- `cd /var/www/heliactyl && npm i`
- **Important Database Change:** This version of Heliactyl now uses PostgreSQL. Database connection for the application runtime is configured in `settings.yml`. Please refer to [DATABASE_SETUP.md](DATABASE_SETUP.md) for detailed instructions on setting up PostgreSQL and configuring Heliactyl. The `build-essential` dependencies listed above might still be useful for other Node.js native modules.

After configuring `settings.yml` (including the new `database` section as per [DATABASE_SETUP.md](DATABASE_SETUP.md)), to start the server, use `node index.js`.</br>
To run in the background, use PM2 (see PM2 section)</br>

## 2. Setting up webserver

1. Configure `settings.yml` (rename from `settings_example.yml` if needed). This now includes general application settings (panel domain/API key, Discord OAuth) **and the PostgreSQL database connection details** for the application runtime. Refer to [DATABASE_SETUP.md](DATABASE_SETUP.md) for guidance on the `database` section.
2. After installing dependencies with `npm install`, apply the initial database schema by running `DATABASE_URL="your_constructed_db_url" npx prisma db push` in the Heliactyl root directory. **See [DATABASE_SETUP.md](DATABASE_SETUP.md) for how to construct this URL and why it's needed for Prisma CLI commands.**

3. Start the server.

3. Login to your DNS manager, point the domain you want your dashboard to be hosted on to your VPS IP address. (Example: dashboard.domain.com 192.168.0.1)

4. Run `apt install nginx && apt install certbot` on the vps

5. Run `ufw allow 80` and `ufw allow 443` on the vps

6. Run `certbot certonly -d <Your Heliactyl Domain>` then do 1 and put your email

7. Run `nano /etc/nginx/sites-enabled/heliactyl.conf`

8. Paste the configuration at the bottom of this and replace with the IP of the pterodactyl server including the port and with the domain you want your dashboard to be hosted on.

9. Run `systemctl restart nginx` and try open your domain.

## Nginx Proxy Config

```Nginx
server {
    listen 80;
    listen [::]:80;
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name <domain>;

    ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers 'HIGH:!aNULL:!MD5:!ECDHE-RSA-AES128-SHA';
    
    if ($scheme = http) {
        return 301 https://$server_name$request_uri;
    }

    location /afk/ws {
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_pass http://localhost:<port>/afk/ws;
    }
    
    location / {
        proxy_pass http://localhost:<port>/;
        proxy_buffering off;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

<hr>

## Updating

### From Older SQLite-based Versions (e.g., Heliactyl v11/v13, Dashactyl v0.4) to This PostgreSQL Version:

**Important:** This version uses PostgreSQL and Prisma, which is a significant change from the SQLite (`database.sqlite`) based versions. Direct upgrade by replacing files and reusing `database.sqlite` is **not possible**.

1.  **Backup Your Existing Data:**
    *   Securely back up your `database.sqlite` file.
    *   Back up your `settings.yml` and any other custom configuration files.
2.  **Set Up New Instance:** Follow the main installation guide in this README to set up a fresh instance of this version, including setting up PostgreSQL as per [DATABASE_SETUP.md](DATABASE_SETUP.md).
3.  **Data Migration (Manual & Complex):**
    *   Migrating data from SQLite to the new PostgreSQL schema is a manual process and will require custom scripting. You would need to:
        *   Understand the old SQLite schema (likely a key-value store similar to what was refactored).
        *   Understand the new PostgreSQL schema defined in `prisma/schema.prisma`.
        *   Write scripts to extract data from SQLite, transform it, and load it into the PostgreSQL database using Prisma Client or direct SQL.
    *   **This project does not currently provide an automated migration script.** Data migration complexity will depend on how much data and what types of data (users, coupons, etc.) you need to preserve.
    *   Consider starting fresh if data migration is too complex for your needs.
4.  **Reconfigure `settings.yml` and other settings as needed.**

### Moving from a version that already uses PostgreSQL with this Prisma schema:

1.  Backup your PostgreSQL database.
2.  Backup your `settings.yml` file.
3.  Replace the application files with the new version.
4.  Run `npm install` to get any new dependencies.
5.  Run `DATABASE_URL="your_constructed_db_url_from_settings" npx prisma db push` to apply any schema changes. See [DATABASE_SETUP.md](DATABASE_SETUP.md) for how to construct the `DATABASE_URL`.
6.  Review your `settings.yml` against `settings_example.yml` for any new configuration options.

<hr>

## Running in background / on startup, on a server instead of within Pterodactyl

### Installing [pm2](https://github.com/Unitech/pm2):

- Run `npm install pm2 -g` on the server

### Starting the Dashboard in Background:

- Change directory to your Heliactyl folder Using `cd` command, Example: `cd /var/www/heliactyl`
- To run Heliactyl, use `pm2 start index.js --name "heliactyl"`
- To view logs, run `pm2 logs Heliactyl`

### Making the dashboard run on startup:

- Make sure your dashboard is running in the background with the help of [pm2](https://github.com/Unitech/pm2)
- You can check if Heliactyl is running in the background with `pm2 list`
- Once you confirm that Heliactyl is running in the background, you can create a startup script by running `pm2 startup` and `pm2 save`
- Note: Supported init systems are `systemd`, `upstart`, `launchd`, `rc.d`
- To stop your Heliactyl from running in the background, use `pm2 unstartup`

To stop a currently running Heliactyl instance, use `pm2 stop heliactyl`

<br>

## For developers:
Fixed Heliacty l2.8 has major changes in how settings are parsed, instead of them being parsed with the "settings.api.client", we've completely removed that.
We've provided a guide here on how to make your Heliactyl themes compatible with Fixed Heliactyl.
To fix the unknown setting issue, replace `settings.api.client` with `settings` in all of your files.

## Credit:
 - Dashactyl 0.3.1 & 0.4 (0.3.1 Base - 0.4 Database System)
 - Heliactyl (v12 Base - v14 Api Documentation - v15 Afk System but remade)
 - Faliactyl (Settings system)

> [!WARNING]
>
> We cannot force you to keep "Powered by Heliactyl" in the footer, but please consider keeping it. It helps to get more visibility for the project, which is getting better. We won't > provide technical support for installations without the notice in the footer. We may DMCA the website under certain conditions.
> Please do keep the footer, though.
