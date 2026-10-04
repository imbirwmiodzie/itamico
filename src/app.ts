import { createHash, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { renderItems } from "./items.js";
import { PRIVATE_HEADERS } from "./page.js";
import { type ItemFilter, SOURCES, type Store, TutorError } from "./store.js";
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

  // Browser pages. Same token as the connector URL; the URL is the secret, so
  // keep it out of caches, referrers and search engines (PRIVATE_HEADERS).
  const page = (render: (req: Request) => Promise<string>) => async (req: Request, res: Response) => {
    try {
      res.set(PRIVATE_HEADERS).type("html").send(await render(req));
    } catch (e) {
      console.error(e);
      res.status(500).type("text").send("Something went wrong; see the server log.");
    }
  };
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const filterOf = (v: unknown): ItemFilter =>
    (["all", "due", "nocontext", "failed"] as const).find((f) => f === v) ?? "all";

  app.get("/stats/:token", auth, page(async (req) => renderStats(await store.stats(), req.params.token as string)));

  app.get(
    "/items/:token",
    auth,
    page(async (req) => {
      const q = str(req.query.q).slice(0, 200);
      const filter = filterOf(req.query.filter);
      const { items, total } = await store.searchItems(q, filter);
      const open = Number(req.query.open) || undefined;
      return renderItems({ token: req.params.token as string, q, filter, items, total, open, msg: str(req.query.msg), err: str(req.query.err) });
    }),
  );

  // Form posts redirect back to the search they came from (post/redirect/get).
  const form = express.urlencoded({ extended: false, limit: "100kb" });
  const back = (req: Request, res: Response, extra: Record<string, string | number>) => {
    const qs = new URLSearchParams({ q: str(req.body.q), filter: filterOf(req.body.filter), ...extra } as Record<string, string>);
    const anchor = extra.open ? `#i${extra.open}` : "";
    res.set(PRIVATE_HEADERS).redirect(303, `/items/${encodeURIComponent(req.params.token as string)}?${qs}${anchor}`);
  };
  const fields = (b: Record<string, unknown>) => ({
    italian: str(b.italian),
    english: str(b.english),
    note: str(b.note),
    context: str(b.context),
    source: str(b.source),
  });

  app.post("/items/:token/new", auth, form, async (req, res) => {
    try {
      const f = fields(req.body);
      const source = SOURCES.find((x) => x === f.source);
      if (!source) throw new TutorError(`unknown source "${f.source}"`);
      const { item, status } = await store.captureItem({ ...f, source });
      back(req, res, { msg: status === "captured" ? `Added “${item.italian}”.` : `“${item.italian}” already existed; it is due today again.`, open: item.id });
    } catch (e) {
      if (!(e instanceof TutorError)) console.error(e);
      back(req, res, { err: e instanceof TutorError ? e.message : "Could not add the word." });
    }
  });

  app.post("/items/:token/:id", auth, form, async (req, res) => {
    const id = Number(req.params.id);
    try {
      if (!Number.isInteger(id)) throw new TutorError("bad item id");
      switch (str(req.body.action)) {
        case "delete":
          return back(req, res, { msg: `Deleted “${await store.deleteItem(id)}”.` });
        case "reset":
          return back(req, res, { msg: `“${await store.resetItem(id)}” is due today.`, open: id });
        default:
          return back(req, res, { msg: `Saved “${await store.updateItem(id, fields(req.body))}”.`, open: id });
      }
    } catch (e) {
      if (!(e instanceof TutorError)) console.error(e);
      back(req, res, { err: e instanceof TutorError ? e.message : "Could not save.", open: id });
    }
  });
  return app;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}
