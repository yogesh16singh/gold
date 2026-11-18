import { postsSince } from "./db.js";
import { BASIS_LABEL, WINDOW_DAYS, isReel, scoreRow, windowStart } from "./score.js";

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function renderReport(rows, names, now = new Date()) {
  const reels = [];
  const photos = [];
  for (const row of rows) {
    const result = scoreRow(row);
    if (isReel(row.media_product_type)) reels.push([row, result]);
    else photos.push([row, result]);
  }
  reels.sort(rateKey);
  photos.sort(rateKey);
  const start = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const brands = new Set(rows.map((row) => row.brand_username)).size;
  const range = `${day(start)} – ${day(now)}`;
  return [
    head(),
    "<body><main>",
    "<header>",
    '<p class="kicker">Jewellery brands on Instagram</p>',
    "<h1>What is moving this week</h1>",
    `<p class="range">${escapeHtml(range)} · ${rows.length} posts · ${brands} brands</p>`,
    "</header>",
    heatSection(categoryHeat(rows)),
    metalSection(metalCounts(rows)),
    postsSection(reels, names, "Reels", "Ranked by view_count / followers. This list is not compared with feed posts."),
    postsSection(
      photos,
      names,
      "Feed posts",
      "Images, carousels, and videos that are not Reels. Ranked by (likes + 5×comments) / followers.",
    ),
    "<footer>",
    "<p>Reels and feed posts use different formulas, so they are separate lists. A missing like count is hidden, not zero. Raw likes are shown and are not the sort.</p>",
    "<p>Thumbnails are local copies for this internal view. The brand still owns the photo. The link opens the original post.</p>",
    `<p>Generated ${day(now)} ${clock(now)} IST. Stories are not included.</p>`,
    "</footer></main></body></html>",
  ].join("\n");
}

export function buildReport(db, names, now = new Date()) {
  return renderReport(postsSince(db, windowStart(now)), names, now);
}

function categoryHeat(rows) {
  const brands = new Map();
  const counts = new Map();
  for (const row of rows) {
    const category = row.category || "untagged";
    if (!brands.has(category)) brands.set(category, new Set());
    brands.get(category).add(row.brand_username);
    counts.set(category, (counts.get(category) || 0) + 1);
  }
  return [...brands.keys()]
    .map((category) => ({ category, brands: brands.get(category).size, posts: counts.get(category) }))
    .sort((a, b) => b.brands - a.brands || b.posts - a.posts);
}

function metalCounts(rows) {
  const counts = { gold: 0, diamond: 0, polki: 0, mixed: 0, other: 0, unknown: 0 };
  for (const row of rows) {
    const metal = counts[row.metal] == null ? "unknown" : row.metal || "unknown";
    counts[metal] += 1;
  }
  return counts;
}

