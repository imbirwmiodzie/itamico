import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { Store } from "./store.js";

const config = loadConfig();
const db = createPool(config.databaseUrl);
await migrate(db);

const app = createApp(new Store(db, config.timeZone), config.token);
const server = app.listen(config.port, () => {
  console.log(`italian-tutor MCP server on :${config.port} (POST /mcp), tz ${config.timeZone}`);
});

const shutdown = () => {
  server.close();
  db.end().finally(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
