import fs from "node:fs";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
    ig_media_id TEXT PRIMARY KEY,
    brand_username TEXT NOT NULL,
    permalink TEXT,
    caption TEXT,
    media_type TEXT,
    media_product_type TEXT,
    published_at TEXT,
    like_count INTEGER,
    likes_hidden INTEGER NOT NULL DEFAULT 0,
    comments_count INTEGER,
    view_count INTEGER,
    followers_count INTEGER,
    thumbnail_path TEXT,
    category TEXT,
    metal TEXT,
    tag_source TEXT,
    tag_confidence REAL,
    fetch_source TEXT,
    first_seen_at TEXT NOT NULL,
    last_fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_posts_brand ON posts(brand_username);
`;

export function connect(dbFile) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(SCHEMA);
  return db;
}

export function upsertPost(db, post, now) {
  const existing = db
    .prepare("SELECT thumbnail_path FROM posts WHERE ig_media_id = ?")
    .get(post.igMediaId);
  const likesHidden = post.likesHidden || post.likeCount == null ? 1 : 0;
  const likeCount = likesHidden ? null : post.likeCount;
  if (!existing) {
    db.prepare(
      `INSERT INTO posts (
        ig_media_id, brand_username, permalink, caption, media_type,
        media_product_type, published_at, like_count, likes_hidden,
        comments_count, view_count, followers_count, thumbnail_path,
        fetch_source, first_seen_at, last_fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      post.igMediaId,
      post.brandUsername,
      post.permalink,
      post.caption,
      post.mediaType,
      post.mediaProductType,
      post.publishedAt,
      likeCount,
      likesHidden,
      post.commentsCount,
      post.viewCount,
      post.followersCount,
      post.thumbnailPath,
      post.fetchSource,
      now,
      now,
    );
    return "new";
  }
  const thumb = existing.thumbnail_path || post.thumbnailPath;
  db.prepare(
    `UPDATE posts SET
      permalink = COALESCE(?, permalink),
      caption = COALESCE(?, caption),
      media_type = COALESCE(?, media_type),
      media_product_type = COALESCE(?, media_product_type),
      published_at = COALESCE(?, published_at),
      like_count = ?,
      likes_hidden = ?,
      comments_count = COALESCE(?, comments_count),
      view_count = COALESCE(?, view_count),
      followers_count = COALESCE(?, followers_count),
      thumbnail_path = ?,
      fetch_source = COALESCE(?, fetch_source),
      last_fetched_at = ?
    WHERE ig_media_id = ?`,
  ).run(
    post.permalink,
    post.caption,
    post.mediaType,
    post.mediaProductType,
    post.publishedAt,
    likeCount,
    likesHidden,
    post.commentsCount,
    post.viewCount,
    post.followersCount,
    thumb,
    post.fetchSource,
    now,
    post.igMediaId,
  );
  return "updated";
}

export function saveTag(db, mediaId, category, metal, source, confidence) {
  db.prepare(
    `UPDATE posts
     SET category = ?, metal = ?, tag_source = ?, tag_confidence = ?
     WHERE ig_media_id = ?
       AND (category IS NULL OR tag_source = 'keyword')`,
  ).run(category, metal, source, confidence, mediaId);
}

export function postsToTag(db, since, limit) {
  return db
    .prepare(
      `SELECT * FROM posts
       WHERE published_at >= ?
         AND (
           category IS NULL
           OR (tag_source = 'keyword' AND thumbnail_path IS NOT NULL)
         )
       ORDER BY published_at DESC
       LIMIT ?`,
    )
    .all(since, limit);
}

export function postsSince(db, since) {
  return db
    .prepare("SELECT * FROM posts WHERE published_at >= ? ORDER BY published_at DESC")
    .all(since);
}

export function latestByBrand(db) {
  return db
    .prepare(
      `SELECT brand_username, MAX(published_at) AS published_at
       FROM posts
       WHERE published_at IS NOT NULL
       GROUP BY brand_username`,
    )
    .all();
}
