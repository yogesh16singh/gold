# Jewellery Instagram trend feed

An Express server for ten Indian gold and diamond brands. Once a day it fetches posts, tags them, and serves the last seven days at `/`.

Node.js 20 or newer. The database is a single SQLite file. Recommendations for the assignment are in `NOTE.md`.

## How to run it

```bash
cd /home/yogesh-singh/assignment/gold_express
npm install
npm start
```

Open `http://localhost:3000/`. The page is rendered from `data/feed.db`. Thumbnails are served from `/thumbs/`.

`npm start` also schedules one daily job at 08:00 Asia/Kolkata. That job fetches 50 posts per brand, downloads a thumbnail, and tags the last 7 days. A second page is requested only when the first 50 are all still inside the week. For these ten brands one page already reaches past seven days, so a daily run is one call per brand.

Run the same job immediately:

```bash
npm run job
```

`PORT` changes the listen port (default 3000). `CRON_SCHEDULE` changes the daily time (default `0 8 * * *`, Asia/Kolkata).

The copied `.env` already has `META_ACCESS_TOKEN`, `IG_USER_ID`, and `GEMINI_API_KEY`. A Graph API Explorer token lasts about an hour. Exchange it for the 60-day token before relying on the daily job.

## Meta setup (the collector to use)

The call is `business_discovery` on your own Instagram professional account. It reads the public posts and reels of other professional accounts. Development mode is enough while only you use the token. App Review is the later step, when someone else logs in.

1. Create a Facebook Page.
2. Convert an Instagram account to Professional and link it to that Page. A new account is fine. It does not need followers.
3. At [developers.facebook.com](https://developers.facebook.com) create an app, add Instagram, and choose Instagram API with Facebook Login. Add yourself as an admin.
4. In the Graph API Explorer, create a User token with `instagram_basic`, `pages_show_list`, `pages_read_engagement`, and `instagram_manage_insights`.
5. Exchange it for a long-lived token (about 60 days):

```bash
curl "https://graph.facebook.com/v22.0/oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=SHORT_TOKEN"
```

6. `GET /me/accounts` to find the Page, then `GET /{page-id}?fields=instagram_business_account` to find the Instagram id.
7. Put the long-lived token in `META_ACCESS_TOKEN` and that id in `IG_USER_ID`.

`GRAPH_API_VERSION` defaults to `v22.0` (usable through May 2027). v21.0 expires on 21 January 2027.

The ten accounts are Tanishq, CaratLane, BlueStone, Kalyan Jewellers, Malabar, Joyalukkas, Senco, PC Jeweller, ORRA, and Candere. All ten are public professional accounts. A personal account returns nothing and is skipped.

## If Meta setup is blocked

Set `APIFY_TOKEN`. If both Meta variables are empty, the run uses Apify. If Meta is configured and Graph returns a permission or token error, the rest of that run switches to Apify. A rate limit or a network error is retried and does not switch.

Meta is the collector to use because that call is free. Apify is the backup. On 17 November 2026 one Candere fetch of 50 posts cost $0.115 ($0.113 on the account), about $2.30 per 1,000 posts. A daily page of 50 is about $34 a month for 10 brands and about $173 for 50. The Starter plan checked that day caps a month at $19, so a daily scrape of these ten brands already passes it. The actor also bills posts it returns again on the next run.

Image tags use `GEMINI_API_KEY` and `GEMINI_MODEL` (default `gemini-3.5-flash`). A free key comes from [Google AI Studio](https://aistudio.google.com). If that model name returns 404, set `GEMINI_MODEL` to a flash model that accepts images. Without a key, tags come from the caption only. `TAG_LIMIT` (default 100) caps vision calls per run. A caption tag is sent again on the next run when a thumbnail exists. A vision tag is kept. A 429 or a 503 leaves the row unchanged.

## What works

Checked against the live token on 18 November 2026.

- All ten brands come back from Meta: 50 posts each. A later fetch updates counts in place and inserts only the new media ids. That refresh added 9 posts and updated the other 491.
- One call per brand is enough. The oldest post on the first page is already outside the 7-day window, so paging stops.
- A local thumbnail, plus the permalink to the original.
- The page at `/` keeps two rankings. Reels use views / followers. Feed posts use (likes + 5×comments) / followers. The two rates are separate. Store openings, greetings, and hacks are listed under "Not in the product rank". A greeting that names the products stays in the rank.
- Gemini vision tags the photo when the free tier still has quota. On 18 November it tagged 12 photos before the daily limit, so 14 posts in that week have a vision tag. The caption keyword tag covers the rest, and it covers a missing key.
- Hidden likes stay missing. Those photos are scored from comments only.
- An Apify path is wired for the day Meta rejects the token. It is not the daily collector.
- The server serves that page, and the daily cron runs the fetch and the tag.

## What does not work yet

- A full vision pass of the week on the free Gemini tier. The account is limited to about 20 image calls a day. The 18 November run left 27 posts on their caption tag. The next day's job continues with those.
- An empty week for a quiet brand. On 18 November Tanishq and Senco returned 50 posts each, and none of them fell inside the last 7 days. The page names them under "Empty this week" and shows the date of their last stored post. That is an empty week, not a missed page.
- Stories. The official API cannot read another brand's Stories. They are left out on purpose.
- The reel file itself, when Meta omits `media_url` (licensed audio, or downloads turned off). The permalink and, when present, the thumbnail still work.
- Personal accounts, and accounts that are not professional. The call skips them.
- Refreshing the token before day 60. The long-lived token in use expires about 17 January 2027. Exchange it again by hand before that.
- App Review, so other people cannot log in yet.
- A public gallery. The thumbnails are for this internal page.

Secrets stay in `.env`. `data/` and `node_modules/` are gitignored.
