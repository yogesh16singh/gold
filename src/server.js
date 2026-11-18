import fs from "node:fs";
import path from "node:path";

import express from "express";
import cron from "node-cron";

import { BRANDS_PATH, THUMB_DIR, cronSchedule, dbPath, port } from "./config.js";
import { connect } from "./db.js";
import { loadBrands } from "./collect.js";
import { runDaily } from "./job.js";
import { buildReport } from "./report.js";

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const app = express();

app.get("/", (_req, res) => {
  const db = connect(dbPath());
  try {
    const names = Object.fromEntries(loadBrands(BRANDS_PATH).map((brand) => [brand.username, brand.name]));
    res.type("html").send(buildReport(db, names));
  } finally {
    db.close();
  }
});

app.get("/thumbs/:name", (req, res) => {
  const name = req.params.name;
  if (!SAFE_NAME.test(name)) {
    res.status(404).end();
    return;
  }
  const file = path.join(THUMB_DIR, name);
  if (!file.startsWith(THUMB_DIR) || !fs.existsSync(file)) {
    res.status(404).end();
    return;
  }
  res.sendFile(file);
});

const schedule = cronSchedule();
if (!cron.validate(schedule)) {
  throw new Error(`CRON_SCHEDULE is not a valid cron expression: ${schedule}`);
}
cron.schedule(schedule, () => {
  runDaily().catch((error) => console.error(`Daily job failed: ${error.message}`));
}, { timezone: "Asia/Kolkata" });

const listener = app.listen(port(), () => {
  console.log(`Trend page at http://localhost:${port()}/`);
  console.log(`Daily fetch and tag scheduled at "${schedule}" Asia/Kolkata.`);
});

listener.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
