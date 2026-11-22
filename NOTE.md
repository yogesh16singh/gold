# Recommendations

For QuickLens. 18 November 2026. I ran the collector on a live token, so the numbers below are from that run.

## How to get the posts

I used Meta's `business_discovery`. On 18 November it returned 50 posts for each of the ten brands, with likes, comments, reel views and followers. Those counts are what the ranking needs, and the call is free. One page of 50 already goes past seven days, so the daily job is about 10 calls for these brands and about 50 if the list grows. Development mode is enough while one admin holds the token. App Review only matters once someone else has to log in.

The first token died the next morning. It was a Graph API Explorer token, so it lasts somewhere between an hour and a day. I exchanged it for a long-lived user token, about 60 days. The one in use expires around 17 January 2027. A paid scraper is for when Graph rejects the app: missing permission, no Facebook Page, or a token that can't be renewed. If the Explorer token expires, get another Meta token and keep using the official API.

Apify is already wired as that backup. On 17 November one Candere fetch of 50 posts was listed at $0.115, and the account usage went up by $0.113. That's $2.30 per 1,000 posts. A daily page of 50 is about $34 a month at 10 brands and about $173 at 50. The Starter plan I checked that day caps a month at $19, so ten brands every day already goes over it. Apify also bills posts it returns again, including ones I already have stored. Bright Data's list rate is about $1.50 per 1,000, so about $23 and $113 for the same pull. The database stores the row the same way either way.

I wouldn't run a logged-in script. It breaks Instagram's terms, and a checkpoint or a ban just kills the feed with no warning.

On 20 November I checked three public repos that people use for this: instaloader/instaloader, mikf/gallery-dl, and subzeroid/instagrapi. I did not run them against the brands, and I did not log in. Instaloader reads Instagram's web JSON. Public profile posts used to come back without a session, but Instagram now often redirects that call to the login page, and stories and highlights need one. gallery-dl can include posts, reels, stories, and highlights, and the Instagram path expects cookies from a browser that is already logged in. instagrapi talks to the private mobile API. Its own examples start with a username and password, and it says anonymous web calls are not something to run in production. Stories are the same on all three: a working fetch is a logged-in session, even when the password is not on the command line. I left the collector on `business_discovery`. The useful ideas were already in this project: one row per media id, posts and reels as separate lists, and a thumbnail plus the permalink instead of the video file.

## Stories

I'd leave Stories out. The official API can't read another brand's Stories. They only last 24 hours, so automating them means polling every few hours, which is where the bans and the scraper bills show up. If a launch only exists as a Story, save it by hand.

## Images

I keep the permalink and a small thumbnail. That's what the page does now. Meta's photo URL expires in a few hours or a few days, and then a page full of those links goes blank. A thumbnail is about 100 KB. At 10 brands that's tens of megabytes a month, and at 50 it's still just a folder. The brands own the photos. This copy is for the internal page. The reel video is often missing when downloads are off or the audio is licensed. The thumbnail and the permalink still work.

## Cadence and cost

Once a day. The counts keep moving, so each run reads the latest page again and updates the same media id. On 18 November that refresh added 9 posts and updated the other 491. Meta stays free at 10 brands and at 50. Money only comes in if we leave the official API. On the Apify check that was about $0.115 per brand per day.

SQLite is enough. One file, media id as the primary key. I'd look at MongoDB if a post's payload keeps changing shape, or if the team is already on it.

## What "trending" means

I rank against that brand's own followers, for the last 7 days. Raw likes would let the biggest account win every week. A feed post is `(likes + 5 × comments) / followers`. A Reel is `view_count / followers`. I keep those as two lists. A post is a Reel only when `media_product_type` says so. A feed video uses the photo formula. Hidden likes use comments only. If a count is missing I leave it missing. The page also counts how many brands posted each product, and splits gold, diamond and polki. Store openings, greetings, and hacks stay out of those ranks. A greeting that names the products stays in. Since April 2026, reel views include Facebook on cross-posts, so a spike can just be a cross-post.

## What broke

The token went first. The short-lived one expired on 16 November. The 60-day exchange is done. It needs another exchange before 17 January 2027, while it's still valid. If Graph refuses the app after that and `APIFY_TOKEN` is set, the run switches and continues.

Then Gemini. It tagged 12 photos on 18 November and returned HTTP 429, the free daily limit of about 20 calls. Those posts stayed on the caption keyword tag. The next day's tag run picks them up. A 503 is the same: leave the row and try again later. I kept them on the caption tag and let the next run continue.

After that, the reel file, when Meta leaves out `media_url`. The permalink and the thumbnail are still there. A quiet brand is an empty week. On 18 November Tanishq and Senco returned 50 posts each and none of them were inside the last 7 days. The page names them and shows the date of their last stored post.
