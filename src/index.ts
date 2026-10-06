import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { Pictures } from "./pictures.js";
import { Store } from "./store.js";

const config = loadConfig();
const db = createPool(config.databaseUrl);
await migrate(db);

const app = createApp(new Store(db, config.timeZone), config.token, new Pictures({ pexelsKey: config.pexelsKey }));
const server = app.listen(config.port, config.host, () => {
  console.log(`italian-tutor MCP server on ${config.host}:${config.port} (POST /mcp), tz ${config.timeZone}, photos from ${config.pexelsKey ? "Pexels" : "Wikimedia Commons"}`);
});

const shutdown = () => {
  server.close();
  db.end().finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
