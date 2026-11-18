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
    "<header class=\"top\">",
    "<div>",
    '<p class="kicker">Jewellery brands on Instagram</p>',
    "<h1>What is moving this week</h1>",
    `<p class="range">${escapeHtml(range)}</p>`,
    "</div>",
    '<dl class="stats">',
    `<div><dt>Posts</dt><dd>${rows.length}</dd></div>`,
    `<div><dt>Brands</dt><dd>${brands}</dd></div>`,
    `<div><dt>Window</dt><dd>${WINDOW_DAYS} days</dd></div>`,
    "</dl>",
    "</header>",
    heatSection(categoryHeat(rows)),
    metalSection(metalCounts(rows)),
    postsSection(reels, names, "Reels", "Ranked by view_count / followers. This list is separate from feed posts."),
    postsSection(
      photos,
      names,
      "Feed posts",
      "Images, carousels, and videos that are not Reels. Ranked by (likes + 5×comments) / followers.",
    ),
    "<footer>",
    "<p>Reels and feed posts use different formulas, so they stay in separate lists. A missing like count is hidden. Raw likes are shown beside the rate, and the rate is the sort.</p>",
    "<p>Thumbnails are local copies for this internal view. The brand still owns the photo. Instagram links open the original post in a new tab.</p>",
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
  if (!heat.length) return '<section class="panel"><h2>Product types</h2><p class="empty">No posts in this window.</p></section>';
  const widest = Math.max(...heat.map((item) => item.brands)) || 1;
  const body = heat
    .map((item) => {
      const width = Math.round((item.brands / widest) * 100);
      const brandWord = item.brands === 1 ? "brand" : "brands";
      const postWord = item.posts === 1 ? "post" : "posts";
      return `<li><div class="heat-label"><span>${escapeHtml(item.category)}</span><span class="quiet">${item.brands} ${brandWord} · ${item.posts} ${postWord}</span></div><div class="bar" role="presentation"><span style="width:${width}%"></span></div></li>`;
    })
    .join("");
  return `<section class="panel"><h2>Product types</h2><p>How many of these brands posted the type this week.</p><ul class="heat">${body}</ul></section>`;
}

function metalSection(counts) {
  const cards = ["gold", "diamond", "polki", "mixed", "other", "unknown"]
    .map((name) => `<div class="metal ${escapeHtml(name)}"><strong>${counts[name]}</strong><span>${escapeHtml(name)}</span></div>`)
    .join("");
  return `<section class="panel"><h2>Gold and diamond</h2><div class="metals">${cards}</div></section>`;
}

function rateKey(a, b) {
  const left = a[1].rate == null ? -1 : a[1].rate;
  const right = b[1].rate == null ? -1 : b[1].rate;
  return right - left;
}

function postsSection(scored, names, title, note) {
  if (!scored.length) return `<section class="panel"><h2>${escapeHtml(title)}</h2><p class="empty">No posts in this window.</p></section>`;
  const body = scored.slice(0, 20).map(([row, result], index) => {
    const brand = names[row.brand_username] || row.brand_username;
    const category = row.category || "untagged";
    const metal = row.metal || "unknown";
    const full = String(row.caption || "").replace(/\s+/g, " ").trim();
    const caption = full.length > 160 ? `${full.slice(0, 157)}...` : full;
    const src = thumb(row.thumbnail_path);
    const alt = `${brand}, ${category}`;
    const image = src
      ? `<img class="thumb" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`
      : `<span class="thumb missing" role="img" aria-label="${escapeHtml(alt)}"></span>`;
    const likes = row.likes_hidden
      ? "<span><b>—</b> likes hidden</span>"
      : `<span><b>${inNum(row.like_count)}</b> likes</span>`;
    return `<li class="card">
${shot(row.permalink, `${image}<span class="rank">${index + 1}</span>`)}
<div class="card-body">
<div class="card-top">
<div><h3>${escapeHtml(brand)}</h3><p class="quiet">${inNum(row.followers_count)} followers</p></div>
<div class="rate"><strong>${pct(result.rate)}</strong><span>${escapeHtml(BASIS_LABEL[result.basis] || result.basis)}</span></div>
</div>
<p class="tags"><span>${escapeHtml(category)}</span><span class="metal-tag ${escapeHtml(metal)}">${escapeHtml(metal)}</span></p>
${caption ? `<p class="caption" title="${escapeHtml(full)}">${escapeHtml(caption)}</p>` : ""}
<p class="metrics">${likes}<span><b>${inNum(row.comments_count)}</b> comments</span>${row.view_count == null ? "" : `<span><b>${inNum(row.view_count)}</b> views</span>`}<span>${escapeHtml(published(row.published_at))}</span></p>
${link(row.permalink)}
</div>
</li>`;
  });
  return `<section class="panel"><div class="section-head"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(note)}</p></div><ol class="feed">${body.join("")}</ol></section>`;
}

function pct(rate) {
  if (rate == null) return "—";
  const percent = rate * 100;
  const digits = percent >= 10 ? 1 : percent >= 1 ? 2 : 4;
  return `${percent.toFixed(digits)}%`;
}

function thumb(file) {
  if (!file) return null;
  const name = file.split("/").pop();
  if (!SAFE_NAME.test(name)) return null;
  return `/thumbs/${name}`;
}

function isHttp(url) {
  return Boolean(url && (url.startsWith("https://") || url.startsWith("http://")));
}

