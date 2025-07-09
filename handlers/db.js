const { PrismaClient } = require('@prisma/client');
const readAppSettings = require('./readSettings').settings; // Renamed to avoid conflict

let prismaInstance;

function getPrismaInstance() {
  if (!prismaInstance) {
    const appSettings = readAppSettings(); // Read settings.yml

    if (!appSettings.database || appSettings.database.driver !== 'postgresql') {
      throw new Error("Database configuration for PostgreSQL is missing or incorrect in settings.yml");
    }

    const dbConfig = appSettings.database;
    const user = encodeURIComponent(dbConfig.user);
    const password = encodeURIComponent(dbConfig.password);
    const host = encodeURIComponent(dbConfig.host);
    const port = dbConfig.port;
    const dbName = encodeURIComponent(dbConfig.name);
    const schema = encodeURIComponent(dbConfig.schema || 'public');

    // Construct the DATABASE_URL from settings.yml
    // Example: postgresql://user:password@host:port/dbname?schema=public
    const connectionString = `postgresql://${user}:${password}@${host}:${port}/${dbName}?schema=${schema}`;

    // Initialize Prisma Client with the dynamically constructed URL
    prismaInstance = new PrismaClient({
      datasources: {
        db: {
          url: connectionString,
        },
      },
    });
    console.log("Prisma Client initialized with connection string from settings.yml");
  }
  return prismaInstance;
}

// Export a function that returns the instance, ensuring it's initialized only once.
module.exports = getPrismaInstance();


// Optional: Graceful shutdown (needs to access the instance)
// async function onShutdown() {
//   if (prismaInstance) {
//     await prismaInstance.$disconnect();
//   }
// }
//
// process.on('SIGINT', async () => {
//   await onShutdown();
//   process.exit(0);
// });
//
// process.on('SIGTERM', async () => {
//   await onShutdown();
//   process.exit(0);
// });
