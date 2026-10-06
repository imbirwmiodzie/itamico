// Photos from the internet for the words. Searches Pexels when PEXELS_API_KEY
// is set (better everyday photos), otherwise Wikimedia Commons (no key). The
// chosen photo is downloaded and stored with the word, so posters print
// without depending on the other site.

export type PhotoSource = "pexels" | "wikimedia";

export interface Candidate {
  source: PhotoSource;
  /** Preview shown while choosing. */
  thumb: string;
  /** The size that is downloaded and stored. */
  full: string;
  /** The photo's own page, for the credit. */
  page: string;
  author: string | null;
  license: string | null;
  alt: string | null;
}

export interface Photo {
  mime: string;
  data: Buffer;
}

export class PhotoError extends Error {}

// Downloads only from the providers' image hosts: the URL to fetch comes back
// from the browser when a photo is chosen.
const IMAGE_HOSTS = ["images.pexels.com", "upload.wikimedia.org"];
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 15_000;
// Wikimedia asks API clients for a descriptive User-Agent.
const USER_AGENT = "itamico/1.0 (Italian vocabulary tutor; https://github.com/imbirwmiodzie/itamico)";

export const SOURCE_NAMES: Record<PhotoSource, string> = { pexels: "Pexels", wikimedia: "Wikimedia Commons" };

/** "the commute, journey" -> "commute": the first gloss, without an article or "to". */
export function photoQuery(english: string): string {
  const first = english.split(/[;,/(]/)[0].replace(/^\s*(the|a|an|to)\s+/i, "").trim();
  return first || english.trim();
}

/** Credit line for a stored or candidate photo. */
export function credit(p: { source: string; author: string | null; license: string | null }): string {
  const by = p.author ? `${p.author} / ` : "";
  const lic = p.source === "wikimedia" && p.license ? `, ${p.license}` : "";
  return `${by}${SOURCE_NAMES[p.source as PhotoSource] ?? p.source}${lic}`;
}

/** A candidate posted back by the browser when a photo is chosen. */
export function parseCandidate(json: string): Candidate {
  let v: any;
  try {
    v = JSON.parse(json);
  } catch {
    throw new PhotoError("bad photo choice");
  }
  const opt = (x: unknown) => (typeof x === "string" && x ? x.slice(0, 500) : null);
  if (!v || (v.source !== "pexels" && v.source !== "wikimedia") || typeof v.full !== "string" || !isImageUrl(v.full)) {
    throw new PhotoError("bad photo choice");
  }
  return { source: v.source, thumb: v.full, full: v.full, page: opt(v.page) ?? "", author: opt(v.author), license: opt(v.license), alt: opt(v.alt) };
}

export function isImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && IMAGE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

export class Pictures {
  constructor(private readonly opts: { pexelsKey?: string; fetch?: typeof fetch } = {}) {}

  get source(): PhotoSource {
    return this.opts.pexelsKey ? "pexels" : "wikimedia";
  }

  private request(url: string, headers: Record<string, string> = {}) {
    return (this.opts.fetch ?? fetch)(url, { headers: { "user-agent": USER_AGENT, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  async search(query: string, limit = 9): Promise<Candidate[]> {
    const q = query.replace(/\s+/g, " ").trim().slice(0, 100);
    if (!q) return [];
    let body: any;
    try {
      const res = this.opts.pexelsKey
        ? await this.request(`https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: String(limit) })}`, { authorization: this.opts.pexelsKey })
        : await this.request(`https://commons.wikimedia.org/w/api.php?${wikimediaParams(q, limit)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (e) {
      throw new PhotoError(`photo search on ${SOURCE_NAMES[this.source]} failed (${(e as Error).message})`);
    }
    const all = this.opts.pexelsKey ? fromPexels(body) : fromWikimedia(body);
    return all.filter((c) => isImageUrl(c.full) && isImageUrl(c.thumb)).slice(0, limit);
  }

  async download(c: Pick<Candidate, "full">): Promise<Photo> {
    if (!isImageUrl(c.full)) throw new PhotoError("photos can only come from Pexels or Wikimedia Commons");
    let res: Response;
    try {
      res = await this.request(c.full);
    } catch (e) {
      throw new PhotoError(`could not download the photo (${(e as Error).message})`);
    }
    if (res.url && !isImageUrl(res.url)) throw new PhotoError("the photo was redirected somewhere unexpected");
    if (!res.ok) throw new PhotoError(`could not download the photo (HTTP ${res.status})`);
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.includes(mime)) throw new PhotoError(`not a photo (${mime || "unknown type"})`);
    if (Number(res.headers.get("content-length")) > MAX_BYTES) throw new PhotoError("the photo is too large");
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_BYTES) throw new PhotoError("the photo is too large");
    return { mime, data };
  }
}

function wikimediaParams(q: string, limit: number): URLSearchParams {
  return new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: `${q} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(limit * 2), // some results are not usable photos
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "960",
    iiextmetadatafilter: "Artist|LicenseShortName|ObjectName",
  });
}

function fromPexels(body: any): Candidate[] {
  return (Array.isArray(body?.photos) ? body.photos : []).flatMap((p: any) =>
    typeof p?.src?.large === "string" && typeof p?.src?.medium === "string"
      ? [{ source: "pexels", thumb: p.src.medium, full: p.src.large, page: String(p.url ?? ""), author: text(p.photographer), license: "Pexels License", alt: text(p.alt) }]
      : [],
  );
}

function fromWikimedia(body: any): Candidate[] {
  const pages: any[] = Array.isArray(body?.query?.pages) ? [...body.query.pages] : [];
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages.flatMap((p) => {
    const ii = p?.imageinfo?.[0];
    if (typeof ii?.thumburl !== "string" || !IMAGE_TYPES.includes(ii.mime)) return [];
    const m = ii.extmetadata ?? {};
    const title = typeof p.title === "string" ? p.title.replace(/^File:/, "").replace(/\.\w+$/, "") : null;
    return [{
      source: "wikimedia" as const,
      thumb: ii.thumburl,
      full: ii.thumburl,
      page: String(ii.descriptionurl ?? ""),
      author: text(m.Artist?.value),
      license: text(m.LicenseShortName?.value),
      alt: text(m.ObjectName?.value) ?? title,
    }];
  });
}

/** Plain text from a string that may hold HTML (Wikimedia's Artist field does). */
function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return t || null;
}