function shot(url, inner) {
  if (!isHttp(url)) return `<div class="shot">${inner}</div>`;
  return `<a class="shot" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
}

function link(url) {
  if (!isHttp(url)) return "";
  return `<a class="ig" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">View on Instagram</a>`;
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
:root {
  --paper: #f4efe6;
  --ink: #1e1814;
  --muted: #6f6256;
  --line: #e4d7c6;
  --gold: #8d5a2b;
  --gold-deep: #6e4120;
  --card: #fffdf9;
  --shadow: 0 1px 2px rgba(62, 40, 18, 0.05), 0 8px 24px rgba(62, 40, 18, 0.04);
}
* { box-sizing: border-box; }
body { margin: 0; background: radial-gradient(1200px 420px at 10% -10%, #fff8ee 0%, var(--paper) 55%); color: var(--ink); font: 16px/1.45 "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 40px 20px 80px; }
h1, h2, h3 { font-family: Georgia, "Iowan Old Style", Palatino, serif; font-weight: 500; }
h1 { font-size: 42px; letter-spacing: -0.03em; margin: 6px 0 8px; line-height: 1.05; }
h2 { font-size: 28px; margin: 0 0 6px; }
h3 { font-size: 20px; margin: 0; }
p { margin: 0; }
a { color: inherit; }
a:focus-visible, .ig:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
.kicker { margin: 0; color: var(--gold); letter-spacing: 0.12em; text-transform: uppercase; font-size: 12px; font-weight: 650; }
.range, .quiet, footer p, .section-head p { color: var(--muted); }
.top { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
.stats { display: flex; gap: 10px; margin: 0; }
.stats div { background: var(--card); border: 1px solid var(--line); border-radius: 12px; min-width: 92px; padding: 10px 14px; box-shadow: var(--shadow); }
.stats dt { color: var(--muted); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
.stats dd { margin: 2px 0 0; font-family: Georgia, serif; font-size: 26px; }
.panel { margin-top: 28px; }
.section-head { margin-bottom: 14px; }
.heat { list-style: none; margin: 14px 0 0; padding: 8px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); }
.heat li { padding: 12px 0; border-bottom: 1px solid var(--line); }
.heat li:last-child { border-bottom: 0; }
.heat-label { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px; text-transform: capitalize; }
.bar { height: 8px; background: #efe4d4; border-radius: 99px; overflow: hidden; }
.bar > span { display: block; height: 100%; background: linear-gradient(90deg, #c4894f, var(--gold-deep)); border-radius: 99px; }
.metals { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-top: 14px; }
.metal { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 12px 12px; box-shadow: var(--shadow); border-top: 3px solid var(--line); }
.metal strong { display: block; font-family: Georgia, serif; font-size: 30px; font-weight: 500; line-height: 1; }
.metal span { color: var(--muted); text-transform: capitalize; font-size: 13px; }
.metal.gold { border-top-color: #c4922a; }
.metal.diamond { border-top-color: #7f93a8; }
.metal.polki { border-top-color: #d4a24a; }
.metal.mixed { border-top-color: #8d5a2b; }
.metal.other { border-top-color: #a89888; }
.metal.unknown { border-top-color: #d9cfc3; }
.feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.card { display: grid; grid-template-columns: 132px 1fr; gap: 16px; padding: 12px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); }
.shot { position: relative; display: block; border-radius: 12px; overflow: hidden; }
.thumb { width: 132px; height: 132px; object-fit: cover; background: #efe4d4; display: block; }
.thumb.missing { width: 132px; height: 132px; }
.rank { position: absolute; top: 8px; left: 8px; min-width: 26px; height: 26px; padding: 0 7px; border-radius: 99px; background: rgba(30, 24, 20, 0.78); color: #fffaf3; font-size: 13px; line-height: 26px; text-align: center; }
.card-body { min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 2px 4px 2px 0; }
.card-top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.rate { text-align: right; }
.rate strong { display: block; font-family: Georgia, serif; font-size: 22px; font-weight: 500; color: var(--gold-deep); }
.rate span, .metrics { color: var(--muted); font-size: 13px; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tags span { text-transform: capitalize; font-size: 12px; letter-spacing: 0.03em; background: #f6efe4; color: #5c4b3a; border-radius: 99px; padding: 3px 9px; }
.metal-tag.gold { background: #f8efd4; color: #7a5a12; }
.metal-tag.diamond { background: #eef2f6; color: #3e5164; }
.metal-tag.polki { background: #f8ecd4; color: #7a5410; }
.caption { color: #3c322a; }
.metrics { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.metrics b { color: var(--ink); font-weight: 650; }
.ig { align-self: flex-start; margin-top: 2px; color: var(--gold-deep); text-decoration: none; font-size: 14px; font-weight: 650; border: 1px solid #e2c8aa; background: #fff8f0; border-radius: 99px; padding: 7px 12px; }
.ig:hover { background: var(--gold-deep); color: #fffaf3; border-color: var(--gold-deep); }
.ig::after { content: " ↗"; }
.empty { margin-top: 8px; color: var(--muted); }
footer { margin-top: 36px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 14px; display: flex; flex-direction: column; gap: 6px; }
@media (max-width: 800px) {
  .top { flex-direction: column; align-items: stretch; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); }
  .metals { grid-template-columns: repeat(3, 1fr); }
  .card { grid-template-columns: 96px 1fr; }
  .thumb, .thumb.missing { width: 96px; height: 96px; }
  h1 { font-size: 32px; }
  .rate strong { font-size: 18px; }
}
@media (max-width: 560px) {
  .metals { grid-template-columns: repeat(2, 1fr); }
  .card { grid-template-columns: 1fr; }
  .thumb, .thumb.missing { width: 100%; height: 220px; }
  .card-top { flex-direction: column; }
  .rate { text-align: left; }
}
</style>
</head>`;
}
