import { createPool, migrate } from "./db.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = createPool(url);
await migrate(db);
await db.end();
console.log("schema applied");
