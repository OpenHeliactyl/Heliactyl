# Database Setup for Heliactyl (PostgreSQL & Prisma)

This document guides you through setting up the PostgreSQL database required for this version of Heliactyl, which uses Prisma as its Object-Relational Mapper (ORM).

## 1. Install PostgreSQL

If you don't already have PostgreSQL installed, you'll need to install it on your server.

*   **Official Downloads:** [PostgreSQL Downloads](https://www.postgresql.org/download/)
*   **DigitalOcean Guides (Choose your OS):**
    *   [How To Install and Use PostgreSQL on Ubuntu](https://www.digitalocean.com/community/tutorials/how-to-install-and-use-postgresql-on-ubuntu-20-04)
    *   [How To Install and Use PostgreSQL on CentOS](https://www.digitalocean.com/community/tutorials/how-to-install-and-use-postgresql-on-centos-7)

Follow the instructions for your operating system. Make sure the PostgreSQL service is started and enabled.

## 2. Create a Database and User

You'll need to create a dedicated database and a user for Heliactyl.

1.  **Connect to PostgreSQL:**
    Open the PostgreSQL command-line interface, usually by switching to the `postgres` user and running `psql`:
    ```bash
    sudo -u postgres psql
    ```

2.  **Create a User:**
    Replace `your_password` with a strong, unique password.
    ```sql
    CREATE USER heliactyl_user WITH ENCRYPTED PASSWORD 'your_password';
    ```

3.  **Create a Database:**
    ```sql
    CREATE DATABASE heliactyl_db OWNER heliactyl_user;
    ```

4.  **Grant Privileges (Optional but Recommended):**
    While the `OWNER` has all privileges, you might grant specific ones if needed, or if you created the user and DB separately:
    ```sql
    GRANT ALL PRIVILEGES ON DATABASE heliactyl_db TO heliactyl_user;
    ```

5.  **Exit psql:**
    ```
    \q
    ```

## 3. Configure Heliactyl (settings.yml)

This version of Heliactyl reads its runtime database connection details directly from `settings.yml`.

1.  **Locate/Rename `settings_example.yml`:**
    In the root of your Heliactyl installation, find `settings_example.yml`. Rename it to `settings.yml` if you haven't already.

2.  **Configure Database Section in `settings.yml`:**
    Open `settings.yml` and locate the `database:` section. Update it with your PostgreSQL details:
    ```yaml
    database:
      driver: "postgresql"
      host: "your_postgres_host"  # e.g., localhost
      port: 5432                 # Default PostgreSQL port
      user: "your_db_user"       # e.g., heliactyl_user
      password: "your_db_password" # The password you set for the user
      name: "your_db_name"       # e.g., heliactyl_db
      schema: "public"           # Usually 'public'
    ```
    Replace the placeholder values with the actual credentials and names you created in Step 2.
    **Security Note:** Be mindful of committing `settings.yml` to public repositories if it contains real passwords. Consider using environment variables for sensitive data in production or secure your `settings.yml` file appropriately.

## 4. Apply Database Schema with Prisma (CLI Requirement)

Prisma's Command Line Interface (CLI) tools (like `npx prisma db push` or `npx prisma migrate dev`) are used to manage and apply schema changes to your database. These tools expect the database connection string to be available as an environment variable named `DATABASE_URL`.

Since the application runtime now uses `settings.yml`, you need to provide this `DATABASE_URL` to the Prisma CLI separately when you run such commands.

1.  **Navigate to Heliactyl Directory:**
    ```bash
    cd /path/to/heliactyl
    ```

2.  **Construct your `DATABASE_URL`:**
    Based on your `settings.yml` configuration, your `DATABASE_URL` will look like this:
    `postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME?schema=SCHEMA_NAME`
    For example:
    `postgresql://heliactyl_user:your_db_password@your_postgres_host:5432/your_db_name?schema=public`
    Ensure you URL-encode any special characters in your username or password if necessary.

3.  **Run Prisma DB Push with `DATABASE_URL`:**
    Execute the command by prefixing it with the `DATABASE_URL`:
    ```bash
    DATABASE_URL="postgresql://user:pass@host:port/db?schema=public" npx prisma db push
    ```
    Replace the example URL with your actual constructed `DATABASE_URL`. This command will read `prisma/schema.prisma` and apply the schema to your database.

    Alternatively, you can create a temporary `.env` file in the project root containing just the `DATABASE_URL` line before running `npx prisma db push`, and then remove it, or set `DATABASE_URL` as an environment variable in your shell session.

Your database is now set up for both the application runtime (via `settings.yml`) and for Prisma CLI tools (via manually providing `DATABASE_URL`). Proceed with the rest of the Heliactyl setup as outlined in the `README.md`.
