// Downloads item icons from the League of Legends Wiki
// (Category:High_definition_item_icons) into assets/items/<slug>.png.
// Usage: node scripts/fetch-wiki-icons.mjs [--size 128] [--force]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const API = "https://wiki.leagueoflegends.com/en-us/api.php";
const UA = { "User-Agent": "RecipeRiftIconFetcher/1.0 (fan game icon downloader)" };
const args = process.argv.slice(2);
const size = Number(args[args.indexOf("--size") + 1]) || 128;
const force = args.includes("--force");

const root = new URL("../", import.meta.url);
const outDir = new URL("assets/items/", root);
mkdirSync(outDir, { recursive: true });

// Load the game's item list from data.js.
const ctx = { window: {} };
vm.runInNewContext(readFileSync(new URL("data.js", root), "utf8"), ctx);
const { components, parts = [], items } = ctx.window.GAME_DATA;
const wanted = [...components, ...parts, ...items];

const norm = (s) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const api = async (params) => {
  const res = await fetch(`${API}?${new URLSearchParams({ format: "json", ...params })}`, { headers: UA });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
};

// 1. List every HD icon file in the category.
const files = new Map(); // normalized item name -> file title
let cont = {};
do {
  const r = await api({ action: "query", list: "categorymembers", cmtitle: "Category:High_definition_item_icons", cmtype: "file", cmlimit: "500", ...cont });
  for (const m of r.query.categorymembers) {
    const name = m.title.replace(/^File:/, "").replace(/ item HD\.png$/i, "");
    files.set(norm(name), m.title);
  }
  cont = r.continue || null;
} while (cont);
console.log(`wiki category: ${files.size} files`);

// Wiki names that differ from Riot's data.
const ALIAS = { "Luden's Echo": "Luden's Companion" };

// 2. Match game items to files. Fall back to the alias, then to the standard-size icon.
const matched = [], missing = [];
for (const x of wanted) {
  const title = files.get(norm(x.name)) || (ALIAS[x.name] && files.get(norm(ALIAS[x.name])));
  matched.push({ x, title: title || `File:${x.name} item.png` });
}

// 3. Resolve thumbnail URLs (50 titles per request) and download.
let saved = 0, skipped = 0;
for (let i = 0; i < matched.length; i += 50) {
  const batch = matched.slice(i, i + 50);
  const r = await api({ action: "query", prop: "imageinfo", iiprop: "url", iiurlwidth: String(size), titles: batch.map((b) => b.title).join("|") });
  const urls = new Map();
  const norms = new Map((r.query.normalized || []).map((n) => [n.to, n.from]));
  for (const p of Object.values(r.query.pages)) {
    const info = p.imageinfo?.[0];
    if (info) urls.set(norms.get(p.title) || p.title, info.thumburl || info.url);
  }
  for (const { x, title } of batch) {
    const dest = new URL(`${x.slug}.png`, outDir);
    if (!force && existsSync(dest)) { skipped++; continue; }
    const url = urls.get(title);
    if (!url) { missing.push(x.name); continue; }
    const res = await fetch(url, { headers: UA });
    if (!res.ok) { missing.push(`${x.name} (HTTP ${res.status})`); continue; }
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    saved++;
  }
}

console.log(`saved ${saved}, already present ${skipped}, not found ${missing.length}`);
if (missing.length) console.log("missing:\n  " + missing.join("\n  "));
