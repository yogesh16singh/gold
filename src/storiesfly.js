import { THUMB_DIR } from "./config.js";
import { upsertPost } from "./db.js";
import { BrandSkip, RateLimitError, SetupError, TransientError } from "./errors.js";
import { parseTimestamp, toIso, validUsername } from "./posts.js";
import { saveThumbnail } from "./thumbs.js";

const ENDPOINT = "https://storiesfly.com/api/v1/user/stories";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function collectStories(key, brands, db, now = new Date()) {
  const current = toIso(now);
  for (let index = 0; index < brands.length; index += 1) {
    const username = brands[index].username;
    let posts = [];
    try {
      posts = await fetchStories(username, key);
    } catch (error) {
      if (error instanceof SetupError) {
        console.log(`StoriesFly stopped (${error.message}). Posts already saved.`);
        return;
      }
      if (error instanceof BrandSkip) {
        console.log(`${username}: stories skipped (${error.message})`);
      } else {
        console.log(`${username}: stories failed (${error.message})`);
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
    console.log(`${username}: ${posts.length} stories, ${created} new, ${updated} updated`);
    if (index < brands.length - 1) await sleep(1000);
  }
}

export async function fetchStories(username, key) {
  if (!validUsername(username)) throw new BrandSkip(`${username} is not a usable Instagram username`);
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestStories(username, key);
    } catch (error) {
      if (!(error instanceof RateLimitError || error instanceof TransientError)) throw error;
      last = error;
      const wait = error instanceof RateLimitError ? retryWait(error.message) : 1000;
      if (attempt === 0) await sleep(wait);
    }
  }
  throw last;
}

async function requestStories(username, key) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("username", username);
  let response;
  try {
    response = await fetch(url, {
      headers: { "X-Api-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    throw new TransientError(error.message || "network error");
  }
  const body = await response.json().catch(() => null);
  const code = body && body.code ? String(body.code) : "";
  if (response.status === 401 || response.status === 402) {
    throw new SetupError(code || String(response.status));
  }
  if (response.status === 403 || response.status === 404) {
    throw new BrandSkip(code || String(response.status));
  }
  if (response.status === 429) {
    throw new RateLimitError(response.headers.get("retry-after") || code || "rate_limited");
  }
  if (!response.ok) throw new TransientError(code || String(response.status));
  const stories = Array.isArray(body?.stories) ? body.stories : [];
  return stories.map((story) => toPost(story, username)).filter((post) => post.igMediaId);
}

function toPost(story, username) {
  const video = String(story.media_type || "").toLowerCase() === "video";
  return {
    igMediaId: story.id == null ? "" : String(story.id),
    brandUsername: username,
    permalink: typeof story.url === "string" ? story.url : null,
    caption: null,
    mediaType: video ? "VIDEO" : "IMAGE",
    mediaProductType: "STORY",
    publishedAt: parseTimestamp(story.taken_at_iso || story.taken_at),
    likeCount: null,
    likesHidden: true,
    commentsCount: null,
    viewCount: null,
    followersCount: null,
    thumbnailUrl: story.thumbnail_url || (video ? null : story.media_url) || null,
    mediaUrl: story.media_url || null,
    thumbnailPath: null,
    fetchSource: "storiesfly",
  };
}

function retryWait(header) {
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 30) * 1000;
  return 1000;
}
