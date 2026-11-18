import { BrandSkip, RateLimitError, SetupError, TransientError } from "./errors.js";
import { parseTimestamp, validUsername } from "./posts.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ApifySource {
  constructor(token, actor = "apify~instagram-scraper") {
    this.token = token;
    this.actor = actor;
    this.name = "apify";
    this.followers = new Map();
  }

  async fetchRecent(username, limit = 50) {
    if (!validUsername(username)) throw new BrandSkip(`${username} is not a usable Instagram username`);
    let last = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const items = await this.#run({
          directUrls: [`https://www.instagram.com/${username}/`],
          resultsType: "posts",
          resultsLimit: limit,
        });
        const followers = await this.#followersFor(username, items);
        const posts = [];
        for (const item of items) {
          const post = postFromApify(item, username, followers);
          if (post) posts.push(post);
        }
        return posts.slice(0, limit);
      } catch (error) {
        if (!(error instanceof RateLimitError || error instanceof TransientError)) throw error;
        last = error;
        if (attempt < 2) await sleep(2 ** attempt * 1000);
      }
    }
    throw last;
  }

  async #followersFor(username, items) {
    for (const item of items) {
      const owner = item.owner && typeof item.owner === "object" ? item.owner.followersCount : null;
      const found = firstInt(item.followersCount, item.ownerFollowersCount, owner);
      if (found) {
        this.followers.set(username, found);
        return found;
      }
    }
    if (this.followers.has(username)) return this.followers.get(username);
    let details;
    try {
      details = await this.#run({
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: "details",
        resultsLimit: 1,
      });
    } catch (error) {
      if (
        error instanceof SetupError ||
        error instanceof RateLimitError ||
        error instanceof TransientError ||
        error instanceof BrandSkip
      ) {
        this.followers.set(username, null);
        return null;
      }
      throw error;
    }
    let followers = null;
    for (const item of details) {
      followers = firstInt(item.followersCount, item.followers);
      if (followers) break;
    }
    this.followers.set(username, followers);
    return followers;
  }

  async #run(payload) {
    const url = new URL(`https://api.apify.com/v2/acts/${this.actor}/run-sync-get-dataset-items`);
    url.searchParams.set("token", this.token);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000),
      });
    } catch {
      throw new TransientError("Network error calling Apify");
    }
    if (response.status === 401 || response.status === 403) throw new SetupError("Apify rejected the token");
    if (response.status === 429) throw new RateLimitError("Apify rate limit");
    if ([500, 502, 503, 504].includes(response.status)) {
      throw new TransientError(`Apify returned HTTP ${response.status}`);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new TransientError("Apify returned a non-JSON response");
    }
    if (body && !Array.isArray(body) && body.error) {
      const message = String(body.error.message || body.error);
      if (response.status === 401 || response.status === 403) throw new SetupError(message);
      throw new TransientError(message);
    }
    if (response.status >= 400) throw new TransientError(`Apify returned HTTP ${response.status}`);
    if (!Array.isArray(body)) throw new TransientError("Apify returned an unexpected payload");
    return body.filter((item) => item && typeof item === "object");
  }
}

export function postFromApify(item, username, followers) {
  const mediaId = String(item.id || item.shortCode || "");
  if (!mediaId) return null;
  const permalink = item.url || (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : null);
  const productRaw = String(item.productType || "").toLowerCase();
  let product = null;
  if (["clips", "reels", "reel"].includes(productRaw)) product = "REELS";
  else if (productRaw) product = "FEED";
  const typeRaw = String(item.type || "").toLowerCase();
  const mediaType = { image: "IMAGE", video: "VIDEO", sidecar: "CAROUSEL_ALBUM" }[typeRaw] || item.type || null;
  const likes = item.likesCount ?? item.likes;
  const hidden = likes == null || (typeof likes === "number" && likes < 0);
  let caption = item.caption;
  if (caption && typeof caption === "object") caption = caption.text;
  const views = item.videoViewCount ?? item.videoPlayCount;
  return {
    igMediaId: mediaId,
    brandUsername: username,
    permalink: typeof permalink === "string" ? permalink : null,
    caption: typeof caption === "string" ? caption : null,
    mediaType: mediaType ? String(mediaType) : null,
    mediaProductType: product,
    publishedAt: parseTimestamp(item.timestamp),
    likeCount: hidden ? null : firstInt(likes),
    likesHidden: Boolean(hidden),
    commentsCount: firstInt(item.commentsCount, item.comments),
    viewCount: firstInt(views),
    followersCount: followers,
    thumbnailUrl: firstStr(item.displayUrl, item.thumbnailUrl),
    mediaUrl: firstStr(item.videoUrl, item.displayUrl),
    thumbnailPath: null,
    fetchSource: "apify",
  };
}

function firstInt(...values) {
  for (const value of values) {
    if (typeof value === "boolean" || value == null) continue;
    if (typeof value === "number" && value >= 0) return Math.trunc(value);
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}

function firstStr(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.startsWith("http")) return value;
  }
  return null;
}
