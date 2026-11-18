import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });

export const ROOT = root;
export const DEFAULT_DB = path.join(root, "data", "feed.db");
export const THUMB_DIR = path.join(root, "data", "thumbs");
export const BRANDS_PATH = path.join(root, "brands.yml");

export const CATEGORIES = [
  "ring",
  "necklace",
  "earring",
  "bangle",
  "bracelet",
  "pendant",
  "chain",
  "mangalsutra",
  "nosepin",
  "set",
  "other",
];

export const METALS = ["gold", "diamond", "polki", "mixed", "other", "unknown"];

export function dbPath() {
  return process.env.DB_PATH || DEFAULT_DB;
}

export function tagLimit() {
  const parsed = Number.parseInt(process.env.TAG_LIMIT || "100", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

export function port() {
  const parsed = Number.parseInt(process.env.PORT || "3000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

export function cronSchedule() {
  return process.env.CRON_SCHEDULE || "0 8 * * *";
}
