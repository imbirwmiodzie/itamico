export interface Config {
  databaseUrl: string;
  token: string;
  port: number;
  timeZone: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  const token = env.MCP_TOKEN;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!token || token.length < 16) throw new Error("MCP_TOKEN is required (at least 16 characters)");

  const timeZone = env.TUTOR_TZ || "Europe/Warsaw";
  // Throws RangeError on an unknown zone, so a typo fails at boot, not mid-ride.
  new Intl.DateTimeFormat("en-CA", { timeZone });

  return { databaseUrl, token, port: Number(env.PORT) || 8080, timeZone };
}
