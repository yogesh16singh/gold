import { BrandSkip, RateLimitError, SetupError, TransientError } from "./errors.js";
import { parseTimestamp, validUsername } from "./posts.js";

const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_product_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
  "like_count",
  "comments_count",
  "view_count",
].join(",");

export const PAGE_SIZE = 50;
const MAX_PAGES = 6;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MetaSource {
  constructor(accessToken, igUserId, version = "v22.0") {
    this.accessToken = accessToken;
    this.igUserId = igUserId;
    this.version = version;
    this.name = "meta";
  }

  async fetchRecent(username, limit = PAGE_SIZE, since = null) {
    if (!validUsername(username)) {
      throw new BrandSkip(`${username} is not a usable Instagram username`);
    }
    const collected = [];
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const payload = await this.#request(username, limit, cursor);
      const { posts, next } = discoveryPage(payload, username);
      let oldest = null;
      for (const post of posts) {
        if (seen.has(post.igMediaId)) continue;
        seen.add(post.igMediaId);
        collected.push(post);
        if (post.publishedAt && (oldest == null || post.publishedAt < oldest)) {
          oldest = post.publishedAt;
        }
      }
      if (!posts.length || !next || next === cursor || !usableCursor(next)) break;
      if (since && oldest && oldest < since) break;
      cursor = next;
    }
    return collected;
  }

  async #request(username, limit, cursor) {
    let last = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.#once(username, limit, cursor);
      } catch (error) {
        if (!(error instanceof RateLimitError || error instanceof TransientError)) throw error;
        last = error;
        if (attempt < 2) await sleep(2 ** attempt * 1000);
      }
    }
    throw last;
  }

  async #once(username, limit, cursor) {
    let url = `https://graph.facebook.com/${this.version}/${this.igUserId}`;
    let target = url;
    if (cursor && cursor.startsWith("https://graph.facebook.com/")) {
      target = cursor;
    } else {
      const params = new URLSearchParams({
        fields: fields(username, limit, cursor),
        access_token: this.accessToken,
      });
      target = `${url}?${params.toString()}`;
    }
    let response;
    try {
      response = await fetch(target, { signal: AbortSignal.timeout(40_000) });
    } catch {
      throw new TransientError("Network error calling the Graph API");
    }
    if (response.status === 429) throw new RateLimitError(`Graph API returned HTTP ${response.status}`);
    if ([500, 502, 503, 504].includes(response.status)) {
      throw new TransientError(`Graph API returned HTTP ${response.status}`);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new TransientError("Graph API returned a non-JSON response");
    }
    if (payload.error) throw classifyGraphError(payload.error);
    if (response.status >= 400) throw new TransientError(`Graph API returned HTTP ${response.status}`);
    return payload;
  }
}

export function classifyGraphError(error) {
  const code = error.code;
  const message = String(error.message || "Graph API error");
  const lowered = message.toLowerCase();
  if ([4, 17, 32, 613].includes(code) || lowered.includes("rate limit")) return new RateLimitError(message);
  if (code === 110 || lowered.includes("invalid user id") || lowered.includes("cannot find user")) {
    return new BrandSkip(message);
  }
  if (code === 1 || code === 2) return new TransientError(message);
  if (
    [10, 102, 190, 200].includes(code) ||
    lowered.includes("access token") ||
    lowered.includes("permission") ||
    lowered.includes("nonexisting field (business_discovery)") ||
    error.type === "OAuthException"
  ) {
    return new SetupError(message);
  }
  return new TransientError(message);
}

function fields(username, limit, cursor) {
  let media = `media.limit(${Number(limit)})`;
  if (cursor && !cursor.startsWith("https://")) media = `${media}.after(${cursor})`;
  return `business_discovery.username(${username}){followers_count,username,${media}{${MEDIA_FIELDS}}}`;
}

function usableCursor(cursor) {
  if (cursor.startsWith("https://graph.facebook.com/")) return true;
  return CURSOR.test(cursor);
}

export function discoveryPage(payload, username) {
  const posts = postsFromDiscovery(payload, username);
  const media = payload.business_discovery?.media || {};
  const paging = media.paging || {};
  const cursor = paging.cursors?.after || paging.next;
  return { posts, next: typeof cursor === "string" && cursor ? cursor : null };
}

export function postsFromDiscovery(payload, username) {
  const discovery = payload.business_discovery || {};
  if (!Object.keys(discovery).length) throw new BrandSkip(`No business_discovery data for ${username}`);
  const followers = intOrNone(discovery.followers_count);
  const media = discovery.media?.data || [];
  const posts = [];
  for (const item of media) {
    const mediaId = String(item.id || "");
    if (!mediaId) continue;
    const likesHidden = !Object.hasOwn(item, "like_count") || item.like_count == null;
    posts.push({
      igMediaId: mediaId,
      brandUsername: username,
      permalink: item.permalink || null,
      caption: item.caption || null,
      mediaType: item.media_type || null,
      mediaProductType: item.media_product_type || null,
      publishedAt: parseTimestamp(item.timestamp),
      likeCount: likesHidden ? null : intOrNone(item.like_count),
      likesHidden,
      commentsCount: intOrNone(item.comments_count),
      viewCount: intOrNone(item.view_count),
      followersCount: followers,
      thumbnailUrl: item.thumbnail_url || null,
      mediaUrl: item.media_url || null,
      thumbnailPath: null,
      fetchSource: "meta",
    });
  }
  return posts;
}

function intOrNone(value) {
  if (value == null || value === false) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
