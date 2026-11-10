# Las Cruces Events (Live Love Las Cruces)

The events calendar that will replace CitySpark at events.livelovelascruces.com.
Built with [Astro](https://astro.build), hosted on Cloudflare Workers. Same design system as the Las Cruces Art Trail.

## Where things live

- **Live site (main branch):** https://lc-events-calendar.cf2-99b.workers.dev (Worker `lc-events-calendar`)
- **Design preview (redesign branch):** https://lc-events-preview.cf2-99b.workers.dev (Worker `lc-events-preview`, noindex, can never take the events domain)
- **CitySpark copy:** https://cityspark-export.cf2-99b.workers.dev (Worker `cityspark-export`, source in `cityspark-export.js`). Copies every CitySpark listing within 30 miles plus its photo into Cloudflare KV (`lc-events-media`) every day, then rebuilds the site. `/status` shows progress. Photos are kept even after CitySpark is cancelled.
- **City feed proxy:** https://lc-events-proxy.cf2-99b.workers.dev (Worker `lc-events-proxy`, source in `worker.js`). lascruces.gov blocks Cloudflare's build servers, so the build reads the city feed through this. `/debug` shows feed health.

Every push rebuilds automatically (about 1–2 minutes). This only works while the repo is listed under the **Cloudflare Workers and Pages** app in GitHub (Settings → Applications → Configure → Repository access). If pushes stop building but manual builds still work, check that list first: public repos can still be read without being on it.

## Where events come from

1. **CitySpark copy** (the old calendar's listings, with photos). CitySpark's own "picks" are ignored: the Spotlight section only shows events Charlie marks.
2. **City of Las Cruces** feed via the proxy. Duplicates of CitySpark listings are dropped.
3. **`src/data/events.json`**: events we add ourselves (later: approved submissions). `featured: true` puts it in Spotlight (`sponsored: true` for paid). `sample: true` only shows on the design preview.

If the city feed can't be reached, the build stops on purpose so the last good version stays live.
Working offline: `EVENTS_OFFLINE=1 npm run build` uses `src/data/city-snapshot.json`.

## Images

Events without a photo get our own event-specific artwork (`src/lib/topics.js`): the event is matched to a
topic by its title (pickleball, trivia, wine, Halloween, board meeting… about 45 topics) and that topic's
illustration is drawn on the category color with the Organ Mountains skyline. The same art is used for share images.

**When the CitySpark subscription ends:** set `CITYSPARK_SUBSCRIBED = false` in `src/lib/site.js`. CitySpark's own
generated placeholder pictures are then swapped for our artwork; organizers' flyers and photos stay.
Also remove the `cityspark-export` Worker's schedule in Cloudflare (Workers > cityspark-export > Settings > Triggers),
since it will have nothing left to copy. Everything already copied stays.


CitySpark listings come with photos, copied into our own storage. The city feed has none. Events with an `image` show it (flyers open full size). Everything else gets
category artwork (color + icon + Organ Mountains skyline), and every event gets its own share image at `/og/event/<slug>.png`.

## What's built in

- Day-by-day agenda with filters (today, tomorrow, weekend, 7 days, category) saved in the URL
- Weekly regulars and city meetings shown as compact rows so one-off events stand out
- Event pages: Add to calendar (Google + .ics), directions, share, schema.org Event data, breadcrumbs
- SEO landing pages: `/this-weekend/` and `/category/<name>/`
- Whole calendar as a subscribable feed: `/calendar.ics`
- Sitemap, canonical URLs, per-page share images, noindex on preview addresses
- Accessibility: skip link, visible focus, 44px+ tap targets, reduced-motion support

## Still to do

- Daily automatic rebuild: done (the CitySpark copy triggers it after each daily refresh)
- Connect `/submit/` to an approval queue (Notion or D1), with flyer text read automatically
- More feeds (venues, Eventbrite, Bandsintown)
