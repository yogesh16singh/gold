import { toIso } from "./posts.js";

export const WINDOW_DAYS = 7;

export function windowStart(now = new Date()) {
  return toIso(new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000));
}

export function isReel(mediaProductType) {
  return ["REELS", "CLIPS", "REEL"].includes(String(mediaProductType || "").toUpperCase());
}

export function scoreRow(row) {
  const followers = row.followers_count || 0;
  if (followers <= 0) return { rate: null, basis: "unscored" };
  const comments = row.comments_count || 0;
  const views = row.view_count;
  if (isReel(row.media_product_type)) {
    if (views == null) return { rate: null, basis: "reel_without_views" };
    return { rate: views / followers, basis: "views" };
  }
  const hidden = Boolean(row.likes_hidden) || row.like_count == null;
  if (hidden) return { rate: comments / followers, basis: "comments_only" };
  const likes = row.like_count || 0;
  return { rate: (likes + 5 * comments) / followers, basis: "likes_comments" };
}

export const BASIS_LABEL = {
  views: "reel views / followers",
  likes_comments: "(likes + 5×comments) / followers",
  comments_only: "comments / followers, likes hidden",
  reel_without_views: "reel, views missing",
  unscored: "followers missing",
};
