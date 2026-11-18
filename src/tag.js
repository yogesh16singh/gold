import fs from "node:fs";
import path from "node:path";

import { CATEGORIES, METALS, ROOT } from "./config.js";
import { postsToTag, saveTag } from "./db.js";
import { guess } from "./keywords.js";
import { windowStart } from "./score.js";

const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function tagPosts(db, geminiKey, model, now = new Date(), limit = 100) {
  const rows = postsToTag(db, windowStart(now), limit);
  if (!rows.length) {
    console.log("No untagged posts in the last 7 days.");
    return 0;
  }
  if (!geminiKey) console.log("GEMINI_API_KEY is not set. Tagging from captions only.");
  let tagged = 0;
  for (const row of rows) {
    const hint = guess(row.caption);
    let result = null;
    if (geminiKey && row.thumbnail_path) {
      try {
        result = await visionTag(geminiKey, model, path.join(ROOT, row.thumbnail_path), row.caption, hint);
      } catch (error) {
        if (transient(error)) {
          console.log(`${row.ig_media_id}: vision unavailable (${error.message}). Left untagged for the next run.`);
          continue;
        }
        console.log(`${row.ig_media_id}: vision failed (${error.message}). Using the caption.`);
      }
    }
    const chosen = result || hint;
    saveTag(
      db,
      row.ig_media_id,
      String(chosen.category),
      String(chosen.metal),
      result ? "vision" : "keyword",
      Number(chosen.confidence),
    );
    tagged += 1;
    if (result) await sleep(1000);
  }
  console.log(`Tagged ${tagged} posts.`);
  return tagged;
}

export async function visionTag(apiKey, model, imagePath, caption, hint) {
  if (!fs.existsSync(imagePath)) throw new Error(`missing image ${imagePath}`);
  const stat = fs.statSync(imagePath);
  if (stat.size > 4_000_000) throw new Error("image is over 4MB");
  const mime = MIME[path.extname(imagePath).toLowerCase()];
  if (!mime) throw new Error(`unsupported image type ${path.extname(imagePath)}`);
  const prompt = [
    "You tag jewellery Instagram posts for Indian gold and diamond traders.",
    "Look at the jewellery, not the clothing or the festival greeting.",
    "Return JSON only, with keys category, metal, confidence.",
    `category must be one of: ${CATEGORIES.join(", ")}.`,
    `metal must be one of: ${METALS.join(", ")}.`,
    "confidence is a number from 0 to 1.",
    "Use mixed when gold and diamonds are both the point of the post.",
    "Use polki for polki or kundan. Use other when there is no jewellery.",
    `Caption keyword hint: category=${hint.category}, metal=${hint.metal}.`,
    `Caption: ${caption || "(none)"}`,
  ].join("\n");
  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mime, data: fs.readFileSync(imagePath).toString("base64") } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await postWithRetry(url, apiKey, body);
  if (response.status === 404) {
    throw new Error(`model ${model} was not found. Set GEMINI_MODEL to a flash model that accepts images.`);
  }
  if (response.status >= 400) throw new Error(`Gemini HTTP ${response.status}`);
  return parseTag(responseText(await response.json()));
}

async function postWithRetry(url, apiKey, body) {
  let last = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        last = new Error(`Gemini HTTP ${response.status}`);
        await sleep(2 ** attempt * 1000);
        continue;
      }
      return response;
    } catch (error) {
      if (error.message?.startsWith("Gemini HTTP")) throw error;
      last = new Error("network error calling Gemini");
      await sleep(2 ** attempt * 1000);
    }
  }
  throw last;
}

function transient(error) {
  const text = String(error.message || error).toLowerCase();
  return ["503", "429", "network error", "502", "504"].some((part) => text.includes(part));
}

function responseText(payload) {
  const candidates = payload.candidates || [];
  if (!candidates.length) throw new Error(`no candidates (${JSON.stringify(payload.promptFeedback || {})})`);
  const parts = candidates[0].content?.parts || [];
  const texts = parts.map((part) => part.text).filter(Boolean);
  if (!texts.length) throw new Error("empty model response");
  return texts.join("\n");
}

function parseTag(text) {
  let raw = text.trim();
  if (raw.startsWith("```")) {
    raw = raw.split("\n").slice(1).join("\n");
    raw = raw.replace(/```$/, "");
  }
  const data = JSON.parse(raw);
  const category = String(data.category || "").toLowerCase().trim();
  const metal = String(data.metal || "").toLowerCase().trim();
  if (!CATEGORIES.includes(category) || !METALS.includes(metal)) {
    throw new Error(`unexpected tag ${category}/${metal}`);
  }
  let confidence = Number(data.confidence);
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));
  return { category, metal, confidence };
}
