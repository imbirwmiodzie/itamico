import assert from "node:assert/strict";
import { test } from "node:test";
import { credit, isImageUrl, parseCandidate, PhotoError, photoQuery, Pictures } from "../src/pictures.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

/** A fetch that answers from a table of URL prefixes, recording what was asked. */
function fakeFetch(routes: [string, () => Response][]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const hit = routes.find(([prefix]) => url.startsWith(prefix));
    return hit ? hit[1]() : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

const pexelsBody = {
  photos: [
    { id: 1, url: "https://www.pexels.com/photo/bowl-1/", photographer: "Ana Rossi", alt: "A ceramic bowl", src: { medium: "https://images.pexels.com/photos/1/m.jpeg", large: "https://images.pexels.com/photos/1/l.jpeg" } },
    { id: 2, url: "https://www.pexels.com/photo/x/", photographer: "X", src: { medium: "https://evil.example/m.jpg", large: "https://evil.example/l.jpg" } },
  ],
};

const wikimediaBody = {
  query: {
    pages: [
      { title: "File:Second bowl.jpg", index: 2, imageinfo: [{ mime: "image/jpeg", thumburl: "https://upload.wikimedia.org/b/960px-2.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:2", extmetadata: { Artist: { value: '<a href="//x">Bea &amp; Co</a>' }, LicenseShortName: { value: "CC BY-SA 4.0" } } }] },
      { title: "File:Bowl.png", index: 1, imageinfo: [{ mime: "image/png", thumburl: "https://upload.wikimedia.org/a/960px-1.png", descriptionurl: "https://commons.wikimedia.org/wiki/File:1", extmetadata: { LicenseShortName: { value: "Public domain" } } }] },
      { title: "File:Drawing.svg", index: 3, imageinfo: [{ mime: "image/svg+xml", thumburl: "https://upload.wikimedia.org/c/960px-3.png" }] },
    ],
  },
};

test("photoQuery takes the first English meaning without an article", () => {
  assert.equal(photoQuery("the commute, journey"), "commute");
  assert.equal(photoQuery("to brake"), "brake");
  assert.equal(photoQuery("why; because"), "why");
  assert.equal(photoQuery("I like (plural things)"), "I like");
  assert.equal(photoQuery("the"), "the");
});

test("Pexels search with a key: candidates from the image host only", async () => {
  const { f, calls } = fakeFetch([["https://api.pexels.com/v1/search", () => Response.json(pexelsBody)]]);
  const pics = new Pictures({ pexelsKey: "k123", fetch: f });
  assert.equal(pics.source, "pexels");
  const found = await pics.search("bowl");
  assert.equal(calls[0].headers.authorization, "k123");
  assert.match(calls[0].url, /query=bowl/);
  assert.deepEqual(found, [{ source: "pexels", thumb: "https://images.pexels.com/photos/1/m.jpeg", full: "https://images.pexels.com/photos/1/l.jpeg", page: "https://www.pexels.com/photo/bowl-1/", author: "Ana Rossi", license: "Pexels License", alt: "A ceramic bowl" }]);
  assert.equal(credit(found[0]), "Ana Rossi / Pexels");
});

test("Wikimedia search without a key: ranked, bitmaps only, plain-text credits", async () => {
  const { f, calls } = fakeFetch([["https://commons.wikimedia.org/w/api.php", () => Response.json(wikimediaBody)]]);
  const pics = new Pictures({ fetch: f });
  assert.equal(pics.source, "wikimedia");
  const found = await pics.search("bowl");
  assert.match(calls[0].url, /gsrsearch=bowl\+filetype%3Abitmap/);
  assert.match(calls[0].headers["user-agent"], /itamico/);
  assert.deepEqual(found.map((c) => c.full), ["https://upload.wikimedia.org/a/960px-1.png", "https://upload.wikimedia.org/b/960px-2.jpg"]);
  assert.equal(found[0].alt, "Bowl");
  assert.equal(credit(found[1]), "Bea & Co / Wikimedia Commons, CC BY-SA 4.0");
});

test("search failures become PhotoErrors", async () => {
  const { f } = fakeFetch([["https://commons.wikimedia.org/", () => new Response("busy", { status: 503 })]]);
  await assert.rejects(new Pictures({ fetch: f }).search("bowl"), (e: Error) => e instanceof PhotoError && /HTTP 503/.test(e.message));
  assert.deepEqual(await new Pictures({ fetch: f }).search("   "), [], "empty query searches nothing");
});

test("download: allowed hosts only, images only, size-capped", async () => {
  const { f } = fakeFetch([
    ["https://images.pexels.com/ok", () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } })],
    ["https://images.pexels.com/html", () => new Response("<html>", { headers: { "content-type": "text/html" } })],
    ["https://images.pexels.com/big", () => new Response(Buffer.alloc(6_000_000), { headers: { "content-type": "image/jpeg" } })],
  ]);
  const pics = new Pictures({ fetch: f });
  const got = await pics.download({ full: "https://images.pexels.com/ok.jpg" });
  assert.equal(got.mime, "image/jpeg");
  assert.deepEqual(got.data, JPEG);
  await assert.rejects(pics.download({ full: "http://169.254.169.254/latest" }), PhotoError);
  await assert.rejects(pics.download({ full: "https://images.pexels.com.evil.example/x.jpg" }), PhotoError);
  await assert.rejects(pics.download({ full: "https://images.pexels.com/html" }), /not a photo/);
  await assert.rejects(pics.download({ full: "https://images.pexels.com/big" }), /too large/);
});

test("a chosen candidate posted back is validated", () => {
  assert.equal(isImageUrl("https://upload.wikimedia.org/a.jpg"), true);
  assert.equal(isImageUrl("http://upload.wikimedia.org/a.jpg"), false, "https only");
  const c = parseCandidate(JSON.stringify({ source: "wikimedia", full: "https://upload.wikimedia.org/a.jpg", author: "Bea", license: "CC0", page: "p" }));
  assert.equal(c.author, "Bea");
  assert.throws(() => parseCandidate("{"), PhotoError);
  assert.throws(() => parseCandidate(JSON.stringify({ source: "flickr", full: "https://upload.wikimedia.org/a.jpg" })), PhotoError);
  assert.throws(() => parseCandidate(JSON.stringify({ source: "pexels", full: "https://localhost/a.jpg" })), PhotoError);
});