function heatSection(heat) {
  if (!heat.length) return "<section><h2>Product types</h2><p>No posts in this window.</p></section>";
  const widest = Math.max(...heat.map((item) => item.brands)) || 1;
  const body = heat
    .map((item) => {
      const width = Math.round((item.brands / widest) * 100);
      return `<tr><td>${escapeHtml(item.category)}</td><td>${item.brands}</td><td>${item.posts}</td><td><div class="bar"><span style="width:${width}%"></span></div></td></tr>`;
    })
    .join("");
  return `<section><h2>Product types</h2><p>How many of these brands posted the type this week.</p><table class="heat"><thead><tr><th>Type</th><th>Brands</th><th>Posts</th><th></th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function metalSection(counts) {
  const cards = ["gold", "diamond", "polki", "mixed", "other", "unknown"]
    .map((name) => `<div class="metal"><strong>${counts[name]}</strong><span>${escapeHtml(name)}</span></div>`)
    .join("");
  return `<section><h2>Gold and diamond</h2><div class="metals">${cards}</div></section>`;
}

function rateKey(a, b) {
  const left = a[1].rate == null ? -1 : a[1].rate;
  const right = b[1].rate == null ? -1 : b[1].rate;
  return right - left;
}

function postsSection(scored, names, title, note) {
  if (!scored.length) return `<section><h2>${escapeHtml(title)}</h2><p>No posts in this window.</p></section>`;
  const body = scored.slice(0, 20).map(([row, result]) => {
    const brand = names[row.brand_username] || row.brand_username;
    const category = row.category || "untagged";
    const metal = row.metal || "unknown";
    let caption = String(row.caption || "").replace(/\s+/g, " ");
    if (caption.length > 110) caption = `${caption.slice(0, 107)}...`;
    const src = thumb(row.thumbnail_path);
    const image = src
      ? `<img class="thumb" src="${escapeHtml(src)}" alt="${escapeHtml(`${brand}, ${category}`)}">`
      : '<span class="thumb missing"></span>';
    return `<tr><td>${image}</td><td>${escapeHtml(brand)}<br><span class="quiet">${inNum(row.followers_count)} followers</span><br><span class="quiet">${escapeHtml(caption)}</span></td><td>${escapeHtml(category)}<br><span class="quiet">${escapeHtml(metal)}</span></td><td>${pct(result.rate)}<br><span class="quiet">${escapeHtml(BASIS_LABEL[result.basis] || result.basis)}</span></td><td>${inNum(row.likes_hidden ? null : row.like_count)}</td><td>${inNum(row.comments_count)}</td><td>${inNum(row.view_count)}</td><td>${escapeHtml(published(row.published_at))}</td><td>${link(row.permalink)}</td></tr>`;
  });
  return `<section><h2>${escapeHtml(title)}</h2><p>${escapeHtml(note)}</p><table class="posts"><thead><tr><th></th><th>Brand</th><th>Type</th><th>Rate</th><th>Likes</th><th>Comments</th><th>Views</th><th>When</th><th></th></tr></thead><tbody>${body.join("")}</tbody></table></section>`;
}

function pct(rate) {
  if (rate == null) return "—";
  return `${(rate * 100).toFixed(4)}%`;
}

function thumb(file) {
  if (!file) return null;
  const name = file.split("/").pop();
  if (!SAFE_NAME.test(name)) return null;
  return `/thumbs/${name}`;
}

function link(url) {
  if (url && (url.startsWith("https://") || url.startsWith("http://"))) {
    return `<a href="${escapeHtml(url)}">Open</a>`;
  }
  return "";
}

function published(value) {
  if (!value) return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return `${day(dt)} ${clock(dt)}`;
}

function parts(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
}

function day(date) {
  const list = parts(date);
  const dayPart = list.find((part) => part.type === "day")?.value || "";
  const month = list.find((part) => part.type === "month")?.value || "";
  return `${dayPart} ${month}`;
}

function clock(date) {
  const list = parts(date);
  const hour = list.find((part) => part.type === "hour")?.value || "";
  const minute = list.find((part) => part.type === "minute")?.value || "";
  return `${hour}:${minute}`;
}

function inNum(value) {
  if (value == null) return "—";
  const negative = Number(value) < 0;
  const text = String(Math.abs(Math.trunc(Number(value))));
  if (text.length <= 3) return (negative ? "-" : "") + text;
  let head = text.slice(0, -3);
  const tail = text.slice(-3);
  const groups = [];
  while (head) {
    groups.push(head.slice(-2));
    head = head.slice(0, -2);
  }
  return `${negative ? "-" : ""}${groups.reverse().join(",")},${tail}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function head() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This week in jewellery Instagram</title>
<style>
:root { --paper: #f3eee6; --ink: #221c16; --muted: #6e6256; --line: #e2d6c6; --gold: #8a5728; --card: #fffdf9; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.45 "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 1080px; margin: 0 auto; padding: 36px 20px 72px; }
h1, h2 { font-family: Georgia, "Iowan Old Style", Palatino, serif; font-weight: 500; margin: 0 0 8px; }
h1 { font-size: 40px; letter-spacing: -0.02em; }
h2 { font-size: 26px; margin-top: 36px; }
.kicker { margin: 0; color: var(--gold); letter-spacing: 0.08em; text-transform: uppercase; font-size: 12px; }
.range, .quiet, footer p { color: var(--muted); }
section p { margin-top: 0; }
table { width: 100%; border-collapse: collapse; background: var(--card); }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 4px; background: #efe4d4; display: inline-block; }
.thumb.missing { background: #efe4d4; }
.bar { height: 8px; width: 100%; background: #eadfce; border-radius: 99px; }
.bar > span { display: block; height: 8px; background: var(--gold); border-radius: 99px; }
.metals { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.metal { background: var(--card); border: 1px solid var(--line); padding: 14px 12px; }
.metal strong { display: block; font-family: Georgia, serif; font-size: 28px; font-weight: 500; }
.metal span { color: var(--muted); text-transform: capitalize; }
a { color: var(--gold); }
footer { margin-top: 28px; font-size: 14px; }
@media (max-width: 800px) {
  .metals { grid-template-columns: repeat(3, 1fr); }
  table.heat th:last-child, table.heat td:last-child { display: none; }
  table.posts { display: block; overflow-x: auto; }
  h1 { font-size: 32px; }
}
</style>
</head>`;
}
