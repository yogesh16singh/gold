import { BRANDS_PATH, dbPath, storiesflyKey, tagLimit } from "./config.js";
import { collectBrands, loadBrands, selectSource } from "./collect.js";
import { connect } from "./db.js";
import { collectStories } from "./storiesfly.js";
import { tagPosts } from "./tag.js";

let running = false;

export async function runDaily() {
  if (running) {
    console.log("Daily job is already running.");
    return;
  }
  running = true;
  const started = new Date();
  console.log(`Daily job started ${started.toISOString()}`);
  const db = connect(dbPath());
  try {
    const brands = loadBrands(BRANDS_PATH);
    await collectBrands(selectSource(), brands, db, started);
    const storyKey = storiesflyKey();
    if (storyKey) {
      try {
        await collectStories(storyKey, brands, db, started);
      } catch (error) {
        console.log(`Stories pass failed (${error.message}). Posts already saved.`);
      }
    } else {
      console.log("STORIESFLY_KEY is not set. Skipping Stories.");
    }
    const key = (process.env.GEMINI_API_KEY || "").trim() || null;
    const model = (process.env.GEMINI_MODEL || "gemini-3.5-flash").trim() || "gemini-3.5-flash";
    await tagPosts(db, key, model, started, tagLimit());
    console.log("Daily job finished.");
  } finally {
    db.close();
    running = false;
  }
}

if (process.argv[1] && process.argv[1].endsWith("job.js")) {
  runDaily().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
