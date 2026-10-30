# Las Cruces Events (Live Love Las Cruces)

The events calendar that will replace CitySpark at events.livelovelascruces.com.
Built with [Astro](https://astro.build), hosted on Cloudflare Workers. Same design system as the Las Cruces Art Trail.

## Where things live

- **Live site (main branch):** https://lc-events-calendar.cf2-99b.workers.dev (Worker `lc-events-calendar`)
- **Design preview (redesign branch):** https://lc-events-preview.cf2-99b.workers.dev (Worker `lc-events-preview`, noindex, can never take the events domain)
- **City feed proxy:** https://lc-events-proxy.cf2-99b.workers.dev (Worker `lc-events-proxy`, source in `worker.js`). lascruces.gov blocks Cloudflare's build servers, so the build reads the city feed through this. `/debug` shows feed health.

Every push rebuilds automatically (about 1–2 minutes).

## Where events come from

1. **City of Las Cruces** feed via the proxy. Pulled fresh on every build.
2. **`src/data/events.json`**: events we add ourselves (later: approved submissions). `featured: true` puts it in Charlie's picks. `sample: true` only shows on the design preview.

If the city feed can't be reached, the build stops on purpose so the last good version stays live.
Working offline: `EVENTS_OFFLINE=1 npm run build` uses `src/data/city-snapshot.json`.

## Images

The city feed has no photos. Events with an `image` show it (flyers open full size). Everything else gets
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

- Daily automatic rebuild (so new city events appear without a push)
- Connect `/submit/` to an approval queue (Notion or D1), with flyer text read automatically
- More feeds (venues, Eventbrite, Bandsintown)
