// Shared pieces of the browser pages (drill, game, palazzo, case, stats, words and poster): theme tokens,
// base styles, escaping and the navigation between them.

export const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Headers for pages whose URL carries the secret token. */
export const PRIVATE_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

export const PAGE_CSS = `:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--base:#c3c2b7;--ring:rgba(11,11,11,.10);
--s1:#2a78d6;--s2:#eb6834;--st0:#86b6ef;--st1:#3987e5;--st2:#1c5cab;--st3:#0d366b;--good:#006300;--bad:#d03b3b;
--h0:var(--grid);--h1:#86b6ef;--h2:#5598e7;--h3:#256abf;--h4:#104281}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--grid:#2c2c2a;--base:#383835;--ring:rgba(255,255,255,.10);
--s1:#3987e5;--s2:#d95926;--st0:#184f95;--st1:#256abf;--st2:#5598e7;--st3:#9ec5f4;--good:#0ca30c;--bad:#e66767;
--h1:#184f95;--h2:#256abf;--h3:#5598e7;--h4:#9ec5f4}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--grid:#2c2c2a;--base:#383835;--ring:rgba(255,255,255,.10);
--s1:#3987e5;--s2:#d95926;--st0:#184f95;--st1:#256abf;--st2:#5598e7;--st3:#9ec5f4;--good:#0ca30c;--bad:#e66767;
--h1:#184f95;--h2:#256abf;--h3:#5598e7;--h4:#9ec5f4}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:880px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:22px;margin:0 0 2px}h2{font-size:16px;margin:0 0 2px}
.muted,.sub{color:var(--ink2)}.sub{font-size:13px;margin:0 0 12px}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:6px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid);vertical-align:top}
th{color:var(--ink2);font-weight:500}td{font-variant-numeric:tabular-nums}
.words td:first-child{font-weight:600}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:12px;padding:14px;margin-top:12px}
nav{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:14px;margin:0 0 14px}
nav a{color:var(--ink2);text-decoration:none;padding-bottom:2px}
nav a[aria-current]{color:var(--ink);font-weight:600;border-bottom:2px solid var(--s1)}
`;

export function nav(token: string, active: "drill" | "game" | "palazzo" | "case" | "stats" | "items" | "poster"): string {
  const t = encodeURIComponent(token);
  const link = (key: string, href: string, label: string) =>
    `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav>${link("drill", `/drill/${t}`, "Drill")}${link("game", `/game/${t}`, "Game")}${link("palazzo", `/palazzo/${t}`, "Palazzo")}${link("case", `/case/${t}`, "Il Caso")}${link("stats", `/stats/${t}`, "Progress")}${link("items", `/items/${t}`, "Words")}${link("poster", `/poster/${t}`, "Poster")}</nav>`;
}
