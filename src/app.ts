import { createHash, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Store } from "./store.js";
import { renderStats } from "./stats.js";
import { buildServer } from "./tools.js";

/**
 * HTTP app exposing the MCP endpoint over Streamable HTTP, stateless: every
 * POST gets a fresh server + transport, so any instance can serve any request.
 *
 * Auth accepts either
 *   - `Authorization: Bearer <token>` on /mcp (OpenAI Realtime, Gemini, scripts), or
 *   - the token as the last path segment, /mcp/<token>, for clients that can
 *     only be given a URL (Claude app custom connectors, which offer OAuth or
 *     nothing at all).
 */
export function createApp(store: Store, token: string) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const expected = digest(token);
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const pathToken = typeof req.params.token === "string" ? req.params.token : undefined;
    const header = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const given = pathToken ?? header;
    if (given && timingSafeEqual(digest(given), expected)) return next();
    if (pathToken !== undefined) return res.status(404).end();
    res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "unauthorized" });
  };

  const handle = async (req: Request, res: Response) => {
    if (req.method !== "POST") {
      // Stateless server: no standalone SSE stream and no session to delete.
      return res.status(405).set("Allow", "POST").json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      });
    }
    const started = Date.now();
    const server = buildServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
      const call = req.body?.method === "tools/call" ? ` ${req.body.params?.name}` : "";
      console.log(`${req.body?.method ?? "?"}${call} ${res.statusCode} ${Date.now() - started}ms`);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  };

  app.all("/mcp", auth, handle);
  app.all("/mcp/:token", auth, handle);

  // Learning stats page. Same token as the connector URL; the URL is the secret,
  // so keep it out of caches, referrers and search engines.
  app.get("/stats/:token", auth, async (_req, res) => {
    try {
      const html = renderStats(await store.stats());
      res
        .set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" })
        .type("html")
        .send(html);
    } catch (e) {
      console.error(e);
      res.status(500).type("text").send("Could not load stats.");
    }
  });
  return app;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}
