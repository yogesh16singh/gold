import fs from "node:fs";

import { ApifySource } from "./apify.js";
import { THUMB_DIR } from "./config.js";
import { upsertPost } from "./db.js";
import { BrandSkip, RateLimitError, SetupError, TransientError } from "./errors.js";
import { PAGE_SIZE, MetaSource } from "./meta.js";
import { toIso } from "./posts.js";
import { windowStart } from "./score.js";
import { saveThumbnail } from "./thumbs.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SwitchingCollector {
  constructor(primary, fallback = null) {
    this.source = primary;
    this.fallback = fallback;
    this.switched = false;
  }

  async fetch(username, limit = PAGE_SIZE, since = null) {
    try {
      return await this.source.fetchRecent(username, limit, since);
    } catch (error) {
      if (!(error instanceof SetupError) || !this.fallback || this.source === this.fallback) throw error;
      if (!this.switched) {
        this.switched = true;
        console.log(`Meta setup failed (${error.message}). Switching this run to Apify.`);
      }
      this.source = this.fallback;
      return this.source.fetchRecent(username, limit, since);
    }
  }
}

export function selectSource() {
  const token = (process.env.META_ACCESS_TOKEN || "").trim();
  const igUser = (process.env.IG_USER_ID || "").trim();
  const apify = (process.env.APIFY_TOKEN || "").trim();
  const version = (process.env.GRAPH_API_VERSION || "v22.0").trim() || "v22.0";
  const actor = (process.env.APIFY_ACTOR || "apify~instagram-scraper").trim();
  if (token && igUser) {
    const fallback = apify ? new ApifySource(apify, actor) : null;
    return new SwitchingCollector(new MetaSource(token, igUser, version), fallback);
  }
  if (!token && !igUser && apify) {
    console.log("META_ACCESS_TOKEN and IG_USER_ID are not set. Using Apify for this run.");
    return new SwitchingCollector(new ApifySource(apify, actor));
  }
  const missing = [
    ["META_ACCESS_TOKEN", token],
    ["IG_USER_ID", igUser],
  ]
    .filter(([, present]) => !present)
    .map(([name]) => name);
  const hint = apify ? "" : " Or set APIFY_TOKEN to use the scraper fallback.";
  throw new Error(`Missing ${missing.join(" and ")}. The collector uses Meta business_discovery.${hint}`);
}

export function loadBrands(file) {
  const text = fs.readFileSync(file, "utf8");
  const brands = [];
  let username = null;
  for (const line of text.split("\n")) {
    const user = line.match(/^\s*-\s*username:\s*(\S+)\s*$/);
    const name = line.match(/^\s*name:\s*(.+?)\s*$/);
    if (user) username = user[1];
    else if (name && username) {
      brands.push({ username, name: name[1] });
      username = null;
    }
  }
  if (!brands.length) throw new Error(`No brands listed in ${file}`);
  return brands;
}

export async function collectBrands(collector, brands, db, now = new Date()) {
  const current = toIso(now);
  const since = windowStart(now);
  for (let index = 0; index < brands.length; index += 1) {
    const username = brands[index].username;
    let posts;
    try {
      posts = await collector.fetch(username, PAGE_SIZE, since);
    } catch (error) {
      if (error instanceof BrandSkip) {
        console.log(`${username}: skipped (${error.message})`);
        posts = [];
      } else if (
        error instanceof SetupError ||
        error instanceof RateLimitError ||
        error instanceof TransientError
      ) {
        throw new Error(`${username}: ${error.name}: ${error.message}`);
      } else {
        throw error;
      }
    }
    let created = 0;
    let updated = 0;
    for (const post of posts) {
      await saveThumbnail(post, THUMB_DIR);
      const kind = upsertPost(db, post, current);
      if (kind === "new") created += 1;
      else updated += 1;
    }
    console.log(`${username}: ${posts.length} posts, ${created} new, ${updated} updated`);
    if (index < brands.length - 1) await sleep(1000);
  }
}
