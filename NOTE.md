# Recommendations

For QuickLens. 18 November 2026. The collector has now run on a live token.

## How to get the posts

Use Meta's `business_discovery`. On 18 November it returned 50 posts for each of the ten brands, with likes, comments, reel views, and followers. Those counts are what the ranking needs. The call is free. One page of 50 already reaches past seven days, so the daily job is about 10 calls now and about 50 later. Development mode is enough while one admin holds the token. App Review waits until someone else logs in.

The first token died the next morning. It was a Graph API Explorer token, good for about an hour to a day. Exchange it once for a long-lived user token, about 60 days. The one in use expires about 17 January 2027. Switch to a paid scraper when Graph rejects the app: missing permission, no Facebook Page, or a token that cannot be renewed. An expired Explorer token is a new Meta token, not a reason to leave the official API.

Apify is wired as that backup. On 17 November one Candere fetch of 50 posts was listed at $0.115, and the account's usage rose by $0.113. That is $2.30 per 1,000 posts. A daily page of 50 is about $34 a month at 10 brands and about $173 at 50. The Starter plan checked that day caps a month at $19, so ten brands every day already passes it. Apify also bills posts it returns again, including ones already stored. Bright Data's list rate is about $1.50 per 1,000: about $23 and $113 for the same pull. The database does not care which fetcher wrote the row.

A logged-in script is the one to refuse. It breaks Instagram's terms. A checkpoint or a ban ends the feed without warning.

## Stories

Skip them. The official API cannot read another brand's Stories. A Story lasts 24 hours, so automation means polling every few hours, which is where bans and scraper bills show up. If a launch exists only as a Story, save it by hand.

## Images

Keep the permalink and store a small thumbnail. The live page does this. Meta's photo URL expires in hours or days, so a page of links goes blank. A thumbnail is about 100 KB: tens of megabytes a month at 10 brands, still a folder at 50. The brands own the photos. The copy is for this internal page, not a catalogue to republish. The reel video file is often missing when downloads are off or the audio is licensed. The thumbnail and the permalink still work.

## Cadence and cost

Once a day. Counts keep moving, so each run re-reads the latest page and updates the same media id. The 18 November refresh added 9 posts and updated the other 491. Meta stays free at 10 brands and at 50. A bill appears only after leaving the official API, at about $0.115 per brand per day on the Apify check.

SQLite is the right store. One file, the media id as the primary key. MongoDB is the move when a post's payload changes shape often, or when the team already runs it.

## What "trending" means

A rate against that brand's own followers, for the last 7 days. Raw likes would let the biggest account win every week. A feed post ranks by `(likes + 5 × comments) / followers`. A Reel ranks by `view_count / followers`. Those two rates are separate lists. A post is a Reel only when `media_product_type` says so. A feed video uses the photo formula. Hidden likes use comments only. A missing count is not zero. The page also counts how many brands posted each product, and splits gold, diamond, and polki. Since April 2026, reel views include Facebook on cross-posts, so a spike can be a cross-post.

## What breaks first

The token broke first. The short-lived one expired on 16 November. Plan B was the 60-day exchange, which is done. Exchange it again before 17 January 2027, while it is still valid. If Graph then refuses the app, and `APIFY_TOKEN` is set, the run switches and continues.

Next was vision. Gemini tagged 12 photos on 18 November and then returned HTTP 429, the free daily limit of about 20 calls. Those posts stayed on the caption keyword tag. The next day's `tag` run continues with them. A 503 is the same: leave the row and retry. A vision failure is not a reason to scrape.

Then the reel file, when Meta omits `media_url`. The permalink and the thumbnail remain. A quiet brand is an empty week, not a failed fetch: on 18 November Tanishq and Senco returned 50 posts each and none fell inside the last 7 days, so the page has no row for them.

I would not automate Stories, and I would not answer a rate limit by scraping. Wait, and run it again.
