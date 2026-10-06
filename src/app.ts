import { createHash, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { renderDrill } from "./drill.js";
import { renderGame } from "./game.js";
import { type ItemsView, renderItems } from "./items.js";
import { PRIVATE_HEADERS } from "./page.js";
import { PhotoError, Pictures, parseCandidate, photoQuery } from "./pictures.js";
import { posterOptions, renderPoster } from "./poster.js";
import { type ItemFilter, SOURCES, type Store, TutorError } from "./store.js";
import { renderStats } from "./stats.js";
import { buildServer } from "./tools.js";
import { renderWidget, widgetOptions } from "./widget.js";

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
export function createApp(store: Store, token: string, pictures: Pictures = new Pictures()) {
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

  // Word list for the Android drill player (android/), Bearer token only.
  app.get("/api/drill", auth, async (req, res) => {
    try {
      const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 20, 1), 100);
      res.set("Cache-Control", "no-store").json(await store.listenItems(limit));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "internal error" });
    }
  });

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
  const form = express.urlencoded({ extended: false, limit: "100kb" });
  const filterOf = (v: unknown): ItemFilter =>
    (["all", "due", "nocontext", "failed"] as const).find((f) => f === v) ?? "all";

  app.get("/drill/:token", auth, page(async (req) => renderDrill(req.params.token as string, await store.drillItems())));

  // One grade from the drill page, scheduled like a voice answer (mode "screen").
  app.post("/drill/:token/grade", auth, async (req, res) => {
    res.set(PRIVATE_HEADERS);
    try {
      const id = Number(req.body?.id);
      const grade = Number(req.body?.grade);
      if (!Number.isInteger(id)) throw new TutorError("bad item id");
      if (!Number.isInteger(grade) || grade < 0 || grade > 5) throw new TutorError("grade must be an integer 0..5");
      res.json(await store.recordAttempt({ item_id: id, mode: "screen", answer: str(req.body.answer).slice(0, 500), grade, fillers: 0 }));
    } catch (e) {
      if (!(e instanceof TutorError)) console.error(e);
      res.status(e instanceof TutorError ? 400 : 500).json({ error: e instanceof TutorError ? e.message : "could not save" });
    }
  });

  app.get("/game/:token", auth, page(async (req) => renderGame(req.params.token as string, await store.gameItems())));

  // A finished game round. Scores only; the game never schedules words.
  app.post("/game/:token/score", auth, async (req, res) => {
    res.set(PRIVATE_HEADERS);
    try {
      const n = (k: string, max: number) => {
        const v = Number(req.body?.[k]);
        if (!Number.isInteger(v) || v < 0 || v > max) throw new TutorError(`${k} must be an integer 0..${max}`);
        return v;
      };
      const r = { score: n("score", 100_000), answered: n("answered", 1000), correct: n("correct", 1000), streak: n("streak", 1000) };
      if (r.correct > r.answered || r.streak > r.correct) throw new TutorError("inconsistent round");
      res.json(await store.saveGameRound(r));
    } catch (e) {
      if (!(e instanceof TutorError)) console.error(e);
      res.status(e instanceof TutorError ? 400 : 500).json({ error: e instanceof TutorError ? e.message : "could not save" });
    }
  });

  // "Drill these today": the words missed in a round, due today with their progress kept.
  app.post("/game/:token/due", auth, async (req, res) => {
    res.set(PRIVATE_HEADERS);
    try {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length > 200 || !ids.every((i) => Number.isInteger(i))) throw new TutorError("ids must be a list of item ids");
      res.json({ count: await store.bringForward(ids) });
    } catch (e) {
      if (!(e instanceof TutorError)) console.error(e);
      res.status(e instanceof TutorError ? 400 : 500).json({ error: e instanceof TutorError ? e.message : "could not save" });
    }
  });

  app.get(
    "/poster/:token",
    auth,
    page(async (req) => {
      const o = posterOptions(req.query);
      return renderPoster(req.params.token as string, o, await store.forgettable(o.n), {
        msg: str(req.query.msg),
        err: str(req.query.err),
        photoSource: pictures.source,
      });
    }),
  );

  // Fill in a photo for every word on the current poster that has none: the
  // first search result for its English. Better ones can be picked on the Words page.
  app.post("/poster/:token/photos", auth, form, async (req, res) => {
    const o = posterOptions(req.body);
    const qs = new URLSearchParams({ layout: o.layout, n: String(o.n), size: o.size, ink: o.ink });
    try {
      const missing = (await store.forgettable(o.n)).words.filter((w) => w.pic === null);
      let added = 0, notFound = 0, failed = 0;
      const queue = [...missing];
      const worker = async () => {
        for (let w = queue.shift(); w; w = queue.shift()) {
          try {
            const q = photoQuery(w.english);
            const [c] = await pictures.search(q, 3);
            if (!c) {
              notFound++;
              continue;
            }
            await store.savePicture(w.id, c, await pictures.download(c), q);
            added++;
          } catch (e) {
            if (!(e instanceof PhotoError)) console.error(e);
            failed++;
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const parts = [`Added ${added} ${added === 1 ? "photo" : "photos"}.`];
      if (notFound) parts.push(`Nothing found for ${notFound}.`);
      if (failed) parts.push(`${failed} could not be fetched.`);
      qs.set(failed && !added ? "err" : "msg", parts.join(" "));
    } catch (e) {
      console.error(e);
      qs.set("err", "Could not add photos.");
    }
    res.set(PRIVATE_HEADERS).redirect(303, `/poster/${encodeURIComponent(req.params.token as string)}?${qs}`);
  });

  // A word's stored photo. The URL carries a version (?v=), so it can be cached.
  app.get("/pic/:token/:id", auth, async (req, res) => {
    try {
      const p = await store.picture(Number(req.params.id) || 0);
      if (!p) return res.status(404).end();
      res
        .set({ ...PRIVATE_HEADERS, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" })
        .type(p.mime)
        .send(p.data);
    } catch (e) {
      console.error(e);
      res.status(500).end();
    }
  });

  app.get("/stats/:token", auth, page(async (req) => renderStats(await store.stats(), req.params.token as string)));

  // Desktop widget: the page, and the data it re-fetches every 10 minutes.
  app.get("/widget/:token", auth, page(async (req) => {
    const o = widgetOptions(req.query);
    return renderWidget(await store.widget(o.n), req.params.token as string, o);
  }));
  app.get("/widget/:token/data", auth, async (req, res) => {
    try {
      res.set(PRIVATE_HEADERS).json(await store.widget(widgetOptions(req.query).n));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "internal error" });
    }
  });

  app.get(
    "/items/:token",
    auth,
    page(async (req) => {
      const q = str(req.query.q).slice(0, 200);
      const filter = filterOf(req.query.filter);
      const { items, total } = await store.searchItems(q, filter);
      const photosFor = Number(req.query.photos) || undefined;
      let photos: ItemsView["photos"];
      if (photosFor) {
        const item = items.find((i) => i.id === photosFor);
        const query = str(req.query.pq).slice(0, 100).trim() || (item ? photoQuery(item.english) : "");
        try {
          photos = { id: photosFor, query, candidates: await pictures.search(query) };
        } catch (e) {
          if (!(e instanceof PhotoError)) console.error(e);
          photos = { id: photosFor, query, candidates: [], err: e instanceof PhotoError ? e.message : "Photo search failed." };
        }
      }
      const open = Number(req.query.open) || photosFor;
      return renderItems({
        token: req.params.token as string, q, filter, items, total, open, photos, photoSource: pictures.source,
        msg: str(req.query.msg), err: str(req.query.err),
      });
    }),
  );

  // Form posts redirect back to the search they came from (post/redirect/get).
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
        case "photo": {
          const c = parseCandidate(str(req.body.cand));
          await store.savePicture(id, c, await pictures.download(c), str(req.body.pq).slice(0, 100));
          return back(req, res, { msg: "Photo saved.", open: id });
        }
        case "nophoto":
          await store.deletePicture(id);
          return back(req, res, { msg: "Photo removed.", open: id });
        default:
          return back(req, res, { msg: `Saved “${await store.updateItem(id, fields(req.body))}”.`, open: id });
      }
    } catch (e) {
      const known = e instanceof TutorError || e instanceof PhotoError;
      if (!known) console.error(e);
      back(req, res, { err: known ? (e as Error).message : "Could not save.", open: id });
    }
  });
  return app;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}
