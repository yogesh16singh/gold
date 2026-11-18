import fs from "node:fs";
import path from "node:path";

const MAX_BYTES = 8_000_000;

export async function saveThumbnail(post, destDir) {
  const safe = post.igMediaId.replace(/[^A-Za-z0-9_-]/g, "_");
  if (!safe) return null;
  fs.mkdirSync(destDir, { recursive: true });
  const existing = fs
    .readdirSync(destDir)
    .filter((name) => name.startsWith(`${safe}.`) && fs.statSync(path.join(destDir, name)).size > 32);
  if (existing.length) {
    post.thumbnailPath = relative(path.join(destDir, existing[0]), destDir);
    return post.thumbnailPath;
  }
  for (const url of [post.thumbnailUrl, post.mediaUrl]) {
    if (!url || !url.startsWith("http")) continue;
    if (/\.(mp4|mov|webm)$/i.test(url.split("?")[0])) continue;
    const saved = await download(url, destDir, safe);
    if (saved) {
      post.thumbnailPath = saved;
      return saved;
    }
  }
  return null;
}

async function download(url, destDir, safeId) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const type = response.headers.get("content-type") || "";
  if (type.includes("video")) return null;
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_BYTES) return null;
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_BYTES) return null;
  const ext = extension(data);
  if (!ext) return null;
  const dest = path.join(destDir, `${safeId}${ext}`);
  fs.writeFileSync(dest, data);
  return relative(dest, destDir);
}

function extension(data) {
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return ".jpg";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (data.subarray(0, 4).toString("ascii") === "GIF8") return ".gif";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return ".webp";
  }
  return null;
}

function relative(file, destDir) {
  const root = path.resolve(destDir, "..", "..");
  return path.relative(root, path.resolve(file)).split(path.sep).join("/");
}
